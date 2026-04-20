# Changelog

All notable changes to Backslash are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-20

First tagged release. Focuses on making the hosted-deploy story safe:
account recovery works end-to-end, changing an account's email is
authenticated, and AI provider keys are no longer stored plaintext.

### Added
- **Forgot-password flow.** `/forgot` and `/reset/[token]` pages, plus
  `POST /api/auth/forgot` and `POST /api/auth/reset`. Tokens are
  hashed (SHA-256) and expire in 30 minutes. `/api/auth/forgot` always
  returns 200 to avoid email-enumeration signals.
- **Email transport.** Nodemailer-based SMTP sender with a stdout
  fallback when `SMTP_HOST` / `SMTP_PORT` are unset — handy for local
  dev and for probing the flow before wiring a provider.
- **Password-prompt dialog.** Small reusable component for any action
  that needs password re-confirmation.
- `password_reset_tokens` table (migration `0004_password_resets.sql`).

### Changed
- **AI API keys are now encrypted at rest** (AES-256-GCM; key derived
  from `SESSION_SECRET` via scrypt). Existing plaintext rows still
  decrypt transparently and are re-encrypted the next time the user
  saves settings, so no data migration is required.
- **Changing email now requires the current password.** `PUT
  /api/auth/profile` rejects an email change without `currentPassword`;
  name-only updates are unchanged. The settings page opens a password
  prompt before submitting.
- **PDF → source highlighting** picks the correct occurrence. Selecting
  text in the PDF used to jump to the first match of that word in the
  source even if you highlighted the third one. `PdfViewer` now sends
  ±80 chars of surrounding PDF text; `CodeEditor` scores each candidate
  match by how well the source context (with LaTeX commands stripped)
  aligns with the PDF context.
- **Middleware.** `/forgot` and `/reset/*` are now public routes (they
  previously bounced to `/login?redirect=…`).
- **Settings copy.** The AI API-key label no longer says "Optional";
  the help text now explains the user-key vs env-fallback model.
- Upgraded Next.js to 15.5.15 and drizzle-orm to 0.45.2.

### Fixed
- **Landing footer** stays pinned to the viewport bottom when the page
  is shorter than the window (zoom-out no longer floats it mid-page).
- **docker-compose** now passes `APP_URL` and all `SMTP_*` env vars
  through to the `app` service — previously set env vars never
  reached the container, so reset links defaulted to `http://` and
  SMTP reported "not configured" even when provided.

### Security
- AI provider keys (OpenAI, OpenRouter, Anthropic, custom) are encrypted
  at rest with a per-row IV. Stored values now carry an `enc:v1:` prefix.
- Rotating `SESSION_SECRET` will invalidate stored AI keys (they become
  undecryptable). Keep it stable; if you must rotate, wipe
  `user_ai_settings.build_api_key` / `writer_api_key` and have users
  re-enter their keys.

### Upgrading

These steps assume you are running the Docker Compose stack. If you
deploy through Dokploy / Coolify / Portainer, redeploy the stack so
the new `docker-compose.yml` takes effect (a restart alone won't pick
up the env-passthrough additions).

1. **Set new env vars** before deploy:
   - `APP_URL` — your public URL (e.g. `https://backslash.example.com`).
     Used to build absolute links in password-reset emails.
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`
     — required for emails to actually send. Without them, reset links
     print to container stdout.
2. **Keep `SESSION_SECRET` stable.** It now also keys AI-key encryption.
3. Redeploy. Migration `0004_password_resets` runs automatically.
4. Verify: open `/forgot`, submit a known account's email, confirm the
   reset email arrives (or appears in `docker compose logs app`).
