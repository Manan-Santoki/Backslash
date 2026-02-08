<h1 align="center">\ Backslash</h1>
<p align="center"><strong>Self-hostable, open-source LaTeX editor with live PDF preview and a full REST API.</strong></p>
<p align="center">Write beautiful documents with a modern editing experience — on your own infrastructure.</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Next.js-15-black" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED" alt="Docker" />
</p>

## 🎥 Demo

[![Demo Video](https://img.youtube.com/vi/P7Zsps_qG-E/0.jpg)](https://www.youtube.com/watch?v=P7Zsps_qG-E)

---

## ✨ Features

- **Live PDF Preview** — See your document update in real-time as you type. Auto-compilation on save with real-time WebSocket status updates via a standalone server.
- **Full LaTeX Engine Support** — Compile with `pdflatex`, `xelatex`, `lualatex`, or `latex`. Engine auto-detection based on document packages.
- **Project Management** — Create, organize, and manage multiple LaTeX projects from a clean dashboard.
- **Built-in File Tree** — Navigate project files with a sidebar file explorer. Create, rename, upload, and delete files.
- **Code Editor** — Syntax-highlighted LaTeX editing powered by CodeMirror 6 with search, autocomplete, and keyboard shortcuts.
- **Build Logs & Error Parsing** — Structured build output with clickable errors that jump to the offending line in the editor.
- **Resizable Panels** — IDE-like layout with draggable dividers between file tree, editor, PDF viewer, and build logs.
- **Template System** — Start new projects from built-in templates: Blank, Article, Thesis, Beamer (Presentation), and Letter.
- **Sandboxed Compilation** — Each build runs in an isolated Docker container with memory/CPU limits, network disabled, and auto-cleanup.
- **REST API** — Full public API with API key authentication. Compile LaTeX to PDF, manage projects, upload files — all via HTTP.
- **Developer Dashboard** — Generate and manage API keys from the UI. Built-in API documentation page.
- **User Authentication** — Session-based auth with secure password hashing (bcrypt) and JWT session tokens.
- **Dark & Light Themes** — Toggle between dark and light mode with a single click.
- **One-Click Self-Hosting** — Deploy on your own server with a single `docker compose up -d`. Everything included — PostgreSQL, Redis, app.
- **No Limits** — No file size caps, no compile timeouts (configurable), no project restrictions. Your server, your rules.
- **Open Source** — Fully open-source under the MIT license.

---

## 🚀 One-Click Deploy

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- A PostgreSQL database — either use the **built-in** Docker container or an **external** hosted instance (Neon, Supabase, Railway, your own server, etc.)

```bash
git clone https://github.com/Manan-Santoki/Backslash.git
cd Backslash
cp .env.example .env
# (optional) edit .env to change SESSION_SECRET, PORT, etc.
docker compose up -d
```

That's it. PostgreSQL, Redis, and the web app all start together.

Open [http://localhost:3000](http://localhost:3000) (or whichever `PORT` you set) and create your account.

> **Using an external database?** Set `DATABASE_URL` in `.env` to your connection string.
> The bundled PostgreSQL will still start but will sit idle using minimal resources.

Docker Compose automatically:
- Builds the TeX Live compiler image (~2–5 min on first run)
- Starts PostgreSQL 16 with persistent storage
- Starts Redis 7 for job queuing
- Builds and launches the web application on port 3000
- Starts the WebSocket server on port 3001 for real-time build updates

### Platform Deployment (Dokploy, Coolify, Portainer, etc.)

If your platform handles networking and reverse proxy for you, add this line to `.env` to **disable host port exposure**:

```env
COMPOSE_FILE=docker-compose.yml
```

This tells Docker Compose to skip the override file that publishes the port. Your platform's reverse proxy connects to the container over the Docker network — no port leaks to the host.

### Environment Variables

Create a `.env` file in the project root (or edit the one from `.env.example`):

```env
PORT=3000
WS_PORT=3001
SESSION_SECRET=change-me-to-a-random-64-char-string

# Only set this if you want to use an external database.
# By default, the bundled PostgreSQL is used automatically.
# DATABASE_URL=postgresql://user:password@your-host:5432/backslash

# Compilation (optional)
COMPILE_MEMORY=1g
COMPILE_CPUS=1.5
MAX_CONCURRENT_BUILDS=5
COMPILE_TIMEOUT=120

# Registration
DISABLE_SIGNUP=false

# Set to true if behind HTTPS (reverse proxy with TLS)
SECURE_COOKIES=false

# WebSocket — override the URL the frontend connects to
# (default: same hostname, port 3001)
# NEXT_PUBLIC_WS_URL=https://your-domain.com/ws

# Platform deployments (Dokploy, Coolify, etc.) — disables host port binding
# COMPOSE_FILE=docker-compose.yml
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Host port to expose the app on |
| `WS_PORT` | `3001` | Host port to expose the WebSocket server on |
| `SESSION_SECRET` | — | Secret key for signing session tokens (**required**) |
| `DATABASE_URL` | *(bundled postgres)* | Override to use an external PostgreSQL instance |
| `COMPILE_MEMORY` | `1g` | Memory limit per compile container |
| `COMPILE_CPUS` | `1.5` | CPU limit per compile container |
| `MAX_CONCURRENT_BUILDS` | `5` | Maximum simultaneous compilations |
| `COMPILE_TIMEOUT` | `120` | Compilation timeout in seconds |
| `DISABLE_SIGNUP` | `false` | Set to `true` to disable new user registration |
| `SECURE_COOKIES` | `false` | Set to `true` if serving over HTTPS (reverse proxy with TLS) |
| `NEXT_PUBLIC_WS_URL` | *(auto-detect)* | Override WebSocket server URL for the frontend (e.g. `wss://your-domain.com/ws`) |
| `COMPOSE_FILE` | *(unset)* | Set to `docker-compose.yml` to disable host port exposure (for platforms) |

---

## 🔌 REST API

Backslash includes a full REST API for programmatic access. Generate an API key from the **Developer Settings** page in the dashboard, then use it in the `Authorization` header.

### Quick Start

```bash
# Upload a .tex file and get a compiled PDF back
curl -X POST https://your-instance.com/api/v1/compile \
  -H "Authorization: Bearer bs_YOUR_API_KEY" \
  -F "file=@document.tex" \
  --output output.pdf

# Or get the result as base64 JSON
curl -X POST "https://your-instance.com/api/v1/compile?format=base64" \
  -H "Authorization: Bearer bs_YOUR_API_KEY" \
  -F "file=@document.tex"

# JSON body also works (source as a string)
curl -X POST https://your-instance.com/api/v1/compile \
  -H "Authorization: Bearer bs_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source": "\\documentclass{article}\n\\begin{document}\nHello!\n\\end{document}"}' \
  --output output.pdf
```

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/compile` | One-shot compile — upload `.tex` file or send JSON, get PDF back |
| `GET` | `/api/v1/projects` | List all projects |
| `POST` | `/api/v1/projects` | Create a project from template |
| `GET` | `/api/v1/projects/:id` | Get project details + files |
| `PUT` | `/api/v1/projects/:id` | Update project settings |
| `DELETE` | `/api/v1/projects/:id` | Delete a project |
| `GET` | `/api/v1/projects/:id/files` | List project files |
| `POST` | `/api/v1/projects/:id/files` | Create a file |
| `POST` | `/api/v1/projects/:id/files/upload` | Upload files (FormData) |
| `GET` | `/api/v1/projects/:id/files/:fileId` | Get file content |
| `PUT` | `/api/v1/projects/:id/files/:fileId` | Update file content |
| `DELETE` | `/api/v1/projects/:id/files/:fileId` | Delete a file |
| `POST` | `/api/v1/projects/:id/compile` | Trigger project compilation |
| `GET` | `/api/v1/projects/:id/pdf` | Download compiled PDF |
| `GET` | `/api/v1/projects/:id/builds` | Get build logs & status |

### API Key Management

- Navigate to **Dashboard → Developer Settings** (or the user menu → "API Keys")
- Create up to 10 API keys per account
- Keys can have optional expiration dates
- Full key is shown only once at creation — store it securely
- Revoke keys at any time from the dashboard

Full interactive API documentation is available at `/dashboard/developers/docs` after signing in.

---

## 🏗️ Architecture

```
backslash/
├── apps/
│   ├── web/              # Next.js 15 app (frontend + API)
│   ├── ws/               # Standalone WebSocket server (Socket.IO + Redis pub/sub)
│   └── worker/           # Background build worker (BullMQ)
├── packages/
│   └── shared/           # Shared types, constants, and utilities
├── docker/
│   ├── postgres/         # PostgreSQL init scripts
│   └── texlive/          # LaTeX compiler Docker image
├── templates/            # Built-in project templates
├── docker-compose.yml           # Production deployment (one-click)
├── docker-compose.override.yml  # Port exposure (auto-loaded, skip for platforms)
└── docker-compose.dev.yml       # Development services (PostgreSQL + Redis)
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, Tailwind CSS 4, CodeMirror 6, react-pdf |
| **Backend** | Next.js API Routes, BullMQ (job queue), Redis pub/sub |
| **Real-time** | Standalone Socket.IO server (WebSocket), Redis pub/sub bridge |
| **Database** | PostgreSQL 16 with Drizzle ORM |
| **Cache / Queue** | Redis 7 (session cache + BullMQ broker) |
| **Compilation** | Docker containers via dockerode (ephemeral, sandboxed, per-build) |
| **LaTeX** | TeX Live (full distribution) with latexmk |
| **Auth** | bcrypt password hashing, JWT session tokens, API key auth (SHA-256) |

---

## 🛠️ Development Setup

If you want to contribute or run Backslash locally for development:

**1. Clone and install:**

```bash
git clone https://github.com/Manan-Santoki/Backslash.git
cd Backslash
```

**2. Start dev services (PostgreSQL + Redis):**

```bash
docker compose -f docker-compose.dev.yml up -d
```

**3. Set up environment variables:**

Create `apps/web/.env`:

```env
DATABASE_URL=postgresql://backslash:devpassword@localhost:5432/backslash
REDIS_URL=redis://localhost:6379
STORAGE_PATH=./data
TEMPLATES_PATH=../../templates
COMPILER_IMAGE=backslash-compiler
SESSION_SECRET=dev-secret-change-in-production
```

**4. Push the database schema:**

```bash
cd apps/web && pnpm db:push
```

**5. Build the compiler Docker image:**

```bash
docker compose build compiler-image
```

**6. Start the dev server:**

```bash
cd apps/web && pnpm dev
```

**7.** Open [http://localhost:3000](http://localhost:3000)

---

## ⚙️ Configuration

### LaTeX Engines

Backslash supports the following LaTeX engines and auto-detects the appropriate one based on your document's packages:

| Engine | Flag | Auto-detected when |
|---|---|---|
| `pdflatex` | `-pdf` | Default engine |
| `xelatex` | `-xelatex` | `fontspec`, `unicode-math`, or `polyglossia` packages detected |
| `lualatex` | `-lualatex` | `luacode`, `luatextra` packages, or `\directlua` command detected |
| `latex` | `-pdfdvi` | Manual selection only |

### Templates

New projects can be initialized from the following built-in templates:

| Template | Description |
|---|---|
| **Blank** | Empty document with minimal preamble |
| **Article** | Standard academic article with sections |
| **Thesis** | Multi-chapter thesis with bibliography |
| **Beamer** | Slide presentation |
| **Letter** | Formal letter |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` / `⌘+S` | Save current file and compile |
| `Ctrl+Enter` / `⌘+Enter` | Compile project |

---

## 📁 Project Structure

```
apps/web/src/
├── app/                      # Next.js App Router pages
│   ├── page.tsx              # Landing page
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Global styles & theme variables
│   ├── (auth)/               # Auth pages (login, register)
│   ├── api/                  # API routes
│   │   ├── auth/             #   Authentication (login, logout, register, me)
│   │   ├── projects/         #   Projects (CRUD, files, compile, PDF, logs)
│   │   ├── keys/             #   API key management (create, list, revoke)
│   │   └── v1/              #   Public REST API (API key authenticated)
│   │       ├── compile/      #     One-shot TeX→PDF compilation
│   │       └── projects/     #     Projects, files, builds, PDF download
│   ├── dashboard/            # Project dashboard
│   │   ├── page.tsx          #   Project list
│   │   └── developers/       #   Developer settings & API docs
│   └── editor/[projectId]/   # LaTeX editor page
├── components/               # React components
│   ├── AppHeader.tsx         # Global header with user menu & theme toggle
│   ├── ThemeProvider.tsx     # Dark/light theme context provider
│   ├── editor/               # Editor-specific components
│   │   ├── BuildLogs.tsx     # Build output panel with error parsing
│   │   ├── CodeEditor.tsx    # CodeMirror 6 LaTeX editor
│   │   ├── EditorHeader.tsx  # Editor toolbar (compile, auto-compile toggle)
│   │   ├── EditorLayout.tsx  # Main editor layout with resizable panels
│   │   ├── EditorTabs.tsx    # Open file tab bar
│   │   ├── FileTree.tsx      # File explorer sidebar
│   │   └── PdfViewer.tsx     # PDF preview panel (react-pdf)
│   └── ui/                   # Shared UI primitives (Radix UI)
├── hooks/                    # Custom React hooks
│   ├── useCompiler.ts        # Compilation logic
│   ├── useEditorTabs.ts      # Tab management
│   ├── useFileTree.ts        # File tree state
│   ├── useProject.ts         # Project data fetching
│   └── useWebSocket.ts       # WebSocket connection management
├── lib/                      # Server-side libraries
│   ├── auth/                 # Authentication (config, middleware, sessions, API keys)
│   ├── compiler/             # Docker compilation engine
│   │   ├── docker.ts         # Container management & engine detection
│   │   ├── logParser.ts      # LaTeX log parsing & error extraction
│   │   ├── queue.ts          # BullMQ job queue
│   │   └── worker.ts         # Background compilation worker
│   ├── db/                   # Database layer
│   │   ├── index.ts          # Drizzle client
│   │   ├── schema.ts         # Database schema (users, sessions, projects, files, builds, API keys)
│   │   └── queries/          # Query helpers (users, projects, files)
│   ├── storage/              # File storage abstraction
│   ├── utils/                # Utilities (cn, errors, validation)
│   └── websocket/            # Real-time communication
│       ├── events.ts         # WebSocket event types & room helpers
│       └── server.ts         # Redis pub/sub broadcast (publishes build updates)
└── stores/                   # Zustand state stores
    ├── buildStore.ts         # Build state management
    └── editorStore.ts        # Editor state management
```

---

## 🔒 Security

- **Sandboxed compilation** — Each LaTeX build runs in an isolated Docker container with:
  - Network disabled (`NetworkDisabled: true`)
  - All Linux capabilities dropped (`CapDrop: ["ALL"]`)
  - `no-new-privileges` security option
  - PID limit of 256
  - Configurable memory and CPU limits
  - Automatic container removal after build completion
- **Authentication** — bcrypt password hashing with JWT session tokens (7-day expiry)
- **API key auth** — Keys are SHA-256 hashed before storage. Only the prefix (`bs_...`) is stored in plaintext for identification.
- **Input validation** — Zod schemas for all API inputs
- **Path traversal protection** — File paths are validated and sanitized
- **Rate limiting** — Configurable build rate limits per user

---

## 🗄️ Database Schema

Backslash uses PostgreSQL with Drizzle ORM. The schema includes:

- **users** — User accounts (email, name, password hash)
- **sessions** — Auth sessions with JWT tokens
- **projects** — LaTeX projects (name, description, engine, main file)
- **project_files** — File metadata (path, MIME type, size, directory flag)
- **builds** — Compilation history (status, engine, logs, duration, exit code)
- **api_keys** — API keys (hashed key, prefix, usage stats, expiration)

The database schema is automatically applied when deploying with Docker Compose.

---

## � Acknowledgments

Backslash is built on the shoulders of incredible open-source projects. We're grateful to every maintainer and contributor behind them.

### Core Framework

| Project | Description | License |
|---|---|---|
| [Next.js](https://nextjs.org/) | React framework for production — App Router, API routes, SSR | MIT |
| [React](https://react.dev/) | UI library | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Typed JavaScript | Apache-2.0 |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first CSS framework | MIT |
| [Node.js](https://nodejs.org/) | JavaScript runtime | MIT |

### Editor & UI

| Project | Description | License |
|---|---|---|
| [CodeMirror 6](https://codemirror.net/) | Extensible code editor component (syntax highlighting, autocomplete, search) | MIT |
| [Radix UI](https://www.radix-ui.com/) | Unstyled, accessible UI primitives (dialog, dropdown, tooltip, tabs, etc.) | MIT |
| [Lucide](https://lucide.dev/) | Beautiful open-source icon set | ISC |
| [react-pdf](https://github.com/wojtekmaj/react-pdf) | PDF viewer for React (powered by PDF.js) | MIT |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | Draggable resizable panel layouts | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | Lightweight state management | MIT |
| [class-variance-authority](https://cva.style/) | Component variant utility | Apache-2.0 |
| [clsx](https://github.com/lukeed/clsx) / [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Class name utilities | MIT |

### Backend & Database

| Project | Description | License |
|---|---|---|
| [PostgreSQL](https://www.postgresql.org/) | Relational database | PostgreSQL License |
| [Drizzle ORM](https://orm.drizzle.team/) | TypeScript ORM with zero overhead | Apache-2.0 |
| [postgres.js](https://github.com/porsager/postgres) | Fastest PostgreSQL client for Node.js | Unlicense |
| [Redis](https://redis.io/) | In-memory data store for caching and queuing | BSD-3-Clause |
| [BullMQ](https://docs.bullmq.io/) | Job queue for Node.js built on Redis | MIT |
| [ioredis](https://github.com/redis/ioredis) | Redis client for Node.js | MIT |
| [Socket.IO](https://socket.io/) | Real-time WebSocket communication (standalone server) | MIT |

### Compilation & Containers

| Project | Description | License |
|---|---|---|
| [TeX Live](https://tug.org/texlive/) | Comprehensive TeX distribution | [Free Software](https://tug.org/texlive/copying.html) |
| [latexmk](https://personal.psu.edu/~jcc8/software/latexmk/) | Automated LaTeX document generation | GPL-2.0 |
| [Docker](https://www.docker.com/) | Container platform for sandboxed builds | Apache-2.0 |
| [dockerode](https://github.com/apocas/dockerode) | Docker Remote API client for Node.js | Apache-2.0 |

### Auth & Security

| Project | Description | License |
|---|---|---|
| [bcrypt.js](https://github.com/dcodeIO/bcrypt.js) | Password hashing | MIT |
| [jose](https://github.com/panva/jose) | JWT / JWS / JWE implementation | MIT |
| [Zod](https://zod.dev/) | TypeScript-first schema validation | MIT |

### Tooling

| Project | Description | License |
|---|---|---|
| [pnpm](https://pnpm.io/) | Fast, disk-efficient package manager | MIT |
| [PostCSS](https://postcss.org/) | CSS transformations | MIT |
| [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview) | Database migration toolkit | Apache-2.0 |
| [Archiver](https://github.com/archiverjs/node-archiver) | Streaming archive generation | MIT |
| [uuid](https://github.com/uuidjs/uuid) | RFC-compliant UUID generation | MIT |

---

Special thanks to the entire open-source community. If we've used your project and missed listing it here, please open an issue — we'd love to add it.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built with ❤️ and open-source software.
</p>
