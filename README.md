<h1 align="center">🍃 LeafEdit</h1>
<p align="center"><strong>Self-hostable, open-source LaTeX editor with live PDF preview and a full REST API.</strong></p>
<p align="center">Write beautiful documents with a modern editing experience — on your own infrastructure.</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Next.js-15-black" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED" alt="Docker" />
</p>

---

## ✨ Features

- **Live PDF Preview** — See your document update in real-time as you type. Auto-compilation on save with WebSocket-powered status updates.
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

### Option A — External / Hosted PostgreSQL (recommended)

If you already have a PostgreSQL database (e.g. Neon, Supabase, AWS RDS, or a remote server):

```bash
git clone https://github.com/your-username/leafedit.git
cd leafedit
cp .env.example .env
```

Edit `.env` and set your `DATABASE_URL`:

```env
DATABASE_URL=postgresql://user:password@your-host:5432/leafedit
SESSION_SECRET=change-me-to-a-random-64-char-string
```

Then start:

```bash
docker compose up -d
```

### Option B — Built-in PostgreSQL via Docker

If you want Docker Compose to manage PostgreSQL for you:

```bash
git clone https://github.com/your-username/leafedit.git
cd leafedit
cp .env.example .env
```

Edit `.env` and set your postgres credentials (leave `DATABASE_URL` commented out):

```env
POSTGRES_USER=leafedit
POSTGRES_PASSWORD=change-me-to-a-strong-password
POSTGRES_DB=leafedit
SESSION_SECRET=change-me-to-a-random-64-char-string
```

Then start with the `postgres` profile:

```bash
docker compose --profile postgres up -d
```

### That's it

Open [http://localhost:3000](http://localhost:3000) and create your account.

Docker Compose automatically:
- Builds the TeX Live compiler image
- Starts Redis 7 for caching and job queuing
- Builds and launches the web application
- *(Profile postgres)* Starts PostgreSQL 16 with persistent storage

### Environment Variables

Create a `.env` file in the project root (or edit the one from `.env.example`):

```env
# Server
PORT=3000
SESSION_SECRET=change-me-to-a-random-64-char-string

# Database — pick ONE of:
# Option A: External database
DATABASE_URL=postgresql://user:password@your-host:5432/leafedit
# Option B: Built-in Docker PostgreSQL (use --profile postgres)
POSTGRES_USER=leafedit
POSTGRES_PASSWORD=leafedit
POSTGRES_DB=leafedit

# Compilation (optional)
COMPILE_MEMORY=1g
COMPILE_CPUS=1.5
MAX_CONCURRENT_BUILDS=5
COMPILE_TIMEOUT=120

# Registration
DISABLE_SIGNUP=false
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the web app listens on |
| `SESSION_SECRET` | — | Secret key for signing session tokens (**required**) |
| `DATABASE_URL` | — | Full PostgreSQL connection string (if using external DB) |
| `POSTGRES_USER` | `leafedit` | PostgreSQL username (if using built-in DB) |
| `POSTGRES_PASSWORD` | `leafedit` | PostgreSQL password (if using built-in DB) |
| `POSTGRES_DB` | `leafedit` | PostgreSQL database name (if using built-in DB) |
| `COMPILE_MEMORY` | `1g` | Memory limit per compile container |
| `COMPILE_CPUS` | `1.5` | CPU limit per compile container |
| `MAX_CONCURRENT_BUILDS` | `5` | Maximum simultaneous compilations |
| `COMPILE_TIMEOUT` | `120` | Compilation timeout in seconds |
| `DISABLE_SIGNUP` | `false` | Set to `true` to disable new user registration |

---

## 🔌 REST API

LeafEdit includes a full REST API for programmatic access. Generate an API key from the **Developer Settings** page in the dashboard, then use it in the `Authorization` header.

### Quick Start

```bash
# Upload a .tex file and get a compiled PDF back
curl -X POST https://your-instance.com/api/v1/compile \
  -H "Authorization: Bearer le_YOUR_API_KEY" \
  -F "file=@document.tex" \
  --output output.pdf

# Or get the result as base64 JSON
curl -X POST "https://your-instance.com/api/v1/compile?format=base64" \
  -H "Authorization: Bearer le_YOUR_API_KEY" \
  -F "file=@document.tex"

# JSON body also works (source as a string)
curl -X POST https://your-instance.com/api/v1/compile \
  -H "Authorization: Bearer le_YOUR_API_KEY" \
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
leafedit/
├── apps/
│   ├── web/              # Next.js 15 app (frontend + API + WebSocket server)
│   └── worker/           # Background build worker (BullMQ)
├── packages/
│   └── shared/           # Shared types, constants, and utilities
├── docker/
│   ├── postgres/         # PostgreSQL init scripts
│   └── texlive/          # LaTeX compiler Docker image
├── templates/            # Built-in project templates
├── docker-compose.yml    # Production deployment (one-click)
└── docker-compose.dev.yml # Development services (PostgreSQL + Redis)
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, Tailwind CSS 4, CodeMirror 6, react-pdf |
| **Backend** | Next.js API Routes, Socket.IO (WebSocket), BullMQ (job queue) |
| **Database** | PostgreSQL 16 with Drizzle ORM |
| **Cache / Queue** | Redis 7 (session cache + BullMQ broker) |
| **Compilation** | Docker containers via dockerode (ephemeral, sandboxed, per-build) |
| **LaTeX** | TeX Live (full distribution) with latexmk |
| **Auth** | bcrypt password hashing, JWT session tokens, API key auth (SHA-256) |

---

## 🛠️ Development Setup

If you want to contribute or run LeafEdit locally for development:

**1. Clone and install:**

```bash
git clone https://github.com/your-username/leafedit.git
cd leafedit
cd apps/web && pnpm install
```

**2. Start dev services (PostgreSQL + Redis):**

```bash
docker compose -f docker-compose.dev.yml up -d
```

**3. Set up environment variables:**

Create `apps/web/.env`:

```env
DATABASE_URL=postgresql://leafedit:devpassword@localhost:5432/leafedit
REDIS_URL=redis://localhost:6379
STORAGE_PATH=./data
TEMPLATES_PATH=../../templates
COMPILER_IMAGE=leafedit-compiler
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

LeafEdit supports the following LaTeX engines and auto-detects the appropriate one based on your document's packages:

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
│       └── server.ts         # Socket.IO server initialization
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
- **API key auth** — Keys are SHA-256 hashed before storage. Only the prefix (`le_...`) is stored in plaintext for identification.
- **Input validation** — Zod schemas for all API inputs
- **Path traversal protection** — File paths are validated and sanitized
- **Rate limiting** — Configurable build rate limits per user

---

## 🗄️ Database Schema

LeafEdit uses PostgreSQL with Drizzle ORM. The schema includes:

- **users** — User accounts (email, name, password hash)
- **sessions** — Auth sessions with JWT tokens
- **projects** — LaTeX projects (name, description, engine, main file)
- **project_files** — File metadata (path, MIME type, size, directory flag)
- **builds** — Compilation history (status, engine, logs, duration, exit code)
- **api_keys** — API keys (hashed key, prefix, usage stats, expiration)

The database schema is automatically applied when deploying with Docker Compose.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built with ❤️ using Next.js, Docker, and TeX Live.
</p>
