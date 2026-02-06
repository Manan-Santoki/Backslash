# ── LeafEdit ─────────────────────────────────────────

.PHONY: dev dev-services dev-app build up down logs migrate pull-texlive install backup

# Start development services (PostgreSQL + Redis)
dev-services:
	docker compose -f docker-compose.dev.yml up -d

# Start development app server
dev-app:
	cd apps/web && npm run dev

# Start full development environment
dev: dev-services dev-app

# Build production Docker images
build:
	docker compose build

# Start production services
up:
	docker compose up -d

# Stop all services
down:
	docker compose down

# View logs
logs:
	docker compose logs -f

# Run database migrations
migrate:
	cd apps/web && npm run db:push

# Pull latest TexLive Docker image
pull-texlive:
	docker pull texlive/texlive:latest

# Install web app dependencies
install:
	cd apps/web && npm install

# Backup PostgreSQL data
backup:
	docker compose exec postgres pg_dump -U leafedit leafedit > backup_$(shell date +%Y%m%d_%H%M%S).sql
