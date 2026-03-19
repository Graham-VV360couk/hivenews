# NewsHive

Technology intelligence platform covering AI, VR/AR, Vibe Coding, and SEO.

**URL:** newshive.geekybee.net
**Parent brand:** GeekyBee

## Documentation

All design and implementation documentation is in `.claude/`:

- `CLAUDE_CODE.md` — start here before writing any code
- `OVERVIEW.md` — platform vision and philosophy
- `ARCHITECTURE.md` — system design and stack
- `DEPLOYMENT.md` — Coolify deployment guide and build order
- `DATABASE.md` — full schema

## Quick Start

```bash
cp .env.example .env
# Fill in .env with your values

# Run database migrations
python apps/python/scripts/migrate.py

# Start Python service
cd apps/python && uvicorn main:app --reload --port 8000

# Start Next.js
cd apps/nextjs && npm run dev
```

## Services

| Service | Description | Port |
|---------|-------------|------|
| `newshive-nextjs` | Dashboard (HiveDeck) + public site | 3000 |
| `newshive-python` | AI synthesis service | 8000 (internal) |
| `newshive-postgres` | PostgreSQL 16 + pgvector | 5432 (internal) |
| `newshive-redis` | Cache + job queue | 6379 (internal) |
| `newshive-n8n` | Workflow orchestration | 5678 |
| `newshive-tor` | Tor hidden service (Honeypot) | internal |

## Deployment

Deployed via Coolify. Each service configured independently:

- `apps/nextjs/Dockerfile` — Next.js app (requires `output: 'standalone'` in next.config.js)
- `apps/python/Dockerfile` — Python synthesis service
- Postgres, Redis, N8N — Coolify built-in service templates
- Tor — custom Docker service

See `.claude/DEPLOYMENT.md` for full Coolify configuration.
