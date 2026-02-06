import type { ParsedLogEntry } from "@leafedit/shared";

// ─── Patterns ──────────────────────────────────────

/**
 * Matches file-line-error format produced by `-file-line-error`:
 *   ./file.tex:15: Undefined control sequence.
 *   ./chapter/intro.tex:42: Missing $ inserted.
 */
const FILE_LINE_ERROR_RE =
  /^(\.\/[^:]+):(\d+):\s*(.+)$/;

/**
 * Matches classic LaTeX error lines:
 *   ! LaTeX Error: Environment itemize undefined.
 *   ! Undefined control sequence.
 *   ! Emergency stop.
 */
const LATEX_ERROR_RE =
  /^!\s+(.+)$/;

/**
 * Matches `l.<number>` lines that follow `!` errors to give a line number:
 *   l.27 \begin{itemiz}
 */
const ERROR_LINE_NUMBER_RE =
  /^l\.(\d+)\s/;

/**
 * Matches LaTeX warnings with optional line numbers:
 *   LaTeX Warning: Reference `fig:foo' on page 3 undefined on input line 45.
 *   LaTeX Warning: Citation `bar' on page 1 undefined on input line 12.
 *   Package natbib Warning: Citation `baz' on page 2 undefined on input line 88.
 */
const LATEX_WARNING_RE =
  /^(?:LaTeX|Package\s+\S+)\s+Warning:\s*(.+)$/;

/**
 * Extracts line number from warning text:
 *   ... on input line 45.
 */
const WARNING_LINE_RE =
  /on input line (\d+)/;

/**
 * Matches overfull and underfull box warnings:
 *   Overfull \hbox (6.80882pt too wide) in paragraph at lines 28--32
 *   Underfull \hbox (badness 10000) in paragraph at lines 15--15
 *   Overfull \vbox (12.0pt too high) has occurred while \output is active
 */
const BOX_WARNING_RE =
  /^((?:Over|Under)full\s+\\[hv]box\s+.+)$/;

/**
 * Extracts line number(s) from box warnings:
 *   ... at lines 28--32
 */
const BOX_LINE_RE =
  /at lines? (\d+)/;

/**
 * Matches the current file context from the log:
 *   (./chapter/intro.tex
 * LaTeX logs use parentheses to track file open/close.
 */
const FILE_OPEN_RE =
  /\((\.[^\s()]+\.(?:tex|sty|cls|bib|bbl|aux|toc|lof|lot))/;

// ─── Parser ────────────────────────────────────────

/**
 * Parses a raw LaTeX compilation log and extracts structured entries
 * for errors, warnings, and overfull/underfull box notifications.
 */
export function parseLatexLog(rawLog: string): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];
  const lines = rawLog.split("\n");

  // Track the current file context from `(./file.tex` markers
  let currentFile = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Update current file context from parenthesized file openings
    const fileMatch = line.match(FILE_OPEN_RE);
    if (fileMatch) {
      currentFile = fileMatch[1];
    }

    // ── File-line-error format ───────────────────────
    const fileLineMatch = line.match(FILE_LINE_ERROR_RE);
    if (fileLineMatch) {
      entries.push({
        type: "error",
        file: fileLineMatch[1],
        line: parseInt(fileLineMatch[2], 10),
        message: fileLineMatch[3].trim(),
      });
      continue;
    }

    // ── Classic `! Error` format ─────────────────────
    const errorMatch = line.match(LATEX_ERROR_RE);
    if (errorMatch) {
      const message = errorMatch[1].trim();
      let errorLine = 0;

      // Look ahead for `l.<number>` to get the line number
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const lineNumMatch = lines[j].match(ERROR_LINE_NUMBER_RE);
        if (lineNumMatch) {
          errorLine = parseInt(lineNumMatch[1], 10);
          break;
        }
      }

      entries.push({
        type: "error",
        file: currentFile || "unknown",
        line: errorLine,
        message,
      });
      continue;
    }

    // ── LaTeX / Package Warnings ─────────────────────
    const warningMatch = line.match(LATEX_WARNING_RE);
    if (warningMatch) {
      let warningText = warningMatch[1].trim();

      // Warnings can span multiple lines, ending with a period
      let j = i + 1;
      while (j < lines.length && !warningText.endsWith(".")) {
        const nextLine = lines[j].trim();
        if (nextLine === "" || nextLine.startsWith("!") || nextLine.startsWith("(")) {
          break;
        }
        warningText += " " + nextLine;
        j++;
      }

      const lineMatch = warningText.match(WARNING_LINE_RE);

      entries.push({
        type: "warning",
        file: currentFile || "unknown",
        line: lineMatch ? parseInt(lineMatch[1], 10) : 0,
        message: warningText,
      });
      continue;
    }

    // ── Overfull / Underfull Box Warnings ─────────────
    const boxMatch = line.match(BOX_WARNING_RE);
    if (boxMatch) {
      const boxText = boxMatch[1].trim();
      const boxLineMatch = boxText.match(BOX_LINE_RE);

      entries.push({
        type: "info",
        file: currentFile || "unknown",
        line: boxLineMatch ? parseInt(boxLineMatch[1], 10) : 0,
        message: boxText,
      });
      continue;
    }
  }

  return entries;
}

// ─── Summary Helpers ───────────────────────────────

export interface LogSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  entries: ParsedLogEntry[];
}

/**
 * Produces a summary of the parsed log entries grouped by type.
 */
export function summarizeLog(rawLog: string): LogSummary {
  const entries = parseLatexLog(rawLog);

  return {
    errorCount: entries.filter((e) => e.type === "error").length,
    warningCount: entries.filter((e) => e.type === "warning").length,
    infoCount: entries.filter((e) => e.type === "info").length,
    entries,
  };
}

/**
 * Extracts only error entries from the log. Useful for quick status checks.
 */
export function extractErrors(rawLog: string): ParsedLogEntry[] {
  return parseLatexLog(rawLog).filter((e) => e.type === "error");
}

/**
 * Formats parsed log entries into a human-readable string.
 */
export function formatLogEntries(entries: ParsedLogEntry[]): string {
  if (entries.length === 0) {
    return "No issues found.";
  }

  return entries
    .map((entry) => {
      const location =
        entry.line > 0 ? `${entry.file}:${entry.line}` : entry.file;
      const prefix =
        entry.type === "error"
          ? "ERROR"
          : entry.type === "warning"
            ? "WARN"
            : "INFO";
      return `[${prefix}] ${location}: ${entry.message}`;
    })
    .join("\n");
}
