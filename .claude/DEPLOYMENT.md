# NewsHive — Deployment Guide (Coolify)

---

## Prerequisites

- Coolify instance running (self-hosted)
- VPS: minimum 4 vCPU / 8GB RAM / 100GB SSD
- Domain: newshive.geekybee.net configured with DNS pointing to VPS
- Wildcard SSL or individual certs via Coolify's Let's Encrypt integration

---

## Services (Deploy in This Order)

### 1. PostgreSQL

```yaml
# Coolify: Add Database → PostgreSQL 16

Name:       newshive-postgres
Database:   newshive
Username:   newshive_user
Password:   [strong random password]
Port:       5432 (internal only — do not expose publicly)
```

After deployment, run schema:

```bash
# Connect via Coolify terminal or SSH
psql -U newshive_user -d newshive -f /path/to/schema.sql

# Install pgvector
psql -U newshive_user -d newshive -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -U newshive_user -d newshive -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
```

### 2. Redis

```yaml
# Coolify: Add Database → Redis 7

Name:       newshive-redis
Password:   [strong random password]
Port:       6379 (internal only)
```

### 3. N8N

```yaml
# Coolify: Add Service → N8N

Name:           newshive-n8n
Domain:         n8n.newshive.geekybee.net (or internal only)
Port:           5678

Environment Variables:
  N8N_BASIC_AUTH_ACTIVE:    true
  N8N_BASIC_AUTH_USER:      admin
  N8N_BASIC_AUTH_PASSWORD:  [strong password]
  DB_TYPE:                  postgresdb
  DB_POSTGRESDB_HOST:       newshive-postgres
  DB_POSTGRESDB_PORT:       5432
  DB_POSTGRESDB_DATABASE:   n8n
  DB_POSTGRESDB_USER:       newshive_user
  DB_POSTGRESDB_PASSWORD:   [postgres password]
  EXECUTIONS_DATA_PRUNE:    true
  EXECUTIONS_DATA_MAX_AGE:  720
  N8N_ENCRYPTION_KEY:       [random 32-char string]
  WEBHOOK_URL:              https://n8n.newshive.geekybee.net/
```

Create a separate `n8n` database in PostgreSQL for N8N's own data.

### 4. Python Synthesis Service

```dockerfile
# Dockerfile for Python service

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```txt
# requirements.txt
fastapi
uvicorn
asyncpg
redis
anthropic
openai
google-generativeai
sentence-transformers
httpx
python-dotenv
cryptography
```

```yaml
# Coolify: Add Application → Docker

Name:         newshive-python
Port:         8000 (internal only — accessed by N8N and Next.js)
Domain:       [none — internal service only]

Environment Variables:
  DATABASE_URL:         postgresql://newshive_user:[pass]@newshive-postgres:5432/newshive
  REDIS_URL:            redis://:[pass]@newshive-redis:6379
  ANTHROPIC_API_KEY:    [key]
  OPENAI_API_KEY:       [key]
  GOOGLE_AI_API_KEY:    [key]
  PERPLEXITY_API_KEY:   [key]
  ELEVENLABS_API_KEY:   [key]
  HEYGEN_API_KEY:       [key]
  HEYGEN_AVATAR_ID:     [id]
  HEYGEN_VOICE_ID:      [elevenlabs voice id for heygen]
  HONEYPOT_ENCRYPTION_KEY: [64-char hex string]
```

### 5. Next.js Application (HiveDeck + Public)

```yaml
# Coolify: Add Application → Next.js (or Docker)

Name:         newshive-nextjs
Domain:       newshive.geekybee.net
Port:         3000

Environment Variables:
  DATABASE_URL:             [postgres url]
  REDIS_URL:                [redis url]
  PYTHON_SERVICE_URL:       http://newshive-python:8000
  NEXTAUTH_SECRET:          [random 32-char string]
  NEXTAUTH_URL:             https://newshive.geekybee.net
  DASHBOARD_PASSWORD_HASH:  [bcrypt hash of dashboard password]
  HONEYPOT_ENCRYPTION_KEY:  [same as python service]
  # Publishing APIs
  META_APP_ID:              [id]
  META_APP_SECRET:          [secret]
  META_ACCESS_TOKEN:        [token]
  INSTAGRAM_BUSINESS_ID:    [id]
  FACEBOOK_PAGE_ID:         [id]
  LINKEDIN_ACCESS_TOKEN:    [token]
  X_API_KEY:                [key]
  X_API_SECRET:             [secret]
  X_ACCESS_TOKEN:           [token]
  X_ACCESS_SECRET:          [secret]
  YOUTUBE_CLIENT_ID:        [id]
  YOUTUBE_CLIENT_SECRET:    [secret]
  NEWS_API_KEY:             [key]
```

### 6. Tor Hidden Service (The Honeypot)

```yaml
# Docker Compose for Tor service
# Deploy as custom Docker application in Coolify

version: '3.8'
services:
  tor:
    image: dperson/torproxy:latest
    environment:
      - HIDDENSERVICE=newshive-nextjs:3000
    volumes:
      - tor-data:/var/lib/tor
    networks:
      - coolify  # Must be on same network as nextjs

volumes:
  tor-data:
```

After deployment, retrieve .onion address:

```bash
docker exec [tor-container] cat /var/lib/tor/hidden_service/hostname
# Outputs: [random].onion
```

Add this .onion address to the Honeypot public page.

---

## Directory Structure (Application Code)

```
newshive/
├── apps/
│   ├── nextjs/                    Next.js application
│   │   ├── app/
│   │   │   ├── (dashboard)/       Auth-protected dashboard routes
│   │   │   │   ├── dashboard/
│   │   │   │   ├── dashboard/packs/
│   │   │   │   ├── dashboard/alerts/
│   │   │   │   ├── dashboard/submissions/
│   │   │   │   ├── dashboard/sources/
│   │   │   │   ├── dashboard/trajectories/
│   │   │   │   └── dashboard/monthly/
│   │   │   ├── (public)/          Public-facing routes
│   │   │   │   ├── blog/
│   │   │   │   └── honeypot/      Secure submission (no analytics)
│   │   │   └── api/
│   │   │       ├── feeds/         RSS feed generation
│   │   │       ├── v1/            HiveAPI
│   │   │       └── webhooks/      N8N → Next.js callbacks
│   │   └── ...
│   │
│   └── python/                    Python synthesis service
│       ├── main.py                FastAPI app
│       ├── routers/
│       │   ├── ingest.py
│       │   ├── embed.py
│       │   ├── score.py
│       │   ├── synthesise.py
│       │   ├── draft.py
│       │   ├── verdict.py
│       │   ├── hivecast.py
│       │   └── monthly.py
│       ├── services/
│       │   ├── anthropic_service.py
│       │   ├── openai_service.py
│       │   ├── heygen_service.py
│       │   └── elevenlabs_service.py
│       └── ...
│
├── n8n/
│   └── workflows/                 Exported N8N workflow JSON files
│       ├── rss_poller.json
│       ├── hn_monitor.json
│       ├── reddit_monitor.json
│       ├── alert_monitor.json
│       ├── publisher.json
│       └── monthly_report.json
│
└── docs/                          This documentation
    ├── OVERVIEW.md
    ├── ARCHITECTURE.md
    └── ...
```

---

## Build Order for Claude Code

Build in this sequence. Each phase is independently deployable.

```
PHASE 1 — Foundation (Week 1-2)
  □ PostgreSQL schema (DATABASE.md)
  □ Python service skeleton (FastAPI + DB connection)
  □ Basic ingestion: RSS poller → signals table
  □ Embedding pipeline (text-embedding-3-large)
  □ Redis dedup cache

PHASE 2 — Intelligence (Week 3-4)
  □ Importance scoring (Claude API calls)
  □ Cluster assignment (pgvector similarity)
  □ Readiness threshold calculation
  □ Alert candidate detection
  □ Reality check pipeline

PHASE 3 — Source System (Week 5)
  □ Source tokens table
  □ Honeypot submission form (no analytics, Tor-compatible)
  □ One-time verdict (Claude API)
  □ Instant corroboration check
  □ Pinch of Salt routing

PHASE 4 — Content Generation (Week 6-7)
  □ Content pack creation
  □ Per-platform draft generation (Claude API)
  □ HiveCast script generation
  □ HiveDeck dashboard (Next.js)
  □ Pack approval workflow

PHASE 5 — Distribution (Week 8-9)
  □ Social API integrations (Meta, LinkedIn, X)
  □ Blog post publishing
  □ RSS feed generation
  □ HeyGen video generation
  □ YouTube / Reels / LinkedIn Video upload

PHASE 6 — Intelligence Layer (Week 10-12)
  □ Trajectory management
  □ Monthly report synthesis
  □ HiveAPI (public endpoints)
  □ Webhook notifications
  □ Source reputation tier calculation

PHASE 7 — Hardening (Week 13+)
  □ Tor hidden service
  □ Content encryption
  □ Rate limiting
  □ Error handling and alerting
  □ Monitoring (Coolify built-in + custom)
```

---

## Monitoring

```yaml
# Coolify provides basic monitoring out of the box
# Additional monitoring recommended:

Uptime:    Coolify health checks on all services
Errors:    Application error logging → Coolify logs
Queue:     BullMQ dashboard (optional: bull-board package)
DB:        pg_stat_activity for query monitoring
Alerts:    Operator email notification on service failure
```

---

## Backup Policy

```bash
# Daily PostgreSQL backup (cron via Coolify or VPS cron)
pg_dump -U newshive_user newshive | gzip > backup_$(date +%Y%m%d).sql.gz

# Retain: 7 daily, 4 weekly, 12 monthly
# Store: offsite (S3, Backblaze B2, or similar)

# Critical: The source_tokens table must never be lost
# It contains the anonymous track record of all sources
# It contains no identifying information — it is safe to back up
```
