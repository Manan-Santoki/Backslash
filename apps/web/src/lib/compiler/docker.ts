import Docker from "dockerode";
import { Readable } from "stream";
import { readFile } from "fs/promises";
import path from "path";
import { ENGINE_FLAGS, LIMITS } from "@leafedit/shared";
import type { Engine } from "@leafedit/shared";

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

const COMPILER_IMAGE = process.env.COMPILER_IMAGE || "leafedit-compiler";

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
 * Collects all output from a Docker container's multiplexed stream
 * into a single string. Demuxes the Docker stream header frames
 * (8-byte headers per frame) to extract only the payload text.
 */
async function collectLogs(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = stream as Readable;

    readable.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    readable.on("end", () => {
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

      // Strip any remaining null bytes that PostgreSQL rejects
      resolve(text.replace(/\0/g, ""));
    });

    readable.on("error", (err: Error) => {
      reject(err);
    });
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

  const engine = await detectEngine(projectDir, mainFile);
  const engineFlag = ENGINE_FLAGS[engine];
  const memoryBytes = parseMemoryString(COMPILE_MEMORY);
  const nanoCpus = Math.floor(COMPILE_CPUS * 1e9);

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
    container = await docker.createContainer({
      Image: COMPILER_IMAGE,
      Cmd: cmd,
      WorkingDir: "/work",
      NetworkDisabled: true,
      HostConfig: {
        Binds: [`${projectDir}:/work`],
        Memory: memoryBytes,
        NanoCpus: nanoCpus,
        PidsLimit: 256,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        AutoRemove: false,
      },
    });

    // Attach to stdout/stderr before starting
    const stream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });

    const logsPromise = collectLogs(stream);

    await container.start();

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
      try {
        await container.kill();
      } catch {
        // Container may have already exited
      }
      // Wait for container to fully stop after kill
      try {
        await container.wait();
      } catch {
        // Ignore errors if already stopped
      }
    } else {
      exitCode = race.StatusCode;
    }

    logs = await logsPromise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs = `[Docker] Container error: ${message}`;
    exitCode = -1;
  } finally {
    // Always clean up the container
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
