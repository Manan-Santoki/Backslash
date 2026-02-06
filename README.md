<h1 align="center">🍃 LeafEdit</h1>
<p align="center"><strong>Self-hostable, open-source LaTeX editor with live PDF preview.</strong></p>
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
- **User Authentication** — Session-based auth with secure password hashing (bcrypt) and JWT session tokens.
- **Dark & Light Themes** — Toggle between dark and light mode with a single click.
- **Self-Hostable** — Deploy on your own server with Docker Compose. Full control over your data and privacy.
- **No Limits** — No file size caps, no compile timeouts (configurable), no project restrictions. Your server, your rules.
- **Open Source** — Fully open-source under the MIT license.

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
├── docker-compose.yml    # Production deployment
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
| **Auth** | bcrypt password hashing, JWT session tokens (jose) |

---

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js](https://nodejs.org/) 22+ (for development only)
- [PostgreSQL](https://www.postgresql.org/) 16+ (provided via Docker in development)

### Development Setup

**1. Clone the repository:**

```bash
git clone https://github.com/your-username/leafedit.git
cd leafedit
```

**2. Start development services (PostgreSQL + Redis):**

```bash
make dev-services
# or manually:
docker compose -f docker-compose.dev.yml up -d
```

**3. Install dependencies:**

```bash
make install
# or manually:
cd apps/web && npm install
```

**4. Set up environment variables:**

Create a `.env` file in `apps/web/`:

```env
DATABASE_URL=postgresql://leafedit:devpassword@localhost:5432/leafedit
REDIS_URL=redis://localhost:6379
STORAGE_PATH=./data
TEMPLATES_PATH=../../templates
COMPILER_IMAGE=leafedit-compiler
SESSION_SECRET=change-me-to-a-random-64-char-string
```

**5. Push the database schema:**

```bash
make migrate
# or manually:
cd apps/web && npm run db:push
```

**6. Build the compiler Docker image:**

```bash
docker compose build compiler-image
```

**7. Start the development server:**

```bash
make dev-app
# or manually:
cd apps/web && npm run dev
```

**8. Open your browser:** Navigate to [http://localhost:3000](http://localhost:3000)

---

### Production Deployment

**1. Configure environment variables:**

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://user:password@your-db-host:5432/leafedit
SESSION_SECRET=<random-64-character-string>

# Optional configuration
COMPILE_MEMORY=1g
COMPILE_CPUS=1.5
MAX_CONCURRENT_BUILDS=5
COMPILE_TIMEOUT=120
DISABLE_SIGNUP=false
```

**2. Deploy with Docker Compose:**

```bash
docker compose up -d
```

This will:

- Build the `leafedit-compiler` image (TeX Live with latexmk)
- Build and start the web application
- Start Redis for caching and job queuing

> **Note:** You need to provide your own PostgreSQL database for production. The `docker-compose.dev.yml` file includes a PostgreSQL container for development only.

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string (**required**) |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `STORAGE_PATH` | `/data/leafedit` | Path for project file storage |
| `TEMPLATES_PATH` | `/app/templates` | Path to built-in LaTeX templates |
| `COMPILER_IMAGE` | `leafedit-compiler` | Docker image used for compilation |
| `SESSION_SECRET` | — | Secret key for signing session tokens (**required**) |
| `COMPILE_MEMORY` | `1g` | Memory limit per compile container |
| `COMPILE_CPUS` | `1.5` | CPU limit per compile container |
| `MAX_CONCURRENT_BUILDS` | `5` | Maximum simultaneous compilations |
| `COMPILE_TIMEOUT` | `120` | Compilation timeout in seconds |
| `DISABLE_SIGNUP` | `false` | Set to `true` to disable new user registration |

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

## 🛠️ Make Commands

| Command | Description |
|---|---|
| `make dev` | Start full dev environment (services + app) |
| `make dev-services` | Start PostgreSQL + Redis containers |
| `make dev-app` | Start Next.js development server |
| `make build` | Build production Docker images |
| `make up` | Start production services |
| `make down` | Stop all services |
| `make logs` | Tail production logs |
| `make migrate` | Push database schema changes |
| `make install` | Install web app dependencies |
| `make pull-texlive` | Pull latest TeX Live Docker image |
| `make backup` | Backup PostgreSQL database to a SQL file |

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
│   │   └── projects/         #   Projects (CRUD, files, compile, PDF, logs)
│   ├── dashboard/            # Project dashboard
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
│   ├── auth/                 # Authentication (config, middleware, sessions)
│   ├── compiler/             # Docker compilation engine
│   │   ├── docker.ts         # Container management & engine detection
│   │   ├── logParser.ts      # LaTeX log parsing & error extraction
│   │   ├── queue.ts          # BullMQ job queue
│   │   └── worker.ts         # Background compilation worker
│   ├── db/                   # Database layer
│   │   ├── index.ts          # Drizzle client
│   │   ├── schema.ts         # Database schema (users, sessions, projects, files, builds)
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

Run `make migrate` (or `cd apps/web && npm run db:push`) to apply the schema.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built with ❤️ using Next.js, Docker, and TeX Live.
</p>
