# NewsHive — Claude Code Instructions

This is the primary instruction file for Claude Code. Read this first, then read the referenced documentation files before writing any code.

---

## What You Are Building

NewsHive is a technology intelligence platform that monitors live sources across AI, VR/AR, Vibe Coding, and SEO domains. It synthesises signals using multiple AI models, scores their importance, generates content in the operator's voice across multiple platforms, and publishes via a secure, automated pipeline.

It is not a simple content scheduler. It is a living knowledge system with editorial intelligence built in.

**Read before coding:**
1. `OVERVIEW.md` — vision and philosophy
2. `ARCHITECTURE.md` — system design and stack
3. `DATABASE.md` — full schema (implement exactly as specified)
4. `INGESTION.md` — sources and N8N workflows
5. `SCORING.md` — all scoring algorithms
6. `SOURCES.md` — source token system and Honeypot routing
7. `SECURE_SUBMISSION.md` — Honeypot technical implementation
8. `CONTENT.md` — voice guide and per-platform formats
9. `BROADCAST.md` — HeyGen integration
10. `OUTPUT_FEEDS.md` — RSS and API
11. `MONTHLY.md` — monthly report system
12. `DASHBOARD.md` — HiveDeck interface
13. `DEPLOYMENT.md` — Coolify deployment and build order

---

## Stack

```
PostgreSQL 16 + pgvector    Primary database
Redis 7                     Queue and cache
N8N                         Workflow orchestration
Python 3.11 + FastAPI       Synthesis service
Next.js 14 + TypeScript     Dashboard and public site
Docker                      All services containerised
Coolify                     Deployment platform
```

---

## Critical Design Decisions

These are non-negotiable. Do not deviate from them.

### 1. The Honeypot — Privacy is Absolute

The secure submission system must:
- Never log IP addresses at any layer (Nginx, application, database)
- Never store questionnaire answers after verdict is returned
- Never store any information that could identify a source
- Serve no third-party scripts, fonts, or analytics on Honeypot pages
- Generate tokens client-side using a method that prevents timing inference
- Encrypt submission content at rest (AES-256-GCM)

The verdict prompt must instruct Claude to return JSON only. After the verdict is received and stored, the questionnaire answers must be explicitly deleted from memory and must never appear in logs.

### 2. Confidence Labels Are Editorial, Not Technical

The confidence system (CONFIRMED / DEVELOPING / PINCH OF SALT) must be treated as an editorial decision, not a database flag. The scoring system recommends — the operator decides. Never auto-publish at CONFIRMED without operator approval.

### 3. No Source is Ever Removed

The source token system has no delete functionality for operator-facing interfaces. Tokens can be tier-downgraded but never removed. The track record is permanent. This is by design — see `SOURCES.md`.

### 4. The Blog Post is Always Canonical

Every content pack must produce a blog post first. All other platform drafts are derived from or complementary to the blog post. The blog post URL appears in all social posts.

### 5. Alert Rate Limiting is Enforced

Maximum 2 alerts per domain per week. This is not a soft suggestion — it is a hard constraint in the alert detection logic. See `SCORING.md`.

### 6. Monthly Report Releases at 08:00 GMT on the 1st

The scheduling must be reliable. Use a cron job or N8N scheduled trigger. The report must be staged and ready before 08:00 — the release is automated after operator approval on the 31st.

---

## Decisions Claude Code Should Make Independently

These areas are intentionally left flexible. Use good engineering judgement:

- Specific Next.js component structure and naming
- API route organisation within the specified endpoint structure
- Internal Python service method organisation
- Redis key naming conventions (follow `entity:id` pattern)
- Error message wording and logging detail
- CSS / styling approach for HiveDeck (functional over beautiful — this is an internal tool)
- Test file structure and coverage approach
- TypeScript type definitions

---

## Decisions That Require Operator Input Before Proceeding

Stop and ask if you encounter:

- Any change to the database schema that adds new columns to `source_tokens` that could identify a source
- Any logging that would capture Honeypot submission content or questionnaire answers
- Any change to the alert rate limiting thresholds
- Any automatic publishing without operator approval step
- Anything that would make the Honeypot accessible to crawlers or indexing
- HeyGen avatar configuration (operator must provide HEYGEN_AVATAR_ID)
- ElevenLabs voice ID (operator must provide after voice cloning)

---

## Build Order

Follow the phased approach in `DEPLOYMENT.md`. Do not skip phases.

**Phase 1 is the foundation everything else depends on.**

Start with:
1. `DATABASE.md` schema — implement exactly as written, run migrations
2. Python FastAPI skeleton with database connection
3. RSS ingestion → signals table
4. Embedding pipeline

Do not begin Phase 2 until Phase 1 is running and ingesting real signals.

---

## Testing Approach

### Phase 1 Tests
- Signals are ingested from at least 3 RSS sources
- Deduplication correctly prevents duplicate URL ingestion
- Embeddings are generated and stored (check vector dimensions match)
- Redis dedup cache correctly expires after 7 days

### Phase 2 Tests
- Importance scoring returns values in 0-10 range for all axes
- Alert candidates are only created when composite > 8.0
- Reality check correctly flags `too_good_to_be_true` when magnitude > 9.5 and sources < 2
- Cluster readiness recalculates correctly after each signal ingestion

### Phase 3 Tests
- Honeypot form submits without logging IP to any log file
- Token is generated and stored before questionnaire answers are deleted
- Verdict is returned by Claude before answers are cleared
- Returning submitter with valid token retrieves correct track record

### Phase 4 Tests
- Content pack contains drafts for all 6 platforms
- Blog draft is generated first
- HiveCast script word count is within range for pack type
- Voice style matches `CONTENT.md` guide (manual review required)

---

## Environment Variables

See `DEPLOYMENT.md` for the full list. All secrets must be in environment variables. No hardcoded credentials anywhere in the codebase.

A `.env.example` file must be maintained with all required variables listed (values empty).

---

## Code Style

```
Python:       PEP 8, type hints throughout, async/await for all I/O
TypeScript:   Strict mode, no `any` types
SQL:          Parameterised queries only — no string interpolation ever
Secrets:      Environment variables only
Logging:      Structured JSON logs, but NEVER log Honeypot submission content
Comments:     Explain why, not what
```

---

## The One Thing That Must Never Happen

A Honeypot submission — its content, its questionnaire answers, or any information that could be combined to identify the source — must never appear in:

- Application logs
- Error logs  
- Database records beyond the encrypted content field
- Redis cache
- Network request logs
- Any analytics or monitoring system

If in doubt: don't log it. The source's protection is the system's primary obligation.

---

## Getting Started

```bash
# 1. Clone / initialise repository
# 2. Copy .env.example to .env and fill in development values
# 3. Start dependencies
docker-compose up postgres redis -d

# 4. Run database migrations
python apps/python/scripts/migrate.py

# 5. Start Python service
cd apps/python && uvicorn main:app --reload --port 8000

# 6. Start Next.js
cd apps/nextjs && npm run dev

# 7. Import N8N workflows
# Access N8N at localhost:5678
# Import JSON files from n8n/workflows/

# 8. Trigger first RSS poll manually via N8N
# Verify signals appear in database
# Verify embeddings are generated
```

---

## Contact

Built for GeekyBee (geekybee.net).  
Platform: newshive.geekybee.net  
Documentation version: 1.0 — March 2026
