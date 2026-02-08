import Docker from "dockerode";
import { readFile } from "fs/promises";
import path from "path";
import { ENGINE_FLAGS, LIMITS } from "@backslash/shared";
import type { Engine } from "@backslash/shared";

// ─── Docker Client ─────────────────────────────────

let dockerInstance: Docker | null = null;

export function getDockerClient(): Docker {
  if (!dockerInstance) {
    dockerInstance = new Docker({
      socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock",
    });
  }
  return dockerInstance;
}

// ─── Configuration ─────────────────────────────────

const COMPILER_IMAGE = process.env.COMPILER_IMAGE || "backslash-compiler";

const COMPILE_TIMEOUT = parseInt(
  process.env.COMPILE_TIMEOUT ||
    String(LIMITS.COMPILE_TIMEOUT_DEFAULT),
  10
);

const COMPILE_MEMORY = process.env.COMPILE_MEMORY ||
  LIMITS.COMPILE_MEMORY_DEFAULT;

const COMPILE_CPUS = parseFloat(
  process.env.COMPILE_CPUS ||
    String(LIMITS.COMPILE_CPUS_DEFAULT)
);

const STORAGE_PATH = process.env.STORAGE_PATH || "/data";
const PROJECTS_VOLUME = process.env.PROJECTS_VOLUME || "backslash-project-data";

// ─── Types ─────────────────────────────────────────

export interface CompileContainerOptions {
  projectDir: string;
  mainFile: string;
}

export interface CompileContainerResult {
  exitCode: number;
  logs: string;
  timedOut: boolean;
}

// ─── Helpers ───────────────────────────────────────

/**
 * Parses a Docker memory string (e.g. "1g", "512m", "1024k") into bytes.
 */
function parseMemoryString(mem: string): number {
  const match = mem.match(/^(\d+(?:\.\d+)?)\s*([kmgtKMGT])?[bB]?$/);
  if (!match) return 1024 * 1024 * 1024; // default 1g
  const value = parseFloat(match[1]);
  const unit = (match[2] || "").toLowerCase();
  switch (unit) {
    case "k": return Math.floor(value * 1024);
    case "m": return Math.floor(value * 1024 * 1024);
    case "g": return Math.floor(value * 1024 * 1024 * 1024);
    case "t": return Math.floor(value * 1024 * 1024 * 1024 * 1024);
    default:  return Math.floor(value);
  }
}

/**
 * Fetches logs from a stopped container.
 *
 * Uses `follow: true` which returns a raw binary stream from dockerode.
 * On a stopped container the Docker daemon immediately emits all output
 * and closes the stream — so this is safe and doesn't hang.
 *
 * We CANNOT use `follow: false` because dockerode collects the response
 * via string concatenation (`body += chunk`) which corrupts the binary
 * multiplexed frame headers.
 */
async function fetchContainerLogs(container: Docker.Container): Promise<string> {
  return new Promise<string>((resolve) => {
    // Safety timeout — if the stream hangs for any reason,
    // return whatever we've collected so far.
    const LOG_TIMEOUT_MS = 15_000;
    let settled = false;
    const chunks: Buffer[] = [];

    function finish() {
      if (settled) return;
      settled = true;

      const raw = Buffer.concat(chunks);

      // Demux Docker multiplexed stream: each frame has an 8-byte header
      // [stream_type(1), 0, 0, 0, size_be32(4)] followed by payload
      const payloads: Buffer[] = [];
      let offset = 0;
      while (offset + 8 <= raw.length) {
        const size = raw.readUInt32BE(offset + 4);
        const start = offset + 8;
        const end = Math.min(start + size, raw.length);
        if (start < raw.length) {
          payloads.push(raw.subarray(start, end));
        }
        offset = end;
      }

      const text = payloads.length > 0
        ? Buffer.concat(payloads).toString("utf-8")
        : raw.toString("utf-8");

      // Strip null bytes that PostgreSQL rejects
      resolve(text.replace(/\0/g, ""));
    }

    const timeout = setTimeout(() => {
      console.warn(`[Docker] Log collection timed out after ${LOG_TIMEOUT_MS}ms, using ${chunks.length} chunks collected so far`);
      finish();
    }, LOG_TIMEOUT_MS);

    container.logs(
      { follow: true, stdout: true, stderr: true },
      (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
        if (err || !stream) {
          clearTimeout(timeout);
          console.error(`[Docker] Failed to get log stream: ${err?.message || "no stream"}`);
          resolve(err ? `[Docker] Log error: ${err.message}` : "");
          return;
        }

        stream.on("data", (chunk: Buffer) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        stream.on("end", () => {
          clearTimeout(timeout);
          finish();
        });

        stream.on("error", (streamErr: Error) => {
          clearTimeout(timeout);
          console.error(`[Docker] Log stream error: ${streamErr.message}`);
          finish();
        });
      }
    );
  });
}

// ─── Engine Auto-Detection ──────────────────────────

/**
 * Detects the best LaTeX engine by reading the main .tex file.
 * - luacode / directlua / luatextra → lualatex
 * - fontspec / unicode-math / polyglossia → xelatex
 * - everything else → pdflatex
 */
export async function detectEngine(projectDir: string, mainFile: string): Promise<Engine> {
  try {
    const filePath = path.join(projectDir, mainFile);
    const content = await readFile(filePath, "utf-8");

    if (/\\usepackage\{luacode\}|\\directlua\b|\\usepackage\{luatextra\}/.test(content)) {
      return "lualatex";
    }
    if (/\\usepackage\{fontspec\}|\\usepackage\{unicode-math\}|\\usepackage\{polyglossia\}/.test(content)) {
      return "xelatex";
    }
  } catch {
    // If we can't read the file, fall back to pdflatex
  }
  return "pdflatex";
}

// ─── Container-per-Build Compilation ────────────────

/**
 * Runs a LaTeX compilation in an isolated, ephemeral Docker container.
 *
 * The engine is auto-detected from the main .tex file source.
 *
 * Each build gets its own container with full sandboxing:
 * - NetworkDisabled: no network access
 * - CapDrop: ALL capabilities dropped
 * - SecurityOpt: no-new-privileges
 * - PidsLimit: 256 (prevents fork bombs)
 * - Per-container memory and CPU limits
 *
 * The project directory is bind-mounted into the container at /work.
 * Timeout is enforced via JS setTimeout + container.kill().
 * The container is always removed after use.
 */
export async function runCompileContainer(
  options: CompileContainerOptions
): Promise<CompileContainerResult> {
  const docker = getDockerClient();
  const { projectDir, mainFile } = options;

  console.log(`[Docker] Starting compilation: dir=${projectDir} file=${mainFile}`);

  const engine = await detectEngine(projectDir, mainFile);
  const engineFlag = ENGINE_FLAGS[engine];
  const memoryBytes = parseMemoryString(COMPILE_MEMORY);
  const nanoCpus = Math.floor(COMPILE_CPUS * 1e9);

  console.log(`[Docker] Engine: ${engine}, Image: ${COMPILER_IMAGE}, Volume: ${PROJECTS_VOLUME} -> ${STORAGE_PATH}`);

  const cmd = [
    "latexmk",
    engineFlag,
    "-gg",
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    mainFile,
  ];

  let container: Docker.Container | null = null;
  let logs = "";
  let exitCode = 1;
  let timedOut = false;

  try {
    console.log(`[Docker] Creating container with WorkingDir=${projectDir}, cmd=${cmd.join(" ")}`);
    container = await docker.createContainer({
      Image: COMPILER_IMAGE,
      Cmd: cmd,
      WorkingDir: projectDir,
      NetworkDisabled: true,
      HostConfig: {
        Mounts: [
          {
            Type: "volume" as "volume",
            Source: PROJECTS_VOLUME,
            Target: STORAGE_PATH,
            ReadOnly: false,
          },
        ],
        Memory: memoryBytes,
        NanoCpus: nanoCpus,
        PidsLimit: 256,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        AutoRemove: false,
      },
    });
    console.log(`[Docker] Container created: ${container.id.slice(0, 12)}`);

    await container.start();
    console.log(`[Docker] Container started: ${container.id.slice(0, 12)}`);

    // Enforce timeout via JS setTimeout
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), COMPILE_TIMEOUT * 1000);
    });

    const waitPromise = container.wait().then((data) => ({
      kind: "done" as const,
      StatusCode: data.StatusCode,
    }));

    const race = await Promise.race([
      waitPromise,
      timeoutPromise,
    ]);

    if (race === "timeout") {
      timedOut = true;
      console.warn(`[Docker] Container ${container.id.slice(0, 12)} timed out after ${COMPILE_TIMEOUT}s`);
      try {
        await container.kill();
      } catch {
        // Container may have already exited
      }
      try {
        await container.wait();
      } catch {
        // Ignore errors if already stopped
      }
    } else {
      exitCode = race.StatusCode;
      console.log(`[Docker] Container ${container.id.slice(0, 12)} exited with code ${exitCode}`);
    }

    // Fetch logs AFTER the container has stopped — this is reliable
    // unlike pre-attaching a stream which can hang indefinitely.
    logs = await fetchContainerLogs(container);
    console.log(`[Docker] Logs fetched (${logs.length} chars)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Docker] Container error: ${message}`);
    logs = `[Docker] Container error: ${message}`;
    exitCode = -1;
  } finally {
    if (container) {
      try {
        await container.remove({ force: true });
      } catch {
        // Container may already be removed
      }
    }
  }

  return {
    exitCode: timedOut ? -1 : exitCode,
    logs,
    timedOut,
  };
}

// ─── Health Check ───────────────────────────────────

/**
 * Checks whether the Docker daemon is reachable.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const docker = getDockerClient();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}
