# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the PostgreSQL schema, Python FastAPI skeleton, RSS ingestion pipeline, embedding generation, and Redis deduplication — the foundation every other phase depends on.

**Architecture:** asyncpg for non-blocking DB access; OpenAI text-embedding-3-large for 1536-dim vector embeddings stored via pgvector; Redis SHA-256 fingerprint cache for deduplication; FastAPI routers split by concern with Pydantic models for all I/O.

**Tech Stack:** Python 3.11, FastAPI, asyncpg, pgvector, Redis, OpenAI API, pytest + httpx

---

## File Map

```
apps/python/
├── main.py                         FastAPI app, lifespan, router registration
├── config.py                       Pydantic Settings — all env vars
├── database.py                     asyncpg connection pool (get_pool, get_conn)
├── redis_client.py                 Redis connection singleton
├── migrations/
│   └── 001_initial_schema.sql      Full schema from DATABASE.md (exact)
├── scripts/
│   └── migrate.py                  Runs all SQL migration files in order
├── models/
│   ├── __init__.py
│   └── signals.py                  IngestRequest, IngestResponse Pydantic models
├── routers/
│   ├── __init__.py
│   └── ingest.py                   POST /ingest
├── services/
│   ├── __init__.py
│   ├── dedup.py                    is_duplicate(url) / mark_seen(url)
│   ├── embedding.py                generate_embedding(text) → list[float]
│   └── clustering.py               assign_cluster(signal_id, embedding)
└── tests/
    ├── conftest.py                 pytest fixtures: test DB, test Redis, test client
    ├── test_dedup.py
    ├── test_embedding.py
    ├── test_ingest.py
    └── test_clustering.py
```

---

## Task 1: Database Schema Migration

**Files:**
- Create: `apps/python/migrations/001_initial_schema.sql`
- Create: `apps/python/scripts/migrate.py`

- [ ] **Step 1.1: Write the schema SQL**

Create `apps/python/migrations/001_initial_schema.sql` — implement the full schema from `.claude/DATABASE.md` exactly:

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sources
CREATE TABLE IF NOT EXISTS sources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  handle          TEXT,
  url             TEXT,
  platform        TEXT NOT NULL,
  domain_tags     TEXT[] DEFAULT '{}',
  tier            INTEGER DEFAULT 3,
  is_active       BOOLEAN DEFAULT TRUE,
  first_seen      TIMESTAMPTZ DEFAULT NOW(),
  last_ingested   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_reputation (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id             UUID REFERENCES sources(id) ON DELETE CASCADE,
  total_signals         INTEGER DEFAULT 0,
  confirmed_correct     INTEGER DEFAULT 0,
  confirmed_wrong       INTEGER DEFAULT 0,
  partially_correct     INTEGER DEFAULT 0,
  still_developing      INTEGER DEFAULT 0,
  accuracy_rate         DECIMAL(5,4),
  lead_time_avg_days    DECIMAL(6,2),
  lead_time_best_days   DECIMAL(6,2),
  magnitude_accuracy    DECIMAL(5,4),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id)
);

-- Clusters (must exist before signals FK)
CREATE TABLE IF NOT EXISTS clusters (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT,
  domain_tags           TEXT[] DEFAULT '{}',
  centroid_embedding    vector(1536),
  signal_count          INTEGER DEFAULT 0,
  first_signal_at       TIMESTAMPTZ,
  last_signal_at        TIMESTAMPTZ,
  readiness_score       DECIMAL(5,2) DEFAULT 0,
  signal_volume_score   DECIMAL(5,2) DEFAULT 0,
  signal_diversity_score DECIMAL(5,2) DEFAULT 0,
  novelty_score         DECIMAL(5,2) DEFAULT 0,
  trajectory_shift_score DECIMAL(5,2) DEFAULT 0,
  cross_domain_score    DECIMAL(5,2) DEFAULT 0,
  last_readiness_calc   TIMESTAMPTZ,
  readiness_threshold   DECIMAL(5,2) DEFAULT 75.0,
  last_pack_triggered   TIMESTAMPTZ,
  days_since_last_pack  INTEGER,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clusters_centroid_idx ON clusters USING ivfflat (centroid_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS clusters_readiness_idx ON clusters(readiness_score DESC);
CREATE INDEX IF NOT EXISTS clusters_domain_idx ON clusters USING GIN(domain_tags);

-- Signals
CREATE TABLE IF NOT EXISTS signals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id       UUID REFERENCES sources(id),
  title           TEXT,
  content         TEXT,
  url             TEXT,
  published_at    TIMESTAMPTZ,
  ingested_at     TIMESTAMPTZ DEFAULT NOW(),
  domain_tags     TEXT[] DEFAULT '{}',
  source_type     TEXT NOT NULL,
  is_public       BOOLEAN DEFAULT TRUE,
  provenance_url  TEXT,
  magnitude_score       DECIMAL(3,1),
  irreversibility_score DECIMAL(3,1),
  blast_radius_score    DECIMAL(3,1),
  velocity_score        DECIMAL(3,1),
  importance_composite  DECIMAL(3,1),
  reality_check_passed  BOOLEAN,
  corroboration_count   INTEGER DEFAULT 0,
  is_alert_candidate    BOOLEAN DEFAULT FALSE,
  alert_tier            TEXT,
  confidence_level      TEXT DEFAULT 'unassessed',
  cluster_id      UUID REFERENCES clusters(id),
  embedding       vector(1536),
  processed       BOOLEAN DEFAULT FALSE,
  processing_error TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signals_embedding_idx ON signals USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS signals_ingested_at_idx ON signals(ingested_at DESC);
CREATE INDEX IF NOT EXISTS signals_published_at_idx ON signals(published_at DESC);
CREATE INDEX IF NOT EXISTS signals_domain_tags_idx ON signals USING GIN(domain_tags);
CREATE INDEX IF NOT EXISTS signals_importance_idx ON signals(importance_composite DESC);
CREATE INDEX IF NOT EXISTS signals_cluster_idx ON signals(cluster_id);
CREATE INDEX IF NOT EXISTS signals_confidence_idx ON signals(confidence_level);
CREATE INDEX IF NOT EXISTS signals_is_alert_idx ON signals(is_alert_candidate) WHERE is_alert_candidate = TRUE;

-- Alert Candidates
CREATE TABLE IF NOT EXISTS alert_candidates (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_ids              UUID[] NOT NULL,
  cluster_id              UUID REFERENCES clusters(id),
  magnitude_score         DECIMAL(3,1),
  irreversibility_score   DECIMAL(3,1),
  blast_radius_score      DECIMAL(3,1),
  velocity_score          DECIMAL(3,1),
  composite_score         DECIMAL(3,1),
  reality_check_passed    BOOLEAN DEFAULT FALSE,
  source_tier_min         INTEGER,
  corroboration_count     INTEGER DEFAULT 0,
  too_good_to_be_true     BOOLEAN DEFAULT FALSE,
  alert_tier              TEXT,
  confidence_level        TEXT,
  fired_at                TIMESTAMPTZ,
  content_pack_id         UUID,
  outcome_notes           TEXT,
  outcome_accurate        BOOLEAN,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Source Tokens (Honeypot)
CREATE TABLE IF NOT EXISTS source_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token           TEXT UNIQUE NOT NULL,
  token_prefix    TEXT NOT NULL,
  initial_verdict TEXT NOT NULL,
  verdict_at      TIMESTAMPTZ DEFAULT NOW(),
  submission_count        INTEGER DEFAULT 0,
  confirmed_correct       INTEGER DEFAULT 0,
  confirmed_wrong         INTEGER DEFAULT 0,
  partially_correct       INTEGER DEFAULT 0,
  still_developing        INTEGER DEFAULT 0,
  accuracy_rate           DECIMAL(5,4),
  lead_time_avg_days      DECIMAL(6,2),
  current_tier            INTEGER DEFAULT 0,
  tier_updated_at         TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  last_submission_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS source_tokens_tier_idx ON source_tokens(current_tier);

CREATE TABLE IF NOT EXISTS honeypot_submissions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id        UUID REFERENCES source_tokens(id),
  content_encrypted TEXT NOT NULL,
  instant_corroboration   BOOLEAN DEFAULT FALSE,
  corroboration_signal_id UUID REFERENCES signals(id),
  corroboration_window    TEXT,
  confidence_level        TEXT DEFAULT 'pinch_of_salt',
  entered_queue           TEXT,
  outcome                 TEXT,
  outcome_at              TIMESTAMPTZ,
  outcome_notes           TEXT,
  days_to_confirmation    INTEGER,
  content_pack_id         UUID,
  published_post_ids      UUID[],
  submitted_at            TIMESTAMPTZ DEFAULT NOW(),
  submission_sequence     INTEGER
);

-- Trajectories
CREATE TABLE IF NOT EXISTS trajectories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  domain_tags     TEXT[] DEFAULT '{}',
  description     TEXT,
  status          TEXT DEFAULT 'active',
  confidence_score DECIMAL(3,1),
  confidence_direction TEXT,
  most_likely_path    TEXT,
  accelerated_scenario TEXT,
  disruption_scenario TEXT,
  stagnation_scenario TEXT,
  supporting_signal_ids UUID[],
  contradicting_signal_ids UUID[],
  first_published_at  TIMESTAMPTZ,
  last_updated_at     TIMESTAMPTZ,
  outcome             TEXT,
  outcome_at          TIMESTAMPTZ,
  outcome_notes       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trajectories_status_idx ON trajectories(status);

CREATE TABLE IF NOT EXISTS trajectory_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trajectory_id   UUID REFERENCES trajectories(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  confidence_score DECIMAL(3,1),
  description     TEXT,
  reason_for_change TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Content Packs
CREATE TABLE IF NOT EXISTS content_packs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_id      UUID REFERENCES clusters(id),
  alert_candidate_id UUID REFERENCES alert_candidates(id),
  pack_type       TEXT NOT NULL,
  triggered_at    TIMESTAMPTZ DEFAULT NOW(),
  trigger_reason  TEXT,
  readiness_score DECIMAL(5,2),
  signal_ids      UUID[],
  status          TEXT DEFAULT 'drafting',
  operator_notes  TEXT,
  approved_at     TIMESTAMPTZ,
  hivecast_script TEXT,
  hivecast_video_url TEXT,
  hivecast_video_status TEXT,
  hivecast_type   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS content_packs_status_idx ON content_packs(status);

CREATE TABLE IF NOT EXISTS content_drafts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pack_id         UUID REFERENCES content_packs(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  draft_text      TEXT,
  suggested_visuals TEXT,
  hashtags        TEXT[],
  confidence_label TEXT,
  approved        BOOLEAN DEFAULT FALSE,
  operator_edits  TEXT,
  final_text      TEXT,
  published_at    TIMESTAMPTZ,
  published_url   TEXT,
  platform_post_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_drafts_approved_idx ON content_drafts(approved);

-- Monthly Snapshots
CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_year           INTEGER NOT NULL,
  period_month          INTEGER NOT NULL,
  signals_ingested      INTEGER DEFAULT 0,
  alerts_fired          INTEGER DEFAULT 0,
  alerts_confirmed      INTEGER DEFAULT 0,
  pinch_of_salt_issued  INTEGER DEFAULT 0,
  pinch_of_salt_confirmed INTEGER DEFAULT 0,
  pinch_of_salt_wrong   INTEGER DEFAULT 0,
  pinch_of_salt_developing INTEGER DEFAULT 0,
  content_packs_published INTEGER DEFAULT 0,
  overall_accuracy_rate DECIMAL(5,4),
  avg_lead_time_days    DECIMAL(6,2),
  trajectory_calls_made INTEGER DEFAULT 0,
  trajectory_correct    INTEGER DEFAULT 0,
  trajectory_wrong      INTEGER DEFAULT 0,
  trajectory_partial    INTEGER DEFAULT 0,
  domain_activity       JSONB,
  signal_of_month_id    UUID REFERENCES signals(id),
  signal_of_month_notes TEXT,
  watching_items        JSONB,
  draft_generated_at    TIMESTAMPTZ,
  operator_reviewed     BOOLEAN DEFAULT FALSE,
  published_at          TIMESTAMPTZ,
  blog_post_url         TEXT,
  hivecast_url          TEXT,
  UNIQUE(period_year, period_month),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Pinch of Salt Watch
CREATE TABLE IF NOT EXISTS pinch_of_salt_watch (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id             UUID REFERENCES signals(id),
  honeypot_submission_id UUID REFERENCES honeypot_submissions(id),
  source_token_id       UUID REFERENCES source_tokens(id),
  summary               TEXT NOT NULL,
  domain_tags           TEXT[] DEFAULT '{}',
  magnitude_score       DECIMAL(3,1),
  source_verdict_at_time TEXT,
  source_tier_at_time   INTEGER,
  source_accuracy_at_time DECIMAL(5,4),
  status                TEXT DEFAULT 'watching',
  published_at          TIMESTAMPTZ,
  published_post_ids    UUID[],
  outcome               TEXT,
  outcome_at            TIMESTAMPTZ,
  confirming_source_id  UUID REFERENCES sources(id),
  confirming_signal_id  UUID REFERENCES signals(id),
  days_to_confirmation  INTEGER,
  lead_time_vs_mainstream INTEGER,
  stale_after_days      INTEGER DEFAULT 90,
  marked_stale_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pinch_watch_status_idx ON pinch_of_salt_watch(status);
CREATE INDEX IF NOT EXISTS pinch_watch_outcome_idx ON pinch_of_salt_watch(outcome);

-- API Subscribers
CREATE TABLE IF NOT EXISTS api_subscribers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL,
  api_key         TEXT UNIQUE NOT NULL,
  tier            TEXT DEFAULT 'free',
  domain_filters  TEXT[] DEFAULT '{}',
  feed_filters    TEXT[] DEFAULT '{}',
  webhook_url     TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ
);
```

- [ ] **Step 1.2: Write the migration runner**

Create `apps/python/scripts/migrate.py`:

```python
"""Run all SQL migration files in order against the configured database."""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


async def run_migrations() -> None:
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        applied = {row["filename"] for row in await conn.fetch("SELECT filename FROM _migrations")}
        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        for path in migration_files:
            if path.name in applied:
                print(f"  skip  {path.name}")
                continue
            print(f"  apply {path.name}")
            sql = path.read_text()
            await conn.execute(sql)
            await conn.execute("INSERT INTO _migrations (filename) VALUES ($1)", path.name)
        print("Migrations complete.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migrations())
```

- [ ] **Step 1.3: Run migrations against a local Postgres instance to verify**

```bash
cd apps/python
DATABASE_URL=postgresql://newshive_user:password@localhost:5432/newshive python scripts/migrate.py
```
Expected: `apply 001_initial_schema.sql` then `Migrations complete.`

- [ ] **Step 1.4: Commit**

```bash
git add apps/python/migrations/ apps/python/scripts/migrate.py
git commit -m "feat: add full database schema and migration runner"
```

---

## Task 2: Python FastAPI Skeleton

**Files:**
- Create: `apps/python/config.py`
- Create: `apps/python/database.py`
- Create: `apps/python/redis_client.py`
- Create: `apps/python/main.py`

- [ ] **Step 2.1: Write config.py**

```python
# apps/python/config.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    openai_api_key: str
    anthropic_api_key: str
    google_ai_api_key: str = ""
    perplexity_api_key: str = ""
    elevenlabs_api_key: str = ""
    heygen_api_key: str = ""
    heygen_avatar_id: str = ""
    heygen_voice_id: str = ""
    honeypot_encryption_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
```

- [ ] **Step 2.2: Write database.py**

```python
# apps/python/database.py
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import asyncpg

from config import settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=2,
        max_size=10,
        command_timeout=60,
    )


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def get_conn() -> AsyncGenerator[asyncpg.Connection, None]:
    assert _pool is not None, "DB pool not initialised — call init_pool() first"
    async with _pool.acquire() as conn:
        yield conn
```

- [ ] **Step 2.3: Write redis_client.py**

```python
# apps/python/redis_client.py
import redis.asyncio as aioredis

from config import settings

_redis: aioredis.Redis | None = None


async def init_redis() -> None:
    global _redis
    _redis = aioredis.from_url(settings.redis_url, decode_responses=True)


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None


def get_redis() -> aioredis.Redis:
    assert _redis is not None, "Redis not initialised — call init_redis() first"
    return _redis
```

- [ ] **Step 2.4: Write main.py**

```python
# apps/python/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from database import init_pool, close_pool
from redis_client import init_redis, close_redis
from routers import ingest


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await init_redis()
    yield
    await close_pool()
    await close_redis()


app = FastAPI(title="NewsHive Python Service", lifespan=lifespan)

app.include_router(ingest.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
```

- [ ] **Step 2.5: Write the health check test**

Create `apps/python/tests/conftest.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch


@pytest.fixture
async def client():
    # Patch DB and Redis init so tests don't need real services
    with patch("main.init_pool", new_callable=AsyncMock), \
         patch("main.close_pool", new_callable=AsyncMock), \
         patch("main.init_redis", new_callable=AsyncMock), \
         patch("main.close_redis", new_callable=AsyncMock):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
```

Create `apps/python/tests/test_health.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2.6: Run the health test**

```bash
cd apps/python
pip install pytest pytest-asyncio httpx
pytest tests/test_health.py -v
```
Expected: PASS

- [ ] **Step 2.7: Commit**

```bash
git add apps/python/config.py apps/python/database.py apps/python/redis_client.py apps/python/main.py apps/python/tests/
git commit -m "feat: FastAPI skeleton with DB/Redis lifespan management"
```

---

## Task 3: Deduplication Service

**Files:**
- Create: `apps/python/services/dedup.py`
- Create: `apps/python/tests/test_dedup.py`

Logic: SHA-256 of normalised URL stored as Redis key `dedup:{fingerprint}` with 7-day TTL (604800 seconds).

- [ ] **Step 3.1: Write the failing test**

Create `apps/python/tests/test_dedup.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_new_url_is_not_duplicate():
    mock_redis = AsyncMock()
    mock_redis.exists.return_value = 0
    with patch("services.dedup.get_redis", return_value=mock_redis):
        from services.dedup import is_duplicate
        result = await is_duplicate("https://example.com/article?utm_source=tw")
        assert result is False


@pytest.mark.asyncio
async def test_seen_url_is_duplicate():
    mock_redis = AsyncMock()
    mock_redis.exists.return_value = 1
    with patch("services.dedup.get_redis", return_value=mock_redis):
        from services.dedup import is_duplicate
        result = await is_duplicate("https://example.com/article")
        assert result is True


@pytest.mark.asyncio
async def test_mark_seen_sets_key_with_ttl():
    mock_redis = AsyncMock()
    with patch("services.dedup.get_redis", return_value=mock_redis):
        from services.dedup import mark_seen
        await mark_seen("https://example.com/article")
        mock_redis.setex.assert_called_once()
        args = mock_redis.setex.call_args[0]
        assert args[1] == 604800  # 7 days


@pytest.mark.asyncio
async def test_normalisation_strips_utm_params():
    mock_redis = AsyncMock()
    mock_redis.exists.return_value = 0
    with patch("services.dedup.get_redis", return_value=mock_redis):
        from services.dedup import is_duplicate, _normalise_url
        url_a = "https://example.com/article?utm_source=twitter&utm_medium=social"
        url_b = "https://example.com/article"
        assert _normalise_url(url_a) == _normalise_url(url_b)
```

- [ ] **Step 3.2: Run to verify failure**

```bash
pytest tests/test_dedup.py -v
```
Expected: ImportError / ModuleNotFoundError

- [ ] **Step 3.3: Implement dedup.py**

Create `apps/python/services/__init__.py` (empty).

Create `apps/python/services/dedup.py`:

```python
"""URL deduplication using Redis. Same URL from multiple sources is intentional
and desired — only exact URL duplicates are suppressed."""

import hashlib
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

from redis_client import get_redis

_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days
_UTM_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}


def _normalise_url(url: str) -> str:
    """Strip UTM params, trailing slashes, and www prefix for fingerprinting."""
    parsed = urlparse(url.rstrip("/"))
    host = parsed.netloc.removeprefix("www.")
    filtered_qs = {k: v for k, v in parse_qs(parsed.query).items() if k not in _UTM_PARAMS}
    normalised = urlunparse((parsed.scheme, host, parsed.path, "", urlencode(filtered_qs, doseq=True), ""))
    return normalised


def _fingerprint(url: str) -> str:
    return hashlib.sha256(_normalise_url(url).encode()).hexdigest()


async def is_duplicate(url: str) -> bool:
    key = f"dedup:{_fingerprint(url)}"
    return bool(await get_redis().exists(key))


async def mark_seen(url: str) -> None:
    key = f"dedup:{_fingerprint(url)}"
    await get_redis().setex(key, _DEDUP_TTL_SECONDS, "1")
```

- [ ] **Step 3.4: Run tests to verify pass**

```bash
pytest tests/test_dedup.py -v
```
Expected: 4 PASSED

- [ ] **Step 3.5: Commit**

```bash
git add apps/python/services/ apps/python/tests/test_dedup.py
git commit -m "feat: URL deduplication service with Redis 7-day TTL"
```

---

## Task 4: Embedding Service

**Files:**
- Create: `apps/python/services/embedding.py`
- Create: `apps/python/tests/test_embedding.py`

Uses OpenAI `text-embedding-3-large` → 1536-dim vector.

- [ ] **Step 4.1: Write the failing test**

Create `apps/python/tests/test_embedding.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_embedding_returns_1536_floats():
    mock_response = MagicMock()
    mock_response.data = [MagicMock(embedding=[0.1] * 1536)]
    mock_client = AsyncMock()
    mock_client.embeddings.create = AsyncMock(return_value=mock_response)

    with patch("services.embedding._get_client", return_value=mock_client):
        from services.embedding import generate_embedding
        result = await generate_embedding("This is a test signal about AI.")
        assert len(result) == 1536
        assert all(isinstance(v, float) for v in result)


@pytest.mark.asyncio
async def test_embedding_truncates_long_text():
    """Text over 8000 chars should be truncated before sending."""
    mock_response = MagicMock()
    mock_response.data = [MagicMock(embedding=[0.0] * 1536)]
    mock_client = AsyncMock()
    mock_client.embeddings.create = AsyncMock(return_value=mock_response)

    with patch("services.embedding._get_client", return_value=mock_client):
        from services.embedding import generate_embedding
        long_text = "x" * 20000
        await generate_embedding(long_text)
        call_text = mock_client.embeddings.create.call_args[1]["input"]
        assert len(call_text) <= 8000
```

- [ ] **Step 4.2: Run to verify failure**

```bash
pytest tests/test_embedding.py -v
```
Expected: ImportError

- [ ] **Step 4.3: Implement embedding.py**

Create `apps/python/services/embedding.py`:

```python
"""OpenAI text-embedding-3-large wrapper. Returns 1536-dimensional float vectors."""

from openai import AsyncOpenAI

from config import settings

_MODEL = "text-embedding-3-large"
_MAX_CHARS = 8000  # ~2000 tokens — safe limit for embedding model
_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def generate_embedding(text: str) -> list[float]:
    """Generate a 1536-dim embedding for the given text."""
    truncated = text[:_MAX_CHARS] if len(text) > _MAX_CHARS else text
    response = await _get_client().embeddings.create(
        model=_MODEL,
        input=truncated,
    )
    return response.data[0].embedding
```

- [ ] **Step 4.4: Run tests to verify pass**

```bash
pytest tests/test_embedding.py -v
```
Expected: 2 PASSED

- [ ] **Step 4.5: Commit**

```bash
git add apps/python/services/embedding.py apps/python/tests/test_embedding.py
git commit -m "feat: OpenAI text-embedding-3-large service (1536-dim)"
```

---

## Task 5: Ingest Endpoint

**Files:**
- Create: `apps/python/models/__init__.py`
- Create: `apps/python/models/signals.py`
- Create: `apps/python/routers/__init__.py`
- Create: `apps/python/routers/ingest.py`
- Create: `apps/python/tests/test_ingest.py`

`POST /ingest` accepts a signal, checks dedup, generates embedding, stores in DB. Returns `{"id": uuid, "deduplicated": bool}`.

- [ ] **Step 5.1: Write Pydantic models**

Create `apps/python/models/__init__.py` (empty).

Create `apps/python/models/signals.py`:

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, HttpUrl


class IngestRequest(BaseModel):
    url: str
    title: str | None = None
    content: str | None = None
    published_at: datetime | None = None
    source_id: UUID | None = None
    source_type: str = "rss_feed"
    domain_tags: list[str] = []
    is_public: bool = True
    provenance_url: str | None = None


class IngestResponse(BaseModel):
    id: UUID | None
    deduplicated: bool
    message: str
```

- [ ] **Step 5.2: Write failing tests**

Create `apps/python/tests/test_ingest.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from uuid import uuid4


@pytest.mark.asyncio
async def test_ingest_new_signal_returns_id(client):
    signal_id = str(uuid4())
    with patch("routers.ingest.is_duplicate", new_callable=AsyncMock, return_value=False), \
         patch("routers.ingest.mark_seen", new_callable=AsyncMock), \
         patch("routers.ingest.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 1536), \
         patch("routers.ingest._store_signal", new_callable=AsyncMock, return_value=signal_id):
        response = await client.post("/ingest", json={
            "url": "https://example.com/new-article",
            "title": "Big AI announcement",
            "content": "Something happened in AI today.",
            "source_type": "rss_feed",
            "domain_tags": ["ai"]
        })
    assert response.status_code == 200
    data = response.json()
    assert data["deduplicated"] is False
    assert data["id"] == signal_id


@pytest.mark.asyncio
async def test_ingest_duplicate_returns_deduplicated_flag(client):
    with patch("routers.ingest.is_duplicate", new_callable=AsyncMock, return_value=True):
        response = await client.post("/ingest", json={
            "url": "https://example.com/seen-before",
            "source_type": "rss_feed",
        })
    assert response.status_code == 200
    data = response.json()
    assert data["deduplicated"] is True
    assert data["id"] is None


@pytest.mark.asyncio
async def test_ingest_missing_url_returns_422(client):
    response = await client.post("/ingest", json={"title": "No URL here"})
    assert response.status_code == 422
```

- [ ] **Step 5.3: Run to verify failure**

```bash
pytest tests/test_ingest.py -v
```
Expected: ImportError (router not yet created)

- [ ] **Step 5.4: Implement the ingest router**

Create `apps/python/routers/__init__.py` (empty).

Create `apps/python/routers/ingest.py`:

```python
"""POST /ingest — receive a signal, deduplicate, embed, store."""

import json
from uuid import UUID

from fastapi import APIRouter

from database import get_conn
from models.signals import IngestRequest, IngestResponse
from services.dedup import is_duplicate, mark_seen
from services.embedding import generate_embedding

router = APIRouter()


async def _store_signal(req: IngestRequest, embedding: list[float]) -> str:
    """Insert signal into DB and return its UUID."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO signals (
                source_id, title, content, url, published_at,
                domain_tags, source_type, is_public, provenance_url,
                embedding
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10
            )
            RETURNING id
            """,
            req.source_id,
            req.title,
            req.content,
            req.url,
            req.published_at,
            req.domain_tags,
            req.source_type,
            req.is_public,
            req.provenance_url or req.url,
            json.dumps(embedding),  # pgvector accepts JSON array string
        )
        return str(row["id"])


@router.post("/ingest", response_model=IngestResponse)
async def ingest_signal(req: IngestRequest) -> IngestResponse:
    if await is_duplicate(req.url):
        return IngestResponse(id=None, deduplicated=True, message="Signal already seen — skipped.")

    text_to_embed = f"{req.title or ''} {req.content or ''}".strip()
    embedding = await generate_embedding(text_to_embed) if text_to_embed else [0.0] * 1536

    signal_id = await _store_signal(req, embedding)
    await mark_seen(req.url)

    return IngestResponse(id=UUID(signal_id), deduplicated=False, message="Signal ingested.")
```

- [ ] **Step 5.5: Run all tests**

```bash
pytest tests/ -v
```
Expected: All PASSED (health, dedup, embedding, ingest)

- [ ] **Step 5.6: Commit**

```bash
git add apps/python/models/ apps/python/routers/ apps/python/tests/test_ingest.py
git commit -m "feat: POST /ingest endpoint with dedup check and embedding"
```

---

## Task 6: Cluster Assignment

**Files:**
- Create: `apps/python/services/clustering.py`
- Create: `apps/python/tests/test_clustering.py`
- Modify: `apps/python/routers/ingest.py` — call assign_cluster after store

Finds the nearest cluster centroid within cosine distance 0.3. If none found, creates a new cluster. Updates cluster signal count and centroid.

- [ ] **Step 6.1: Write failing tests**

Create `apps/python/tests/test_clustering.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


@pytest.mark.asyncio
async def test_assigns_to_existing_cluster_when_close():
    cluster_id = str(uuid4())
    mock_conn = AsyncMock()
    mock_conn.fetchrow.return_value = {"id": cluster_id, "signal_count": 5}

    with patch("services.clustering.get_conn") as mock_get_conn:
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=False)
        from services.clustering import assign_cluster
        result = await assign_cluster(str(uuid4()), [0.1] * 1536)
        assert result == cluster_id


@pytest.mark.asyncio
async def test_creates_new_cluster_when_no_match():
    new_cluster_id = str(uuid4())
    mock_conn = AsyncMock()
    # First fetchrow (nearest cluster) returns None
    # Second fetchrow (insert cluster) returns new id
    mock_conn.fetchrow.side_effect = [None, {"id": new_cluster_id}]

    with patch("services.clustering.get_conn") as mock_get_conn:
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=False)
        from services.clustering import assign_cluster
        result = await assign_cluster(str(uuid4()), [0.1] * 1536)
        assert result == new_cluster_id
```

- [ ] **Step 6.2: Run to verify failure**

```bash
pytest tests/test_clustering.py -v
```
Expected: ImportError

- [ ] **Step 6.3: Implement clustering.py**

Create `apps/python/services/clustering.py`:

```python
"""Assign a signal to the nearest cluster or create a new one.

Uses pgvector cosine distance. Threshold 0.3 — signals further than this
start a new cluster rather than diluting an existing one."""

import json

from database import get_conn

_SIMILARITY_THRESHOLD = 0.3  # cosine distance — lower = more similar


async def assign_cluster(signal_id: str, embedding: list[float]) -> str:
    """Return cluster UUID. Creates new cluster if no match within threshold."""
    embedding_str = json.dumps(embedding)

    async with get_conn() as conn:
        # Find nearest cluster by centroid cosine distance
        row = await conn.fetchrow(
            """
            SELECT id, signal_count
            FROM clusters
            WHERE is_active = TRUE
              AND centroid_embedding IS NOT NULL
              AND (centroid_embedding <=> $1::vector) < $2
            ORDER BY centroid_embedding <=> $1::vector
            LIMIT 1
            """,
            embedding_str,
            _SIMILARITY_THRESHOLD,
        )

        if row:
            cluster_id = str(row["id"])
            # Update signal count and centroid (running average)
            n = row["signal_count"]
            await conn.execute(
                """
                UPDATE clusters SET
                    signal_count = signal_count + 1,
                    last_signal_at = NOW(),
                    updated_at = NOW(),
                    centroid_embedding = (
                        (centroid_embedding * $1 + $2::vector) / ($1 + 1)
                    )
                WHERE id = $3
                """,
                n,
                embedding_str,
                row["id"],
            )
        else:
            # Create new cluster with this signal's embedding as centroid
            new_row = await conn.fetchrow(
                """
                INSERT INTO clusters (centroid_embedding, signal_count, first_signal_at, last_signal_at)
                VALUES ($1::vector, 1, NOW(), NOW())
                RETURNING id
                """,
                embedding_str,
            )
            cluster_id = str(new_row["id"])

        # Link signal to cluster
        await conn.execute(
            "UPDATE signals SET cluster_id = $1 WHERE id = $2",
            cluster_id,
            signal_id,
        )

    return cluster_id
```

- [ ] **Step 6.4: Wire assign_cluster into the ingest router**

Modify `apps/python/routers/ingest.py` — add after `_store_signal`:

```python
# Add import at top:
from services.clustering import assign_cluster

# Add after signal_id = await _store_signal(...):
    await assign_cluster(signal_id, embedding)
```

- [ ] **Step 6.5: Run all tests**

```bash
pytest tests/ -v
```
Expected: All PASSED

- [ ] **Step 6.6: Commit**

```bash
git add apps/python/services/clustering.py apps/python/tests/test_clustering.py apps/python/routers/ingest.py
git commit -m "feat: cluster assignment via pgvector cosine similarity"
```

---

## Task 7: Push and Verify

- [ ] **Step 7.1: Run full test suite**

```bash
cd apps/python
pytest tests/ -v --tb=short
```
Expected: All tests PASSED, no errors

- [ ] **Step 7.2: Push to GitHub**

```bash
cd C:/xampp/htdocs/hivenews
git push origin master
```

- [ ] **Step 7.3: Verify Coolify build (once services configured)**

Check Coolify logs for `newshive-python` — look for:
```
INFO:     Application startup complete.
```

GET `http://newshive-python:8000/health` from inside the Docker network → `{"status": "ok"}`

---

## Phase 1 Complete Checklist

```
✓ PostgreSQL schema — all tables from DATABASE.md implemented
✓ Python FastAPI skeleton — DB + Redis lifespan, /health endpoint
✓ Deduplication service — SHA-256 fingerprint, 7-day Redis TTL
✓ Embedding service — OpenAI text-embedding-3-large, 1536-dim
✓ POST /ingest — dedup check → embed → store → cluster assign
✓ Cluster assignment — cosine similarity threshold, new cluster creation
✓ All tests passing
✓ Pushed to GitHub master
```

**Phase 2 (next):** Importance scoring (Claude API), alert candidate detection, reality check pipeline, readiness threshold calculation.
