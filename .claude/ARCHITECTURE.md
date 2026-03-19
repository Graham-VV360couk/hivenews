# NewsHive — System Architecture

---

## Stack

```
INFRASTRUCTURE
Coolify           Self-hosted deployment platform
VPS               Minimum 4 vCPU / 8GB RAM / 100GB SSD recommended

CORE SERVICES
PostgreSQL 16     Primary database with pgvector extension
Redis             Job queue, deduplication cache, session store
N8N               Workflow orchestration, ingestion scheduling

APPLICATION
Next.js 14        Dashboard (HiveDeck) + public-facing feeds
Python 3.11       AI synthesis service, embedding pipeline, scoring

EXTERNAL APIS
Anthropic         Claude — synthesis, voice writing, verdict assessment
OpenAI            GPT-4o — cross-reference, structured extraction
Google Gemini     Multimodal signals, Google ecosystem
Perplexity        Real-time web grounding, citation chains
ElevenLabs        Voice clone for HiveCast audio
HeyGen            AI avatar video generation
NewsAPI / Diffbot News ingestion (paid tier recommended)
```

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      INGESTION LAYER                        │
│                                                             │
│  RSS Feeds    Live Streams    APIs    The Honeypot          │
│  (N8N polls)  (WebSocket)    (HTTP)  (Secure submit)        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    PROCESSING PIPELINE                      │
│                                                             │
│  Deduplication → Embedding → Entity extraction             │
│  Source scoring → Cluster assignment → Importance scoring  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    THE HIVE (DATABASE)                      │
│                                                             │
│  PostgreSQL + pgvector                                      │
│  Signals · Clusters · Sources · Trajectories               │
│  Content Packs · Alerts · Monthly Snapshots                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   SYNTHESIS ENGINE                          │
│                                                             │
│  Multi-AI analysis (Claude + GPT-4o + Gemini)              │
│  Trajectory modelling · Theory generation                   │
│  Readiness threshold scoring · Alert detection              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    CONTENT LAYER                            │
│                                                             │
│  Draft generation (per platform + broadcast script)        │
│  HiveDeck approval queue · HeyGen video generation         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   DISTRIBUTION LAYER                        │
│                                                             │
│  Social APIs · YouTube · Blog · HiveFeed RSS · HiveAPI     │
└─────────────────────────────────────────────────────────────┘
```

---

## Service Breakdown

### N8N (Ingestion Orchestration)
- Scheduled RSS polling (configurable per source, default 15 min)
- Live stream webhook receivers (X filtered stream, Reddit PRAW)
- Honeypot submission receiver
- Trigger routing to Python processing service
- Publishing workflow execution after approval

### Python Synthesis Service
- REST API consumed by N8N and Next.js dashboard
- Endpoints: `/embed`, `/cluster`, `/score`, `/synthesise`, `/draft`, `/verdict`
- Manages all external AI API calls
- Handles embedding generation (text-embedding-3-large or equivalent)
- Runs readiness threshold checks on schedule (every 30 min)
- Runs alert detection on every new signal ingestion

### Next.js Application (HiveDeck + Public)
- `/dashboard` — internal approval interface (auth protected)
- `/dashboard/submissions` — Honeypot submission review
- `/dashboard/sources` — source token track records
- `/dashboard/trajectories` — active theory management
- `/feeds/*` — public RSS feed generation
- `/api/v1/*` — public HiveAPI endpoints
- `/blog/*` — canonical blog post rendering

### PostgreSQL + pgvector
- All persistent data storage
- Vector similarity search for signal clustering
- Full schema in `DATABASE.md`

### Redis
- BullMQ job queues for async processing
- Deduplication cache (signal URL fingerprints, 7-day TTL)
- Session store for dashboard auth
- Temporary state for multi-step N8N workflows

---

## Data Flow — New Signal

```
1.  N8N polls RSS / receives webhook
2.  Signal URL fingerprint checked against Redis dedup cache
3.  If duplicate → discard
4.  If new → POST to Python /embed endpoint
5.  Python generates embedding, extracts entities
6.  Signal stored in signals table with embedding
7.  Python assigns to nearest cluster (or creates new)
8.  Importance scoring runs (magnitude, irreversibility,
    blast radius, velocity)
9.  If importance composite > 8.0 → alert candidate pipeline
10. Cluster readiness score recalculated
11. If readiness > threshold → content pack draft triggered
12. Draft appears in HiveDeck for approval
```

---

## Data Flow — Honeypot Submission

```
1.  Source submits via Tor-accessible secure form
2.  Contextual questionnaire answers passed to Claude
3.  Claude returns ONE-TIME verdict: reliable/indefinite/illegitimate
4.  Questionnaire answers immediately deleted
5.  Token generated (random, e.g. SCOUT-7734)
6.  Token + verdict stored in source_tokens table
7.  Submission content stored encrypted in submissions table
8.  Instant corroboration check runs against recent signals
9.  If corroborated by Tier 1 source within 6hrs → DEVELOPING
10. If not corroborated → enters Pinch of Salt queue
11. Dashboard notification sent to operator
12. Source shown token once (their responsibility to retain)
```

---

## Data Flow — Content Pack Approval

```
1.  Operator reviews HiveDeck notification
2.  All platform drafts presented as single content pack
3.  Operator approves / edits individual drafts
4.  Operator approves broadcast script
5.  On full approval:
    a. Blog post staged for publication
    b. Social posts queued in publishing workflow
    c. HeyGen API called with script + avatar config
    d. Video generated (async, 5-20 min)
    e. On video return → auto-posted to YouTube + Reels + LinkedIn
    f. RSS feeds updated
    g. HiveAPI webhook notifications sent to subscribers
```

---

## Coolify Deployment Structure

```
Services (all managed in Coolify):

newshive-postgres      PostgreSQL 16 + pgvector
newshive-redis         Redis 7
newshive-n8n           N8N (self-hosted)
newshive-python        Python synthesis service (Docker)
newshive-nextjs        Next.js application (Docker)
newshive-tor           Tor hidden service for Honeypot
```

All services on internal Docker network.
Only Next.js and Tor exposed externally.
Python service internal only (called by N8N and Next.js).

---

## Environment Variables Required

```
# Database
DATABASE_URL
REDIS_URL

# AI APIs
ANTHROPIC_API_KEY
OPENAI_API_KEY
GOOGLE_AI_API_KEY
PERPLEXITY_API_KEY

# Media
ELEVENLABS_API_KEY
HEYGEN_API_KEY
HEYGEN_AVATAR_ID
HEYGEN_VOICE_ID

# Publishing
X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET
LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET / LINKEDIN_ACCESS_TOKEN
META_APP_ID / META_APP_SECRET / META_ACCESS_TOKEN
INSTAGRAM_BUSINESS_ACCOUNT_ID
FACEBOOK_PAGE_ID
YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET

# News APIs
NEWS_API_KEY
DIFFBOT_TOKEN  (optional, premium)

# Application
NEXTAUTH_SECRET
NEXTAUTH_URL
OPERATOR_EMAIL
DASHBOARD_PASSWORD_HASH

# Tor (Honeypot)
TOR_HIDDEN_SERVICE_DIR
```

---

## Scaling Considerations

The initial build is single-operator, single-server. The architecture supports future scaling:

- Python synthesis service is stateless → horizontally scalable
- PostgreSQL can be migrated to managed (Supabase, Neon) without schema changes
- N8N can be replaced with custom workers as volume increases
- HiveAPI can be rate-limited and monetised at any point
- Redis can move to managed (Upstash) without code changes
