"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Zap,
  FolderOpen,
  FileText,
  Upload,
  Hammer,
  Download,
  ListOrdered,
  Tag,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  description: string;
  auth: boolean;
  body?: Record<string, FieldDoc>;
  query?: Record<string, FieldDoc>;
  response?: string;
  curl?: string;
  notes?: string;
}

interface FieldDoc {
  type: string;
  required: boolean;
  description: string;
}

interface EndpointSection {
  title: string;
  icon: React.ReactNode;
  description: string;
  endpoints: Endpoint[];
}

// ─── Method Badge ───────────────────────────────────

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-accent/15 text-accent border-accent/30",
    POST: "bg-success/15 text-success border-success/30",
    PUT: "bg-warning/15 text-warning border-warning/30",
    DELETE: "bg-error/15 text-error border-error/30",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold font-mono ${colors[method] || "bg-bg-elevated text-text-muted border-border"}`}
    >
      {method}
    </span>
  );
}

// ─── Copy Button ────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded-md p-1.5 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
      title="Copy"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ─── Endpoint Card ──────────────────────────────────

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-elevated/50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />
        )}
        <MethodBadge method={endpoint.method} />
        <code className="text-sm font-mono text-text-primary">
          {endpoint.path}
        </code>
        <span className="ml-auto text-xs text-text-muted hidden sm:inline">
          {endpoint.description}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <p className="text-sm text-text-secondary">
            {endpoint.description}
          </p>

          {endpoint.notes && (
            <div className="rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-sm text-text-secondary">
              <strong className="text-warning">Note:</strong> {endpoint.notes}
            </div>
          )}

          {/* Request body */}
          {endpoint.body && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Request Body (JSON)
              </h4>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-elevated text-text-secondary">
                      <th className="px-3 py-2 text-left font-medium">
                        Field
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Required
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(endpoint.body).map(([name, field]) => (
                      <tr key={name} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-accent text-xs">
                          {name}
                        </td>
                        <td className="px-3 py-2 text-text-muted text-xs">
                          {field.type}
                        </td>
                        <td className="px-3 py-2">
                          {field.required ? (
                            <span className="text-xs text-error font-medium">
                              Yes
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">No</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-secondary text-xs">
                          {field.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Query params */}
          {endpoint.query && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Query Parameters
              </h4>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-elevated text-text-secondary">
                      <th className="px-3 py-2 text-left font-medium">
                        Param
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(endpoint.query).map(([name, field]) => (
                      <tr key={name} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-accent text-xs">
                          {name}
                        </td>
                        <td className="px-3 py-2 text-text-muted text-xs">
                          {field.type}
                        </td>
                        <td className="px-3 py-2 text-text-secondary text-xs">
                          {field.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Response */}
          {endpoint.response && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Response
              </h4>
              <div className="relative rounded-lg bg-bg-tertiary border border-border p-3 font-mono text-xs text-text-secondary overflow-x-auto">
                <CopyButton text={endpoint.response} />
                <pre className="whitespace-pre">{endpoint.response}</pre>
              </div>
            </div>
          )}

          {/* cURL example */}
          {endpoint.curl && (
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                Example
              </h4>
              <div className="relative rounded-lg bg-bg-tertiary border border-border p-3 font-mono text-xs text-text-secondary overflow-x-auto">
                <CopyButton text={endpoint.curl} />
                <pre className="whitespace-pre">{endpoint.curl}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Endpoint Sections Data ─────────────────────────

function getSections(origin: string): EndpointSection[] {
  const BASE = `${origin}/api/v1`;

  return [
  {
    title: "One-Shot Compilation",
    icon: <Zap className="h-5 w-5" />,
    description:
      "Async compile API for raw LaTeX input. Submit a job, poll status, then fetch output.",
    endpoints: [
      {
        method: "POST",
        path: `${BASE}/compile`,
        description:
          "Submit an async one-shot compile job. Accepts multipart/form-data or JSON body.",
        auth: true,
        body: {
          file: {
            type: "file (.tex)",
            required: false,
            description:
              "A .tex file to compile (multipart/form-data). Use this OR JSON 'source'.",
          },
          source: {
            type: "string",
            required: false,
            description:
              "LaTeX source as a string (JSON body). Use this OR multipart 'file'. Max 5 MB.",
          },
          engine: {
            type: "string",
            required: false,
            description:
              'Engine: "auto", "pdflatex", "xelatex", "lualatex", "latex". Default: "auto".',
            },
        },
        query: {
          engine: {
            type: "string",
            required: false,
            description:
              'Override engine via query param. Same options as body field.',
          },
        },
        response: `{
  "jobId": "uuid",
  "status": "queued",
  "message": "Compilation queued",
  "pollUrl": "/api/v1/compile/uuid",
  "outputUrl": "/api/v1/compile/uuid/output",
  "cancelUrl": "/api/v1/compile/uuid/cancel"
}`,
        curl: `# Submit compile job
curl -X POST ${BASE}/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -F "file=@document.tex" \\
  -F "engine=auto"

# JSON body also supported
curl -X POST ${BASE}/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"source": "\\\\documentclass{article}\\n\\\\begin{document}\\nHello!\\n\\\\end{document}"}'`,
        notes:
          "This endpoint is asynchronous by design. Use the returned job URLs to poll and fetch output.",
      },
      {
        method: "GET",
        path: `${BASE}/compile/:jobId`,
        description:
          "Get compile job status, summary counters, and output links.",
        auth: true,
        response: `{
  "job": {
    "id": "uuid",
    "status": "compiling",
    "requestedEngine": "auto",
    "engineUsed": null,
    "warningCount": 0,
    "errorCount": 0,
    "durationMs": null,
    "exitCode": null,
    "message": null,
    "createdAt": "2026-01-01T00:00:00Z",
    "startedAt": "2026-01-01T00:00:01Z",
    "completedAt": null,
    "expiresAt": null
  },
  "links": {
    "output": "/api/v1/compile/uuid/output",
    "pdf": null
  }
}`,
        curl: `curl ${BASE}/compile/JOB_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "GET",
        path: `${BASE}/compile/:jobId/output`,
        description:
          "Fetch compile output after completion. Supports JSON/base64 or raw PDF.",
        auth: true,
        query: {
          format: {
            type: "string",
            required: false,
            description:
              '"json" (default) or "base64" returns JSON with base64 PDF + logs/errors. "pdf" returns binary application/pdf.',
          },
        },
        response: `# Success (format=json or base64):
{
  "pdf": "JVBERi0xLjQK... (base64)",
  "engineUsed": "pdflatex",
  "logs": "This is pdfTeX, Version 3.14...",
  "errors": [],
  "durationMs": 3200
}

# Error / timeout / canceled:
{
  "error": "Compilation failed",
  "status": "error",
  "engineUsed": "pdflatex",
  "logs": "...",
  "errors": [ ... ],
  "durationMs": 1200
}`,
        curl: `# JSON output
curl "${BASE}/compile/JOB_ID/output?format=json" \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -o output.json

# Raw PDF
curl "${BASE}/compile/JOB_ID/output?format=pdf" \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  --output output.pdf`,
      },
      {
        method: "POST",
        path: `${BASE}/compile/:jobId/cancel`,
        description:
          "Cancel an in-progress async compile job.",
        auth: true,
        response: `{
  "jobId": "uuid",
  "status": "canceled",
  "message": "Cancel request accepted"
}`,
        curl: `curl -X POST ${BASE}/compile/JOB_ID/cancel \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },

    ],
  },
  {
    title: "Projects",
    icon: <FolderOpen className="h-5 w-5" />,
    description: "Create, list, update, and delete LaTeX projects.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects`,
        description: "List all projects for the authenticated user.",
        auth: true,
        response: `{
  "projects": [
    {
      "id": "uuid",
      "name": "My Paper",
      "description": "A research paper",
      "engine": "auto",
      "mainFile": "main.tex",
      "lastBuildStatus": "success",
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}`,
        curl: `curl ${BASE}/projects \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "POST",
        path: `${BASE}/projects`,
        description: "Create a new project from a template.",
        auth: true,
        body: {
          name: {
            type: "string",
            required: true,
            description: "Project name (1-255 characters).",
          },
          description: {
            type: "string",
            required: false,
            description: "Optional project description.",
          },
          template: {
            type: "string",
            required: false,
            description:
              'Template: "blank", "article", "thesis", "beamer", "letter". Default: "blank".',
          },
          engine: {
            type: "string",
            required: false,
            description:
              'Project default engine: "auto", "pdflatex", "xelatex", "lualatex", or "latex". Default: "auto".',
          },
        },
        response: `{
  "project": {
    "id": "uuid",
    "name": "My Paper",
    "engine": "auto",
    "mainFile": "main.tex",
    "createdAt": "2025-01-01T00:00:00Z"
  }
}`,
        curl: `curl -X POST ${BASE}/projects \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Paper", "template": "article"}'`,
      },
      {
        method: "GET",
        path: `${BASE}/projects/:projectId`,
        description:
          "Get a project's details including files and latest build.",
        auth: true,
        response: `{
  "project": { "id": "uuid", "name": "My Paper", ... },
  "files": [
    { "id": "uuid", "path": "main.tex", "mimeType": "text/x-tex", ... }
  ],
  "lastBuild": {
    "id": "uuid", "status": "success", "durationMs": 2500, ...
  }
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "PUT",
        path: `${BASE}/projects/:projectId`,
        description: "Update project settings (name, engine, main file).",
        auth: true,
        body: {
          name: {
            type: "string",
            required: false,
            description: "New project name (1-255 characters).",
          },
          description: {
            type: "string",
            required: false,
            description: "New project description (max 1000 characters).",
          },
          engine: {
            type: "string",
            required: false,
            description:
              '"auto", "pdflatex", "xelatex", "lualatex", or "latex".',
          },
          mainFile: {
            type: "string",
            required: false,
            description: "Path to the main .tex file (max 500 characters).",
          },
        },
        curl: `curl -X PUT ${BASE}/projects/PROJECT_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Renamed Paper", "engine": "xelatex"}'`,
      },
      {
        method: "DELETE",
        path: `${BASE}/projects/:projectId`,
        description:
          "Delete a project and all its files permanently.",
        auth: true,
        curl: `curl -X DELETE ${BASE}/projects/PROJECT_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  {
  title: "Labels",
  icon: <Tag className="h-5 w-5" />,
  description: "Create, list, attach, and detach labels for organizing projects.",
  endpoints: [
    // ────────────────────────────────────────────────────────────────
    {
      method: "GET",
      path: `${BASE}/labels`,
      description: "List all labels for the authenticated user.",
      auth: true,
      response: `{
  "labels": [
    {
      "id": "uuid",
      "name": "Important",
      "userId": "uuid",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}`,
      curl: `curl ${BASE}/labels \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
    },

    // ────────────────────────────────────────────────────────────────
    {
      method: "PUT",
      path: `${BASE}/labels/attach`,
      description:
        "Attach a label to a project by name. Creates the label if it does not already exist.",
      auth: true,
      body: {
        projectId: {
          type: "string",
          required: true,
          description: "The ID of the project to attach the label to.",
        },
        labelName: {
          type: "string",
          required: true,
          description: "The label name. If it doesn't exist, it will be created.",
        },
      },
      response: `{
  "projectLabel": {
    "id": "uuid",
    "projectId": "uuid",
    "labelId": "uuid"
  },
  "label": {
    "id": "uuid",
    "name": "Important",
    "userId": "uuid"
  }
}`,
      curl: `curl -X PUT ${BASE}/labels/attach \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"projectId": "PROJECT_ID", "labelName": "Important"}'`,
    },

    // ────────────────────────────────────────────────────────────────
    {
      method: "PUT",
      path: `${BASE}/labels/detach`,
      description:
        "Detach a label from a project. If the label is no longer used by any project, it is deleted.",
      auth: true,
      body: {
        projectId: {
          type: "string",
          required: true,
          description: "The ID of the project to detach the label from.",
        },
        labelId: {
          type: "string",
          required: true,
          description: "The ID of the label to detach.",
        },
      },
      response: `{
  "id": "uuid",
  "projectId": "uuid",
  "labelId": "uuid",
  "deletedLabel": true
}`,
      curl: `curl -X PUT ${BASE}/labels/detach \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"projectId": "PROJECT_ID", "labelId": "LABEL_ID"}'`,
    },
  ],
},

  {
    title: "Files",
    icon: <FileText className="h-5 w-5" />,
    description: "Manage files within a project.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/files`,
        description: "List all files in a project.",
        auth: true,
        response: `{
  "files": [
    {
      "id": "uuid",
      "path": "main.tex",
      "mimeType": "text/x-tex",
      "size": 1234,
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID/files \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "POST",
        path: `${BASE}/projects/:projectId/files`,
        description: "Create a new file in the project.",
        auth: true,
        body: {
          path: {
            type: "string",
            required: true,
            description:
              'File path relative to project root (e.g. "chapters/intro.tex").',
          },
          content: {
            type: "string",
            required: false,
            description: "File content. Default: empty string. Ignored if isDirectory is true.",
          },
          isDirectory: {
            type: "boolean",
            required: false,
            description: "Set to true to create a directory instead of a file.",
          },
        },
        curl: `curl -X POST ${BASE}/projects/PROJECT_ID/files \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"path": "chapters/intro.tex", "content": "\\\\chapter{Introduction}\\n"}'`,
      },
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/files/:fileId`,
        description: "Get file metadata and content.",
        auth: true,
        response: `{
  "file": {
    "id": "uuid",
    "path": "main.tex",
    "mimeType": "text/x-tex",
    "size": 1234,
    "createdAt": "2025-01-01T00:00:00Z"
  },
  "content": "\\\\documentclass{article}..."
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID/files/FILE_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
      {
        method: "PUT",
        path: `${BASE}/projects/:projectId/files/:fileId`,
        description: "Update a file's content.",
        auth: true,
        body: {
          content: {
            type: "string",
            required: true,
            description: "New file content.",
          },
        },
        curl: `curl -X PUT ${BASE}/projects/PROJECT_ID/files/FILE_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "\\\\documentclass{article}\\n\\\\begin{document}\\nUpdated!\\n\\\\end{document}"}'`,
      },
      {
        method: "DELETE",
        path: `${BASE}/projects/:projectId/files/:fileId`,
        description: "Delete a file from the project.",
        auth: true,
        curl: `curl -X DELETE ${BASE}/projects/PROJECT_ID/files/FILE_ID \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  {
    title: "File Upload",
    icon: <Upload className="h-5 w-5" />,
    description: "Upload files via multipart form data.",
    endpoints: [
      {
        method: "POST",
        path: `${BASE}/projects/:projectId/files/upload`,
        description:
          "Upload one or more files via FormData. Supports images, .bib, .tex, .sty, etc.",
        auth: true,
        notes:
          'Send as multipart/form-data with "files[]" field for each file and "paths[]" field for the corresponding file path. If a file already exists at the path, it will be overwritten.',
        response: `{
  "files": [
    { "id": "uuid", "path": "images/figure1.png", "mimeType": "image/png", "size": 45000 }
  ]
}`,
        curl: `curl -X POST ${BASE}/projects/PROJECT_ID/files/upload \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -F "files[]=@figure1.png" \\
  -F "paths[]=images/figure1.png" \\
  -F "files[]=@refs.bib" \\
  -F "paths[]=references.bib"`,
      },
    ],
  },
  {
    title: "Compilation",
    icon: <Hammer className="h-5 w-5" />,
    description:
      "Trigger compilation of a project and check build status.",
    endpoints: [
      {
        method: "POST",
        path: `${BASE}/projects/:projectId/compile`,
        description:
          "Queue a compilation of the project. Returns the queued build id.",
        auth: true,
        body: {
          engine: {
            type: "string",
            required: false,
            description:
              'Optional one-time engine override for this build. Does not change the project default engine.',
          },
        },
        response: `{
  "buildId": "uuid",
  "status": "queued",
  "message": "Compilation queued"
}`,
        curl: `curl -X POST ${BASE}/projects/PROJECT_ID/compile \\
  -H "Authorization: Bearer bs_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"engine": "auto"}'`,
      },
    ],
  },
  {
    title: "PDF Download",
    icon: <Download className="h-5 w-5" />,
    description: "Download the compiled PDF from a project.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/pdf`,
        description:
          "Download the latest compiled PDF. Returns the raw binary PDF.",
        auth: true,
        notes:
          "Returns `application/pdf` content type. The project must have a successful build.",
        curl: `curl -o output.pdf ${BASE}/projects/PROJECT_ID/pdf \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  {
    title: "Build Logs",
    icon: <ListOrdered className="h-5 w-5" />,
    description: "Retrieve build status and parsed LaTeX logs.",
    endpoints: [
      {
        method: "GET",
        path: `${BASE}/projects/:projectId/builds`,
        description:
          "Get the latest build with status, logs, and parsed errors.",
        auth: true,
        response: `{
  "build": {
    "id": "uuid",
    "status": "success",
    "engine": "pdflatex",
    "logs": "This is pdfTeX, Version 3.14...",
    "durationMs": 2500,
    "createdAt": "2025-01-01T00:00:00Z"
  },
  "errors": [
    {
      "type": "error",
      "message": "Undefined control sequence",
      "line": 42,
      "file": "main.tex"
    }
  ]
}`,
        curl: `curl ${BASE}/projects/PROJECT_ID/builds \\
  -H "Authorization: Bearer bs_YOUR_API_KEY"`,
      },
    ],
  },
  ];
}

// ─── Table of Contents ──────────────────────────────

function TableOfContents({ sections }: { sections: EndpointSection[] }) {
  return (
    <nav className="hidden lg:block sticky top-24 w-56 shrink-0">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
        On this page
      </h3>
      <ul className="space-y-1.5">
        <li>
          <a
            href="#authentication"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Authentication
          </a>
        </li>
        <li>
          <a
            href="#errors"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Error Handling
          </a>
        </li>
        {sections.map((section) => (
          <li key={section.title}>
            <a
              href={`#${section.title.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ─── API Docs Page ──────────────────────────────────

export default function ApiDocsPage() {
  const [origin, setOrigin] = useState("https://your-instance.com");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const sections = useMemo(() => getSections(origin), [origin]);

  return (
    <div className="flex gap-8">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Back link & heading */}
        <Link
          href="/dashboard/developers"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Developer Settings
        </Link>

        <h1 className="text-3xl font-bold text-text-primary mb-2">
          API Documentation
        </h1>
        <p className="text-text-secondary mb-8">
          The Backslash API lets you compile LaTeX documents, manage projects,
          and upload files programmatically. All endpoints require API key
          authentication.
        </p>

        {/* Base URL */}
        <div className="rounded-lg border border-border bg-bg-secondary p-4 mb-8">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            Base URL
          </h3>
          <code className="text-sm font-mono text-accent">
            {typeof window !== "undefined"
              ? `${window.location.origin}/api/v1`
              : "https://your-instance.com/api/v1"}
          </code>
        </div>

        {/* Authentication */}
        <section id="authentication" className="mb-10">
          <h2 className="text-xl font-bold text-text-primary mb-3">
            Authentication
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            All API requests must include your API key in the{" "}
            <code className="text-accent font-mono text-xs bg-bg-elevated px-1.5 py-0.5 rounded">
              Authorization
            </code>{" "}
            header using the Bearer scheme:
          </p>
          <div className="relative rounded-lg bg-bg-tertiary border border-border p-3 font-mono text-xs text-text-secondary mb-4">
            <CopyButton text='Authorization: Bearer bs_YOUR_API_KEY' />
            <pre>Authorization: Bearer bs_YOUR_API_KEY</pre>
          </div>
          <p className="text-sm text-text-secondary">
            API keys can be created and managed in your{" "}
            <Link
              href="/dashboard/developers"
              className="text-accent hover:text-accent-hover"
            >
              Developer Settings
            </Link>
            . Each account can have up to 10 API keys.
          </p>
        </section>

        {/* Rate Limits */}
        <section id="errors" className="mb-10">
          <h2 className="text-xl font-bold text-text-primary mb-3">
            Error Handling
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            The API uses standard HTTP status codes. Errors return a JSON body:
          </p>
          <div className="relative rounded-lg bg-bg-tertiary border border-border p-3 font-mono text-xs text-text-secondary mb-4">
            <pre>{`{
  "error": "A human-readable error message"
}`}</pre>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-elevated text-text-secondary">
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody className="text-text-secondary">
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">200</td>
                  <td className="px-3 py-2 text-xs">Success</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">201</td>
                  <td className="px-3 py-2 text-xs">Resource created</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">202</td>
                  <td className="px-3 py-2 text-xs">
                    Accepted — async job queued (compilation)
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">400</td>
                  <td className="px-3 py-2 text-xs">
                    Bad request — invalid input or validation error
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">401</td>
                  <td className="px-3 py-2 text-xs">
                    Unauthorized — missing or invalid API key
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">403</td>
                  <td className="px-3 py-2 text-xs">
                    Forbidden — API key expired
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">404</td>
                  <td className="px-3 py-2 text-xs">
                    Not found — resource does not exist or you don&apos;t own it
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">409</td>
                  <td className="px-3 py-2 text-xs">
                    Conflict — resource already exists (e.g. duplicate file path)
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">422</td>
                  <td className="px-3 py-2 text-xs">
                    Unprocessable — compilation failed or could not produce output
                  </td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">500</td>
                  <td className="px-3 py-2 text-xs">
                    Internal server error
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Endpoint sections */}
        {sections.map((section) => (
          <section
            key={section.title}
            id={section.title.toLowerCase().replace(/\s+/g, "-")}
            className="mb-10"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-accent">{section.icon}</span>
              <h2 className="text-xl font-bold text-text-primary">
                {section.title}
              </h2>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              {section.description}
            </p>
            <div className="space-y-3">
              {section.endpoints.map((endpoint) => (
                <EndpointCard
                  key={`${endpoint.method}-${endpoint.path}`}
                  endpoint={endpoint}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-border">
          <Link
            href="/dashboard/developers"
            className="text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            ← Back to Developer Settings
          </Link>
        </div>
      </div>

      {/* Sidebar TOC */}
      <TableOfContents sections={sections} />
    </div>
  );
}
