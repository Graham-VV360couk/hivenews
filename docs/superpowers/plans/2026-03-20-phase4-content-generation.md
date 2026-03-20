# Phase 4 — Content Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the content generation pipeline (Python: Claude drafts + DB persistence + endpoint) and bootstrap the HiveDeck Next.js dashboard with auth and pack approval workflow.

**Architecture:** Python generates all platform drafts in a single Claude call, stores to content_packs + content_drafts tables. Next.js dashboard reads directly from Postgres and calls Python service for draft triggers. Auth is JWT cookie, single operator password.

**Tech Stack:** Python 3.11, FastAPI, Anthropic SDK, Next.js 14 App Router, TypeScript, Tailwind CSS, postgres (npm), jose (JWT), bcryptjs

---

## Task 1 — Python `services/draft.py` + tests (TDD)

### Step 1.1 — Write failing tests first

Create `apps/python/tests/test_draft.py`:

```python
# apps/python/tests/test_draft.py
import json
from unittest.mock import AsyncMock, MagicMock, patch


async def test_generate_pack_drafts_returns_all_platforms():
    """Mock Claude returning valid JSON — result must have all platform keys."""
    valid_response = {
        "blog": {"title": "Test Title", "content": "Test content", "meta_description": "Test desc"},
        "linkedin": {"content": "LinkedIn post", "hashtags": ["#AI", "#Tech"]},
        "instagram": {"content": "Instagram post", "hashtags": ["#AI"], "visual_suggestion": "Graph"},
        "facebook": {"content": "Facebook post"},
        "x": {"type": "single", "tweets": ["Tweet 1"]},
        "hivecast": {"script": "Script text", "lower_thirds": ["Lower 1"], "confidence_badge": "HIGH"},
        "suggested_visuals": "A clean infographic",
    }
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps(valid_response))]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch("services.draft._get_client", return_value=mock_client):
        from services.draft import generate_pack_drafts
        result = await generate_pack_drafts(
            cluster_name="AI Model Releases",
            confidence_level="HIGH",
            pack_type="standard",
            domain_tags=["ai"],
            signal_summaries="OpenAI releases GPT-5.",
        )

    assert result is not None
    assert "blog" in result
    assert "linkedin" in result
    assert "instagram" in result
    assert "facebook" in result
    assert "x" in result
    assert "hivecast" in result
    assert "suggested_visuals" in result


async def test_generate_pack_drafts_handles_malformed_json():
    """If Claude returns non-JSON text, returns None gracefully."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="Sorry I can't do that")]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch("services.draft._get_client", return_value=mock_client):
        from services.draft import generate_pack_drafts
        result = await generate_pack_drafts(
            cluster_name="Test Cluster",
            confidence_level="MEDIUM",
            pack_type="standard",
            domain_tags=["seo"],
            signal_summaries="Some signals.",
        )

    assert result is None


async def test_generate_pack_drafts_handles_claude_error():
    """If Claude raises an exception, returns None without crashing."""
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API timeout"))

    with patch("services.draft._get_client", return_value=mock_client):
        from services.draft import generate_pack_drafts
        result = await generate_pack_drafts(
            cluster_name="Test Cluster",
            confidence_level="LOW",
            pack_type="standard",
            domain_tags=["vr"],
            signal_summaries="Some signals.",
        )

    assert result is None
```

### Step 1.2 — Run tests to verify they fail

```bash
cd apps/python
python -m pytest tests/test_draft.py -v
```

Expected: 3 errors — `ImportError: cannot import name 'generate_pack_drafts' from 'services.draft'` (file does not exist yet). This confirms the TDD red state.

### Step 1.3 — Implement `services/draft.py`

Create `apps/python/services/draft.py`:

```python
"""Claude-powered multi-platform content draft generation.

Single Claude call produces all platform drafts (blog, linkedin, instagram,
facebook, x, hivecast) from cluster signals in one shot.
"""
import json
import logging

from anthropic import AsyncAnthropic

from config import settings

log = logging.getLogger(__name__)

_client: AsyncAnthropic | None = None

_SYSTEM_PROMPT = """\
You are writing content for NewsHive — a technology intelligence platform covering AI, VR/AR, Vibe Coding, and SEO.

VOICE GUIDE:
Write as a thoughtful, experienced observer who finds the human truth inside the technical story. Speak directly without being cold. Arrive at strong opinions through visible reasoning. Use the specific detail to illuminate the general point. Be never more than one sentence away from either a dry laugh or genuine emotion.

Never open with hollow phrases ("Excited to share", "Big news").
Never use meaningless amplifiers ("huge", "massive", "game-changing").
Never summarise without adding a perspective.
Rhythm matters. Long sentences that build, followed by short ones that land.\
"""

_USER_PROMPT_TEMPLATE = """\
Generate a complete content pack for NewsHive.

Pack: {cluster_name}
Confidence: {confidence_level}
Type: {pack_type}
Domains: {domain_tags}

Source signals:
{signal_summaries}

Return as JSON only — no preamble:
{{"blog": {{"title": "", "content": "", "meta_description": ""}}, "linkedin": {{"content": "", "hashtags": []}}, "instagram": {{"content": "", "hashtags": [], "visual_suggestion": ""}}, "facebook": {{"content": ""}}, "x": {{"type": "single", "tweets": []}}, "hivecast": {{"script": "", "lower_thirds": [], "confidence_badge": ""}}, "suggested_visuals": ""}}\
"""

_REQUIRED_KEYS = {"blog", "linkedin", "instagram", "facebook", "x", "hivecast", "suggested_visuals"}


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def generate_pack_drafts(
    cluster_name: str,
    confidence_level: str,
    pack_type: str,
    domain_tags: list[str],
    signal_summaries: str,
    trajectory_summaries: str = "",
    previous_posts: str = "",
) -> dict | None:
    """Call Claude to generate all platform drafts in a single call.

    Args:
        cluster_name: Human-readable cluster label.
        confidence_level: HIGH / MEDIUM / LOW — drives tone.
        pack_type: standard / alert_breaking / alert_significant / pinch_of_salt.
        domain_tags: List of domain strings, e.g. ["ai", "vr"].
        signal_summaries: Concatenated signal summaries (truncated to 4000 chars).
        trajectory_summaries: Optional trajectory context (Phase 6+).
        previous_posts: Optional recent published posts to avoid repetition.

    Returns:
        dict with keys blog/linkedin/instagram/facebook/x/hivecast/suggested_visuals,
        or None if Claude fails or returns unparseable output.
    """
    # Truncate signal summaries to stay within token budget
    truncated_summaries = signal_summaries[:4000]
    if len(signal_summaries) > 4000:
        truncated_summaries += "\n[...truncated]"

    user_prompt = _USER_PROMPT_TEMPLATE.format(
        cluster_name=cluster_name,
        confidence_level=confidence_level,
        pack_type=pack_type,
        domain_tags=", ".join(domain_tags) if domain_tags else "general",
        signal_summaries=truncated_summaries,
    )

    try:
        response = await _get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = response.content[0].text.strip()
        data = json.loads(raw)

        # Validate all required platform keys are present
        missing = _REQUIRED_KEYS - set(data.keys())
        if missing:
            log.warning("Draft response missing keys: %s", missing)
            return None

        return data

    except json.JSONDecodeError as exc:
        log.warning("Draft generation returned non-JSON for cluster %r: %s", cluster_name, exc)
        return None
    except Exception as exc:
        log.warning("Draft generation failed for cluster %r: %s", cluster_name, exc)
        return None
```

### Step 1.4 — Run tests to verify they pass

```bash
cd apps/python
python -m pytest tests/test_draft.py -v
```

Expected output:
```
tests/test_draft.py::test_generate_pack_drafts_returns_all_platforms PASSED
tests/test_draft.py::test_generate_pack_drafts_handles_malformed_json PASSED
tests/test_draft.py::test_generate_pack_drafts_handles_claude_error PASSED
3 passed
```

### Step 1.5 — Commit

```bash
git add apps/python/services/draft.py apps/python/tests/test_draft.py
git commit -m "$(cat <<'EOF'
feat(python): add draft.py — Claude multi-platform content draft generation

Single Claude claude-opus-4-6 call produces blog, linkedin, instagram, facebook,
x, and hivecast drafts from cluster signals. Returns None on any failure so
the content pipeline never crashes. TDD: 3 tests green.
EOF
)"
```

---

## Task 2 — Python `services/content_pack.py` + tests (TDD)

### Step 2.1 — Write failing tests first

Create `apps/python/tests/test_content_pack.py`:

```python
# apps/python/tests/test_content_pack.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_create_content_pack_returns_uuid():
    """create_content_pack should INSERT and return the UUID from the DB row."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={"id": pack_id})

    mock_pool_ctx = MagicMock()
    mock_pool_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.content_pack.get_conn", return_value=mock_pool_ctx):
        from services.content_pack import create_content_pack
        result = await create_content_pack(
            cluster_id=uuid.uuid4(),
            alert_candidate_id=None,
            pack_type="standard",
            confidence_level="HIGH",
            signal_ids=[uuid.uuid4(), uuid.uuid4()],
            readiness_score=82.5,
            trigger_reason="readiness_threshold",
        )

    assert result == pack_id


async def test_store_drafts_inserts_one_row_per_platform():
    """store_drafts should INSERT exactly one row per platform (6 total)."""
    pack_id = uuid.uuid4()
    drafts = {
        "blog": {"title": "T", "content": "C", "meta_description": "M"},
        "linkedin": {"content": "L", "hashtags": ["#AI"]},
        "instagram": {"content": "I", "hashtags": ["#AI"], "visual_suggestion": "V"},
        "facebook": {"content": "F"},
        "x": {"type": "single", "tweets": ["Tweet"]},
        "hivecast": {"script": "S", "lower_thirds": ["L1"], "confidence_badge": "HIGH"},
    }

    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock()

    mock_pool_ctx = MagicMock()
    mock_pool_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.content_pack.get_conn", return_value=mock_pool_ctx):
        from services.content_pack import store_drafts
        await store_drafts(pack_id=pack_id, drafts=drafts)

    assert mock_conn.execute.call_count == 6


async def test_trigger_pack_for_cluster_returns_none_on_draft_failure():
    """If generate_pack_drafts returns None, trigger_pack_for_cluster returns None without crashing."""
    cluster_id = uuid.uuid4()

    mock_conn = AsyncMock()
    # Cluster info fetch
    mock_conn.fetchrow = AsyncMock(return_value={
        "name": "Test Cluster",
        "domain_tags": ["ai"],
        "confidence_level": "HIGH",
        "readiness_score": 82.5,
        "days_since_last_pack": 2,
    })
    # Signal rows fetch
    mock_conn.fetch = AsyncMock(return_value=[
        {"title": "Signal 1", "content_summary": "Summary 1", "source_name": "TechCrunch"},
    ])

    mock_pool_ctx = MagicMock()
    mock_pool_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.content_pack.get_conn", return_value=mock_pool_ctx), \
         patch("services.content_pack.generate_pack_drafts", return_value=None):
        from services.content_pack import trigger_pack_for_cluster
        result = await trigger_pack_for_cluster(cluster_id=cluster_id)

    assert result is None
```

### Step 2.2 — Run tests to verify they fail

```bash
cd apps/python
python -m pytest tests/test_content_pack.py -v
```

Expected: 3 errors — `ImportError: cannot import name 'create_content_pack' from 'services.content_pack'` (file does not exist). Red state confirmed.

### Step 2.3 — Implement `services/content_pack.py`

Create `apps/python/services/content_pack.py`:

```python
"""Content pack creation and draft storage.

Orchestrates the full pipeline:
  fetch cluster/alert data → generate Claude drafts → INSERT to DB.

Tables written:
  content_packs  — one row per content pack
  content_drafts — one row per platform per pack (6 platforms)
"""
import json
import logging
from uuid import UUID

from database import get_conn
from services.draft import generate_pack_drafts

log = logging.getLogger(__name__)

_PLATFORMS = ("blog", "linkedin", "instagram", "facebook", "x", "hivecast")


async def create_content_pack(
    cluster_id: UUID | None,
    alert_candidate_id: UUID | None,
    pack_type: str,
    confidence_level: str,
    signal_ids: list[UUID],
    readiness_score: float | None,
    trigger_reason: str,
) -> UUID:
    """INSERT a new content_packs row. Returns the new pack UUID."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO content_packs (
                cluster_id,
                alert_candidate_id,
                pack_type,
                confidence_level,
                signal_ids,
                readiness_score,
                trigger_reason,
                status,
                triggered_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_approval', NOW())
            RETURNING id
            """,
            cluster_id,
            alert_candidate_id,
            pack_type,
            confidence_level,
            signal_ids,
            readiness_score,
            trigger_reason,
        )
        return row["id"]


async def store_drafts(pack_id: UUID, drafts: dict) -> None:
    """INSERT one content_drafts row per platform.

    Platforms: blog, linkedin, instagram, facebook, x, hivecast.
    The full platform JSON blob is stored in draft_data; the text fields
    (title, content, script) are also stored in dedicated columns for
    quick display in the HiveDeck dashboard.
    """
    async with get_conn() as conn:
        for platform in _PLATFORMS:
            platform_data = drafts.get(platform, {})
            # Extract text content regardless of platform shape
            if platform == "blog":
                draft_text = platform_data.get("content", "")
            elif platform == "x":
                draft_text = "\n---\n".join(platform_data.get("tweets", []))
            elif platform == "hivecast":
                draft_text = platform_data.get("script", "")
            else:
                draft_text = platform_data.get("content", "")

            await conn.execute(
                """
                INSERT INTO content_drafts (
                    pack_id,
                    platform,
                    draft_text,
                    draft_data,
                    approved,
                    created_at
                ) VALUES ($1, $2, $3, $4, FALSE, NOW())
                """,
                pack_id,
                platform,
                draft_text,
                json.dumps(platform_data),
            )


async def trigger_pack_for_cluster(cluster_id: UUID) -> UUID | None:
    """Full pipeline: fetch cluster signals → generate drafts → store to DB.

    Returns:
        pack_id (UUID) on success, None if draft generation failed.
    """
    async with get_conn() as conn:
        # 1. Fetch cluster metadata
        cluster = await conn.fetchrow(
            """
            SELECT name, domain_tags, confidence_level, readiness_score, days_since_last_pack
            FROM clusters
            WHERE id = $1
            """,
            cluster_id,
        )
        if not cluster:
            log.warning("trigger_pack_for_cluster: cluster %s not found", cluster_id)
            return None

        # 2. Fetch last 50 signals ordered by importance
        signals = await conn.fetch(
            """
            SELECT title, content_summary, source_name, importance_composite
            FROM signals
            WHERE cluster_id = $1
            ORDER BY importance_composite DESC NULLS LAST, ingested_at DESC
            LIMIT 50
            """,
            cluster_id,
        )
        signal_ids_rows = await conn.fetch(
            "SELECT id FROM signals WHERE cluster_id = $1 ORDER BY ingested_at DESC LIMIT 50",
            cluster_id,
        )

    # 3. Build signal summaries string
    summary_parts = []
    for s in signals:
        title = s["title"] or ""
        summary = s["content_summary"] or ""
        source = s["source_name"] or "Unknown"
        summary_parts.append(f"[{source}] {title}: {summary}")
    signal_summaries = "\n".join(summary_parts)

    signal_ids = [r["id"] for r in signal_ids_rows]

    # 4. Generate Claude drafts
    drafts = await generate_pack_drafts(
        cluster_name=cluster["name"],
        confidence_level=cluster["confidence_level"] or "MEDIUM",
        pack_type="standard",
        domain_tags=cluster["domain_tags"] or [],
        signal_summaries=signal_summaries,
    )

    if drafts is None:
        log.warning("trigger_pack_for_cluster: draft generation failed for cluster %s", cluster_id)
        return None

    # 5. Persist pack + drafts
    pack_id = await create_content_pack(
        cluster_id=cluster_id,
        alert_candidate_id=None,
        pack_type="standard",
        confidence_level=cluster["confidence_level"] or "MEDIUM",
        signal_ids=signal_ids,
        readiness_score=cluster["readiness_score"],
        trigger_reason="readiness_threshold",
    )
    await store_drafts(pack_id=pack_id, drafts=drafts)

    log.info("Content pack %s created for cluster %s", pack_id, cluster_id)
    return pack_id


async def trigger_pack_for_alert(alert_candidate_id: UUID) -> UUID | None:
    """Full pipeline for alert_candidate: fetch alert + signals → generate drafts → store.

    Returns:
        pack_id (UUID) on success, None if draft generation failed.
    """
    async with get_conn() as conn:
        alert = await conn.fetchrow(
            """
            SELECT ac.id, ac.alert_type, ac.confidence_level, ac.cluster_id,
                   c.name AS cluster_name, c.domain_tags
            FROM alert_candidates ac
            LEFT JOIN clusters c ON c.id = ac.cluster_id
            WHERE ac.id = $1
            """,
            alert_candidate_id,
        )
        if not alert:
            log.warning("trigger_pack_for_alert: alert_candidate %s not found", alert_candidate_id)
            return None

        signals = await conn.fetch(
            """
            SELECT title, content_summary, source_name
            FROM signals
            WHERE cluster_id = $1
            ORDER BY importance_composite DESC NULLS LAST, ingested_at DESC
            LIMIT 50
            """,
            alert["cluster_id"],
        )
        signal_ids_rows = await conn.fetch(
            "SELECT id FROM signals WHERE cluster_id = $1 ORDER BY ingested_at DESC LIMIT 50",
            alert["cluster_id"],
        )

    summary_parts = []
    for s in signals:
        title = s["title"] or ""
        summary = s["content_summary"] or ""
        source = s["source_name"] or "Unknown"
        summary_parts.append(f"[{source}] {title}: {summary}")
    signal_summaries = "\n".join(summary_parts)

    signal_ids = [r["id"] for r in signal_ids_rows]

    alert_type = alert["alert_type"] or "alert_significant"
    pack_type = alert_type if alert_type in ("alert_breaking", "alert_significant") else "alert_significant"

    drafts = await generate_pack_drafts(
        cluster_name=alert["cluster_name"] or "Breaking Alert",
        confidence_level=alert["confidence_level"] or "HIGH",
        pack_type=pack_type,
        domain_tags=alert["domain_tags"] or [],
        signal_summaries=signal_summaries,
    )

    if drafts is None:
        log.warning("trigger_pack_for_alert: draft generation failed for alert %s", alert_candidate_id)
        return None

    pack_id = await create_content_pack(
        cluster_id=alert["cluster_id"],
        alert_candidate_id=alert_candidate_id,
        pack_type=pack_type,
        confidence_level=alert["confidence_level"] or "HIGH",
        signal_ids=signal_ids,
        readiness_score=None,
        trigger_reason="alert_detection",
    )
    await store_drafts(pack_id=pack_id, drafts=drafts)

    log.info("Alert content pack %s created for alert_candidate %s", pack_id, alert_candidate_id)
    return pack_id
```

### Step 2.4 — Run tests to verify they pass

```bash
cd apps/python
python -m pytest tests/test_content_pack.py -v
```

Expected output:
```
tests/test_content_pack.py::test_create_content_pack_returns_uuid PASSED
tests/test_content_pack.py::test_store_drafts_inserts_one_row_per_platform PASSED
tests/test_content_pack.py::test_trigger_pack_for_cluster_returns_none_on_draft_failure PASSED
3 passed
```

### Step 2.5 — Commit

```bash
git add apps/python/services/content_pack.py apps/python/tests/test_content_pack.py
git commit -m "$(cat <<'EOF'
feat(python): add content_pack.py — pack creation, draft storage, full pipeline

create_content_pack INSERTs to content_packs table. store_drafts INSERTs one
content_drafts row per platform (6 total). trigger_pack_for_cluster orchestrates
the full fetch → generate → persist pipeline. trigger_pack_for_alert handles
alert_candidate source. TDD: 3 tests green.
EOF
)"
```

---

## Task 3 — Python `routers/draft.py` + register in `main.py`

### Step 3.1 — Create `apps/python/routers/draft.py`

```python
"""POST /draft — trigger content pack creation for a cluster or alert candidate.

Used by N8N automations and HiveDeck dashboard to manually trigger draft generation.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.content_pack import trigger_pack_for_cluster, trigger_pack_for_alert
from services.readiness import should_trigger_content_pack

log = logging.getLogger(__name__)
router = APIRouter()


class DraftRequest(BaseModel):
    cluster_id: UUID | None = None
    alert_candidate_id: UUID | None = None
    pack_type: str = "standard"
    force: bool = False  # bypass readiness check


class DraftResponse(BaseModel):
    pack_id: UUID | None
    created: bool
    reason: str


@router.post("/draft", response_model=DraftResponse)
async def trigger_draft(req: DraftRequest) -> DraftResponse:
    """Trigger content pack creation for a cluster or alert candidate.

    - cluster_id: checks readiness score unless force=True
    - alert_candidate_id: skips readiness check (alerts always trigger)
    - Both provided: alert_candidate_id takes precedence
    - Neither provided: returns 422
    """
    if req.cluster_id is None and req.alert_candidate_id is None:
        raise HTTPException(status_code=422, detail="Provide cluster_id or alert_candidate_id")

    # Alert candidate path — always trigger regardless of readiness
    if req.alert_candidate_id is not None:
        pack_id = await trigger_pack_for_alert(req.alert_candidate_id)
        if pack_id is None:
            return DraftResponse(pack_id=None, created=False, reason="draft_generation_failed")
        return DraftResponse(pack_id=pack_id, created=True, reason="alert_candidate")

    # Cluster path — check readiness unless force=True
    if req.cluster_id is not None:
        if not req.force:
            from database import get_conn
            async with get_conn() as conn:
                row = await conn.fetchrow(
                    "SELECT readiness_score, days_since_last_pack FROM clusters WHERE id = $1",
                    req.cluster_id,
                )
            if not row:
                raise HTTPException(status_code=404, detail="Cluster not found")

            readiness_score = row["readiness_score"] or 0.0
            days_since = row["days_since_last_pack"]

            if not should_trigger_content_pack(readiness_score, days_since):
                return DraftResponse(
                    pack_id=None,
                    created=False,
                    reason=f"not_ready (score={readiness_score}, days={days_since})",
                )

        pack_id = await trigger_pack_for_cluster(req.cluster_id)
        if pack_id is None:
            return DraftResponse(pack_id=None, created=False, reason="draft_generation_failed")

        reason = "forced" if req.force else "readiness_threshold"
        return DraftResponse(pack_id=pack_id, created=True, reason=reason)

    # Unreachable but satisfies type checker
    raise HTTPException(status_code=422, detail="Invalid request")
```

### Step 3.2 — Register the router in `main.py`

Edit `apps/python/main.py`:

**Before:**
```python
from routers import ingest, score, honeypot
```

**After:**
```python
from routers import ingest, score, honeypot, draft
```

**Before:**
```python
app.include_router(ingest.router)
app.include_router(score.router)
app.include_router(honeypot.router)
```

**After:**
```python
app.include_router(ingest.router)
app.include_router(score.router)
app.include_router(honeypot.router)
app.include_router(draft.router)
```

Full updated `apps/python/main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI

from database import init_pool, close_pool
from redis_client import init_redis, close_redis
from routers import ingest, score, honeypot, draft


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await init_redis()
    yield
    await close_pool()
    await close_redis()


app = FastAPI(title="NewsHive Python Service", lifespan=lifespan)

app.include_router(ingest.router)
app.include_router(score.router)
app.include_router(honeypot.router)
app.include_router(draft.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
```

### Step 3.3 — Hook readiness into content pack triggering

Edit `apps/python/services/readiness.py` — add `trigger_content_pack` call at the end of `recalculate_cluster_readiness` when the threshold is met.

Add this import block at the top of the file (after the existing imports):

```python
import asyncio
```

Replace the final `return score` in `recalculate_cluster_readiness` with:

```python
        # Trigger content pack if readiness threshold met or hard cap reached
        days_since = stats.get("days_since_last_pack")
        if should_trigger_content_pack(score, days_since):
            # Fire-and-forget — do not block readiness recalculation
            asyncio.create_task(_trigger_content_pack(cluster_id))

        return score


async def _trigger_content_pack(cluster_id: UUID) -> None:
    """Background task: trigger content pack creation without blocking."""
    try:
        from services.content_pack import trigger_pack_for_cluster
        pack_id = await trigger_pack_for_cluster(cluster_id)
        if pack_id:
            log.info("Auto-triggered content pack %s for cluster %s", pack_id, cluster_id)
        else:
            log.warning("Auto-trigger: draft generation failed for cluster %s", cluster_id)
    except Exception as exc:
        log.warning("Auto-trigger: unexpected error for cluster %s: %s", cluster_id, exc)
```

Full updated `apps/python/services/readiness.py`:

```python
"""Cluster readiness scoring. Determines when a cluster has enough signal
for a content pack. See SCORING.md for full component breakdown."""
import asyncio
import logging
from uuid import UUID

log = logging.getLogger(__name__)

READINESS_THRESHOLD = 75.0
HARD_CAP_DAYS = 5


def calculate_readiness_score(
    signal_count: int,
    unique_sources: int,
    novelty_score: float,
    trajectory_shift_score: float,
    cross_domain_score: float,
) -> float:
    """Calculate readiness score (0-100)."""
    volume_score = min(signal_count / 20 * 25, 25.0)
    diversity_score = min(unique_sources / 10 * 25, 25.0)
    total = volume_score + diversity_score + novelty_score + trajectory_shift_score + cross_domain_score
    return round(min(total, 100.0), 2)


def should_trigger_content_pack(readiness_score: float, days_since_last_pack: int | None) -> bool:
    """Return True if cluster is ready for a content pack."""
    if days_since_last_pack is not None and days_since_last_pack >= HARD_CAP_DAYS:
        return True  # hard cap — always trigger after 5 days
    return readiness_score >= READINESS_THRESHOLD


async def recalculate_cluster_readiness(cluster_id: UUID) -> float:
    """Query cluster signals and update readiness score in DB. Returns new score."""
    from database import get_conn
    async with get_conn() as conn:
        stats = await conn.fetchrow(
            """
            SELECT
                COUNT(*)                                    AS signal_count,
                COUNT(DISTINCT source_id)                  AS unique_sources,
                MAX(last_pack_triggered)                   AS last_pack_triggered,
                days_since_last_pack
            FROM clusters
            LEFT JOIN signals ON signals.cluster_id = clusters.id
            WHERE clusters.id = $1
            GROUP BY clusters.id, clusters.days_since_last_pack,
                     clusters.last_pack_triggered
            """,
            cluster_id,
        )
        if not stats:
            return 0.0

        signal_count = stats["signal_count"] or 0
        unique_sources = stats["unique_sources"] or 0

        # Novelty, trajectory shift, cross-domain default to 0 until Phase 6
        # (trajectory system). Readiness is driven by volume + diversity for now.
        novelty_score = 10.0 if signal_count > 5 else 0.0
        trajectory_shift_score = 0.0
        cross_domain_score = 0.0

        score = calculate_readiness_score(
            signal_count, unique_sources,
            novelty_score, trajectory_shift_score, cross_domain_score
        )

        await conn.execute(
            """
            UPDATE clusters SET
                readiness_score        = $1,
                signal_volume_score    = $2,
                signal_diversity_score = $3,
                novelty_score          = $4,
                last_readiness_calc    = NOW(),
                days_since_last_pack   = CASE
                    WHEN last_pack_triggered IS NOT NULL
                    THEN EXTRACT(DAY FROM NOW() - last_pack_triggered)::INTEGER
                    ELSE NULL
                END
            WHERE id = $5
            """,
            score,
            min(signal_count / 20 * 25, 25.0),
            min(unique_sources / 10 * 25, 25.0),
            novelty_score,
            cluster_id,
        )

        # Trigger content pack if readiness threshold met or hard cap reached
        days_since = stats["days_since_last_pack"]
        if should_trigger_content_pack(score, days_since):
            asyncio.create_task(_trigger_content_pack(cluster_id))

        return score


async def _trigger_content_pack(cluster_id: UUID) -> None:
    """Background task: trigger content pack creation without blocking."""
    try:
        from services.content_pack import trigger_pack_for_cluster
        pack_id = await trigger_pack_for_cluster(cluster_id)
        if pack_id:
            log.info("Auto-triggered content pack %s for cluster %s", pack_id, cluster_id)
        else:
            log.warning("Auto-trigger: draft generation failed for cluster %s", cluster_id)
    except Exception as exc:
        log.warning("Auto-trigger: unexpected error for cluster %s: %s", cluster_id, exc)
```

### Step 3.4 — Verify the full test suite still passes

```bash
cd apps/python
python -m pytest tests/ -v
```

Expected: all existing tests still pass plus the 6 new ones from Tasks 1 and 2.

### Step 3.5 — Commit

```bash
git add apps/python/routers/draft.py apps/python/main.py apps/python/services/readiness.py
git commit -m "$(cat <<'EOF'
feat(python): add draft router POST /draft + wire auto-trigger in readiness

POST /draft accepts cluster_id or alert_candidate_id, checks readiness (or
bypasses with force=True), delegates to content_pack pipeline. readiness.py
now fire-and-forgets trigger_pack_for_cluster via asyncio.create_task when
should_trigger_content_pack returns True.
EOF
)"
```

---

## Task 4 — Next.js project bootstrap

### Step 4.1 — Scaffold the project

```bash
cd apps/nextjs
# Create package.json
cat > package.json << 'EOF'
{
  "name": "hivenews-hivedeck",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18",
    "react-dom": "^18",
    "postgres": "^3.4.4",
    "jose": "^5.2.4",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@types/bcryptjs": "^2.4.6",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10",
    "postcss": "^8"
  }
}
EOF
npm install
```

### Step 4.2 — Create configuration files

**`apps/nextjs/next.config.js`:**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
};

module.exports = nextConfig;
```

**`apps/nextjs/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "es2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**`apps/nextjs/tailwind.config.ts`:**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f0f0f',
        card: '#1a1a1a',
        accent: '#F5A623',
      },
    },
  },
  plugins: [],
};

export default config;
```

**`apps/nextjs/postcss.config.js`:**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### Step 4.3 — Create directory structure

```bash
mkdir -p apps/nextjs/app/login
mkdir -p apps/nextjs/app/api/auth/login
mkdir -p apps/nextjs/app/api/auth/logout
mkdir -p apps/nextjs/app/dashboard/packs
mkdir -p "apps/nextjs/app/dashboard/packs/[id]"
mkdir -p apps/nextjs/app/dashboard/api/packs
mkdir -p "apps/nextjs/app/dashboard/api/packs/[id]/approve"
mkdir -p apps/nextjs/lib
mkdir -p apps/nextjs/components
```

### Step 4.4 — Create minimal root layout and redirect page

**`apps/nextjs/app/layout.tsx`:**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HiveDeck',
  description: 'NewsHive editorial dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: '#0f0f0f', color: '#e5e5e5', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
```

**`apps/nextjs/app/globals.css`:**

```css
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f0f0f;
  color: #e5e5e5;
  margin: 0;
}

a {
  color: #F5A623;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
```

**`apps/nextjs/app/page.tsx`:**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/dashboard');
}
```

### Step 4.5 — Create `.env.local` template (not committed)

```bash
cat > apps/nextjs/.env.local.example << 'EOF'
DATABASE_URL=postgresql://user:password@localhost:5432/hivenews
PYTHON_SERVICE_URL=http://localhost:8000
DASHBOARD_PASSWORD_HASH=$2b$10$...bcrypt_hash_of_your_password...
NEXTAUTH_SECRET=your-32-char-secret-here
EOF
```

Note: Generate `DASHBOARD_PASSWORD_HASH` with:
```javascript
const bcrypt = require('bcryptjs');
console.log(bcrypt.hashSync('your-password', 10));
```

### Step 4.6 — Verify Next.js is installed

```bash
cd apps/nextjs
npx next --version
```

Expected: `14.2.0`

### Step 4.7 — Commit

```bash
git add apps/nextjs/package.json apps/nextjs/package-lock.json apps/nextjs/next.config.js \
        apps/nextjs/tsconfig.json apps/nextjs/tailwind.config.ts apps/nextjs/postcss.config.js \
        apps/nextjs/app/layout.tsx apps/nextjs/app/globals.css apps/nextjs/app/page.tsx \
        apps/nextjs/.env.local.example
git commit -m "$(cat <<'EOF'
feat(nextjs): bootstrap HiveDeck Next.js 14 project

Standalone output mode for Docker. Tailwind with dark theme (#0f0f0f bg, #F5A623
accent). Dependencies: postgres, jose, bcryptjs. Root page redirects to /dashboard.
EOF
)"
```

---

## Task 5 — Auth system

### Step 5.1 — Create `apps/nextjs/lib/auth.ts`

```typescript
// apps/nextjs/lib/auth.ts
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const COOKIE_NAME = 'nh_session';
const SESSION_DURATION = 60 * 60 * 24; // 24 hours in seconds

function getSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function createSession(response: Response): Promise<Response> {
  const token = await new SignJWT({ operator: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getSecret());

  // Clone response to add the cookie header
  const headers = new Headers(response.headers);
  headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION}; SameSite=Strict`
  );
  return new Response(response.body, { status: response.status, headers });
}

export async function clearSession(): Promise<Response> {
  const headers = new Headers();
  headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`
  );
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}

export async function verifySession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export async function getSessionFromCookies(): Promise<boolean> {
  const cookieStore = cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}
```

### Step 5.2 — Create `apps/nextjs/middleware.ts`

```typescript
// apps/nextjs/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect all /dashboard routes
  if (pathname.startsWith('/dashboard')) {
    const isAuthenticated = await verifySession(request);
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
```

### Step 5.3 — Create login page `apps/nextjs/app/login/page.tsx`

```tsx
// apps/nextjs/app/login/page.tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/dashboard';

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push(from);
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f0f0f',
    }}>
      <div style={{
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        borderRadius: '8px',
        padding: '40px',
        width: '100%',
        maxWidth: '360px',
      }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '20px', color: '#F5A623' }}>
          HiveDeck
        </h1>
        <p style={{ margin: '0 0 28px', color: '#666', fontSize: '13px' }}>
          NewsHive editorial dashboard
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: '#999' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              background: '#0f0f0f',
              border: '1px solid #2a2a2a',
              borderRadius: '4px',
              color: '#e5e5e5',
              fontSize: '14px',
              outline: 'none',
              marginBottom: '16px',
            }}
          />

          {error && (
            <p style={{ margin: '0 0 16px', color: '#ef4444', fontSize: '13px' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px',
              background: loading ? '#5a3d0a' : '#F5A623',
              color: '#0f0f0f',
              border: 'none',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
```

### Step 5.4 — Create auth API routes

**`apps/nextjs/app/api/auth/login/route.ts`:**

```typescript
// apps/nextjs/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSession } from '@/lib/auth';

export async function POST(request: NextRequest): Promise<Response> {
  const { password } = await request.json();

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  const hash = process.env.DASHBOARD_PASSWORD_HASH;
  if (!hash) {
    console.error('DASHBOARD_PASSWORD_HASH is not set');
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const okResponse = NextResponse.json({ ok: true });
  return createSession(okResponse);
}
```

**`apps/nextjs/app/api/auth/logout/route.ts`:**

```typescript
// apps/nextjs/app/api/auth/logout/route.ts
import { clearSession } from '@/lib/auth';

export async function POST(): Promise<Response> {
  return clearSession();
}
```

### Step 5.5 — Commit

```bash
git add apps/nextjs/lib/auth.ts apps/nextjs/middleware.ts \
        apps/nextjs/app/login/page.tsx \
        apps/nextjs/app/api/auth/login/route.ts \
        apps/nextjs/app/api/auth/logout/route.ts
git commit -m "$(cat <<'EOF'
feat(nextjs): auth system — JWT session cookie + password login

middleware.ts guards /dashboard/* routes, redirects unauthenticated to /login.
Auth uses jose JWT in httpOnly nh_session cookie (24h). Password verified
against DASHBOARD_PASSWORD_HASH bcrypt env var. Login page is a clean dark
form with inline error states.
EOF
)"
```

---

## Task 6 — Dashboard home page

### Step 6.1 — Create `apps/nextjs/lib/db.ts`

```typescript
// apps/nextjs/lib/db.ts
import postgres from 'postgres';

// Module-level singleton — Next.js will re-use this across requests in prod
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = postgres(url, { max: 5 });
  }
  return _sql;
}
```

### Step 6.2 — Create `apps/nextjs/lib/python-client.ts`

```typescript
// apps/nextjs/lib/python-client.ts

const BASE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function pythonPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Python service error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function triggerDraft(params: {
  cluster_id?: string;
  alert_candidate_id?: string;
  force?: boolean;
}): Promise<{ pack_id: string | null; created: boolean; reason: string }> {
  return pythonPost('/draft', params);
}
```

### Step 6.3 — Create dashboard layout `apps/nextjs/app/dashboard/layout.tsx`

```tsx
// apps/nextjs/app/dashboard/layout.tsx
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/packs', label: 'Content Packs' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f0f0f' }}>
      {/* Sidebar */}
      <nav style={{
        width: '200px',
        background: '#1a1a1a',
        borderRight: '1px solid #2a2a2a',
        padding: '24px 0',
        flexShrink: 0,
      }}>
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid #2a2a2a' }}>
          <span style={{ color: '#F5A623', fontWeight: 700, fontSize: '16px' }}>HiveDeck</span>
        </div>
        <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>
          {NAV_ITEMS.map(item => (
            <li key={item.href}>
              <Link
                href={item.href}
                style={{
                  display: 'block',
                  padding: '8px 20px',
                  color: '#ccc',
                  fontSize: '14px',
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div style={{ position: 'absolute', bottom: '20px', padding: '0 20px' }}>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                fontSize: '13px',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
```

### Step 6.4 — Create `apps/nextjs/components/StatsBar.tsx`

```tsx
// apps/nextjs/components/StatsBar.tsx

interface Stat {
  label: string;
  value: number | string;
  highlight?: boolean;
}

export function StatsBar({ stats }: { stats: Stat[] }) {
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' }}>
      {stats.map(stat => (
        <div
          key={stat.label}
          style={{
            background: '#1a1a1a',
            border: `1px solid ${stat.highlight ? '#F5A623' : '#2a2a2a'}`,
            borderRadius: '6px',
            padding: '16px 20px',
            minWidth: '140px',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 700, color: stat.highlight ? '#F5A623' : '#e5e5e5' }}>
            {stat.value}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Step 6.5 — Create dashboard home page `apps/nextjs/app/dashboard/page.tsx`

```tsx
// apps/nextjs/app/dashboard/page.tsx
import { getDb } from '@/lib/db';
import { StatsBar } from '@/components/StatsBar';
import Link from 'next/link';

interface TopCluster {
  name: string;
  domain_tags: string[];
  readiness_score: number;
}

async function getDashboardData() {
  const sql = getDb();

  const [
    pendingAlerts,
    pendingPacks,
    pendingHoneypots,
    signalsToday,
    activeClusters,
    topClusters,
  ] = await Promise.all([
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM alert_candidates
      WHERE created_at > NOW() - INTERVAL '24 hours'
      AND outcome_accurate IS NULL
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM content_packs WHERE status = 'pending_approval'
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM honeypot_submissions WHERE outcome IS NULL
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM signals WHERE ingested_at > NOW() - INTERVAL '24 hours'
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM clusters WHERE is_active = TRUE
    `,
    sql<TopCluster[]>`
      SELECT name, domain_tags, readiness_score
      FROM clusters
      WHERE is_active = TRUE
      ORDER BY readiness_score DESC
      LIMIT 5
    `,
  ]);

  return {
    pendingAlerts: Number(pendingAlerts[0].count),
    pendingPacks: Number(pendingPacks[0].count),
    pendingHoneypots: Number(pendingHoneypots[0].count),
    signalsToday: Number(signalsToday[0].count),
    activeClusters: Number(activeClusters[0].count),
    topClusters,
  };
}

export default async function DashboardHome() {
  const data = await getDashboardData();

  const attentionStats = [
    { label: 'Alerts (24h)', value: data.pendingAlerts, highlight: data.pendingAlerts > 0 },
    { label: 'Packs pending', value: data.pendingPacks, highlight: data.pendingPacks > 0 },
    { label: 'Honeypot queue', value: data.pendingHoneypots },
  ];

  const activityStats = [
    { label: 'Signals today', value: data.signalsToday },
    { label: 'Active clusters', value: data.activeClusters },
  ];

  return (
    <div>
      <h1 style={{ margin: '0 0 24px', fontSize: '22px', fontWeight: 600 }}>Overview</h1>

      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Needs attention
      </h2>
      <StatsBar stats={attentionStats} />

      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Today's activity
      </h2>
      <StatsBar stats={activityStats} />

      <h2 style={{ margin: '24px 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Top clusters by readiness
      </h2>
      <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
        {data.topClusters.length === 0 ? (
          <p style={{ padding: '20px', color: '#666', margin: 0 }}>No active clusters yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#666', fontWeight: 500 }}>Cluster</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#666', fontWeight: 500 }}>Domains</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#666', fontWeight: 500 }}>Readiness</th>
              </tr>
            </thead>
            <tbody>
              {data.topClusters.map((cluster, i) => (
                <tr key={i} style={{ borderBottom: i < data.topClusters.length - 1 ? '1px solid #2a2a2a' : 'none' }}>
                  <td style={{ padding: '10px 16px', color: '#e5e5e5' }}>{cluster.name}</td>
                  <td style={{ padding: '10px 16px', color: '#888' }}>
                    {(cluster.domain_tags || []).join(', ')}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: cluster.readiness_score >= 75 ? '#F5A623' : '#666' }}>
                    {cluster.readiness_score?.toFixed(1) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.pendingPacks > 0 && (
        <div style={{ marginTop: '24px' }}>
          <Link
            href="/dashboard/packs"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#F5A623',
              color: '#0f0f0f',
              borderRadius: '4px',
              fontWeight: 600,
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            Review {data.pendingPacks} pending pack{data.pendingPacks !== 1 ? 's' : ''} →
          </Link>
        </div>
      )}
    </div>
  );
}
```

### Step 6.6 — Commit

```bash
git add apps/nextjs/lib/db.ts apps/nextjs/lib/python-client.ts \
        apps/nextjs/app/dashboard/layout.tsx apps/nextjs/app/dashboard/page.tsx \
        apps/nextjs/components/StatsBar.tsx
git commit -m "$(cat <<'EOF'
feat(nextjs): dashboard home — stats overview + top clusters

Server Component fetches 6 DB queries in parallel (pending alerts, packs,
honeypots, signals today, active clusters, top 5 by readiness). StatsBar
highlights items needing attention in amber. Sidebar nav with sign-out form.
EOF
)"
```

---

## Task 7 — Content packs queue + pack approval page

### Step 7.1 — Create `apps/nextjs/components/PackCard.tsx`

```tsx
// apps/nextjs/components/PackCard.tsx
import Link from 'next/link';

interface Pack {
  id: string;
  pack_type: string;
  status: string;
  triggered_at: string;
  confidence_level: string;
  trigger_reason: string;
  readiness_score: number | null;
  draft_count: number;
  approved_count: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending_approval: '#F5A623',
  approved: '#22c55e',
  published: '#3b82f6',
  rejected: '#ef4444',
};

const TYPE_LABELS: Record<string, string> = {
  standard: 'Standard',
  alert_breaking: 'Breaking Alert',
  alert_significant: 'Significant Alert',
  pinch_of_salt: 'Pinch of Salt',
};

export function PackCard({ pack }: { pack: Pack }) {
  const statusColor = STATUS_COLORS[pack.status] || '#666';
  const typeLabel = TYPE_LABELS[pack.pack_type] || pack.pack_type;
  const triggeredAt = new Date(pack.triggered_at).toLocaleString();
  const allApproved = pack.draft_count > 0 && pack.approved_count === pack.draft_count;

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: '6px',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e5e5e5' }}>{typeLabel}</span>
          <span style={{ fontSize: '11px', color: statusColor, background: `${statusColor}20`, padding: '2px 8px', borderRadius: '999px' }}>
            {pack.status.replace('_', ' ')}
          </span>
          <span style={{ fontSize: '11px', color: '#555' }}>{pack.confidence_level}</span>
        </div>
        <div style={{ fontSize: '12px', color: '#555' }}>
          {triggeredAt} · {pack.trigger_reason} · {pack.draft_count} drafts ({pack.approved_count} approved)
          {pack.readiness_score != null && ` · readiness ${pack.readiness_score.toFixed(1)}`}
        </div>
      </div>

      <Link
        href={`/dashboard/packs/${pack.id}`}
        style={{
          padding: '7px 14px',
          background: allApproved ? '#1a3a2a' : '#2a1f0a',
          border: `1px solid ${allApproved ? '#22c55e' : '#F5A623'}`,
          color: allApproved ? '#22c55e' : '#F5A623',
          borderRadius: '4px',
          fontSize: '13px',
          fontWeight: 500,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {allApproved ? 'View' : 'Review'}
      </Link>
    </div>
  );
}
```

### Step 7.2 — Create `apps/nextjs/components/DraftViewer.tsx`

```tsx
// apps/nextjs/components/DraftViewer.tsx
'use client';

import { useState } from 'react';

interface Draft {
  id: string;
  platform: string;
  draft_text: string;
  draft_data: string;
  approved: boolean;
  final_text: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  blog: 'Blog Post',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X / Twitter',
  hivecast: 'HiveCast Script',
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function DraftViewer({ draft, packId, onApproved }: {
  draft: Draft;
  packId: string;
  onApproved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.final_text || draft.draft_text);
  const [approved, setApproved] = useState(draft.approved);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const displayText = draft.final_text || draft.draft_text;
  const label = PLATFORM_LABELS[draft.platform] || draft.platform;

  async function handleApprove(finalText?: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/dashboard/api/packs/${packId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: draft.platform,
          final_text: finalText ?? draft.draft_text,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setApproved(true);
      setEditing(false);
      onApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      background: '#1a1a1a',
      border: `1px solid ${approved ? '#22c55e' : '#2a2a2a'}`,
      borderRadius: '6px',
      marginBottom: '16px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #2a2a2a',
        background: approved ? '#0a1f0a' : 'transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>{label}</span>
          <span style={{ fontSize: '12px', color: '#555' }}>{wordCount(displayText)} words</span>
          {approved && (
            <span style={{ fontSize: '11px', color: '#22c55e', background: '#22c55e20', padding: '2px 8px', borderRadius: '999px' }}>
              Approved
            </span>
          )}
        </div>
        {!approved && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setEditing(!editing)}
              disabled={loading}
              style={{
                padding: '5px 12px',
                background: 'none',
                border: '1px solid #2a2a2a',
                color: '#ccc',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
            <button
              onClick={() => editing ? handleApprove(editText) : handleApprove()}
              disabled={loading}
              style={{
                padding: '5px 12px',
                background: '#F5A623',
                border: 'none',
                color: '#0f0f0f',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '…' : (editing ? 'Save & Approve' : 'Approve')}
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '16px' }}>
        {editing ? (
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            style={{
              width: '100%',
              minHeight: '200px',
              background: '#0f0f0f',
              border: '1px solid #2a2a2a',
              borderRadius: '4px',
              color: '#e5e5e5',
              fontSize: '13px',
              padding: '10px',
              fontFamily: 'inherit',
              lineHeight: 1.6,
              resize: 'vertical',
            }}
          />
        ) : (
          <pre style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '13px',
            lineHeight: 1.6,
            color: '#ccc',
            maxHeight: '300px',
            overflowY: 'auto',
          }}>
            {displayText}
          </pre>
        )}
        {error && (
          <p style={{ margin: '8px 0 0', color: '#ef4444', fontSize: '12px' }}>{error}</p>
        )}
      </div>
    </div>
  );
}
```

### Step 7.3 — Create packs list dashboard API route `apps/nextjs/app/dashboard/api/packs/route.ts`

```typescript
// apps/nextjs/app/dashboard/api/packs/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const sql = getDb();
  const packs = await sql`
    SELECT
      cp.id,
      cp.pack_type,
      cp.status,
      cp.triggered_at,
      cp.confidence_level,
      cp.trigger_reason,
      cp.readiness_score,
      COUNT(cd.id)                                          AS draft_count,
      COUNT(cd.id) FILTER (WHERE cd.approved)              AS approved_count
    FROM content_packs cp
    LEFT JOIN content_drafts cd ON cd.pack_id = cp.id
    GROUP BY cp.id
    ORDER BY cp.triggered_at DESC
    LIMIT 20
  `;
  return NextResponse.json(packs);
}
```

### Step 7.4 — Create individual pack API route `apps/nextjs/app/dashboard/api/packs/[id]/route.ts`

```typescript
// apps/nextjs/app/dashboard/api/packs/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const sql = getDb();
  const { id } = params;

  const [packRows, drafts] = await Promise.all([
    sql`
      SELECT id, pack_type, status, triggered_at, confidence_level,
             trigger_reason, readiness_score, approved_at, cluster_id
      FROM content_packs
      WHERE id = ${id}
    `,
    sql`
      SELECT id, platform, draft_text, draft_data, approved, final_text
      FROM content_drafts
      WHERE pack_id = ${id}
      ORDER BY ARRAY_POSITION(ARRAY['blog','linkedin','instagram','facebook','x','hivecast'], platform)
    `,
  ]);

  if (packRows.length === 0) {
    return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
  }

  return NextResponse.json({ pack: packRows[0], drafts });
}
```

### Step 7.5 — Create approve API route `apps/nextjs/app/dashboard/api/packs/[id]/approve/route.ts`

```typescript
// apps/nextjs/app/dashboard/api/packs/[id]/approve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const sql = getDb();
  const { id } = params;
  const { platform, final_text } = await request.json();

  if (!platform) {
    return NextResponse.json({ error: 'platform required' }, { status: 400 });
  }

  // Approve the draft
  await sql`
    UPDATE content_drafts
    SET approved = TRUE,
        final_text = ${final_text ?? null},
        approved_at = NOW()
    WHERE pack_id = ${id}
    AND platform = ${platform}
  `;

  // Check if all drafts are now approved
  const remaining = await sql<[{ count: string }]>`
    SELECT COUNT(*) FROM content_drafts
    WHERE pack_id = ${id} AND approved = FALSE
  `;

  const pendingCount = Number(remaining[0].count);
  if (pendingCount === 0) {
    await sql`
      UPDATE content_packs
      SET status = 'approved',
          approved_at = NOW()
      WHERE id = ${id}
    `;
  }

  return NextResponse.json({ ok: true, all_approved: pendingCount === 0 });
}
```

### Step 7.6 — Create packs list page `apps/nextjs/app/dashboard/packs/page.tsx`

```tsx
// apps/nextjs/app/dashboard/packs/page.tsx
import { getDb } from '@/lib/db';
import { PackCard } from '@/components/PackCard';

interface Pack {
  id: string;
  pack_type: string;
  status: string;
  triggered_at: string;
  confidence_level: string;
  trigger_reason: string;
  readiness_score: number | null;
  draft_count: number;
  approved_count: number;
}

async function getPacks(): Promise<Pack[]> {
  const sql = getDb();
  const rows = await sql<Pack[]>`
    SELECT
      cp.id,
      cp.pack_type,
      cp.status,
      cp.triggered_at,
      cp.confidence_level,
      cp.trigger_reason,
      cp.readiness_score,
      COUNT(cd.id)                                          AS draft_count,
      COUNT(cd.id) FILTER (WHERE cd.approved)              AS approved_count
    FROM content_packs cp
    LEFT JOIN content_drafts cd ON cd.pack_id = cp.id
    GROUP BY cp.id
    ORDER BY cp.triggered_at DESC
    LIMIT 20
  `;
  return rows;
}

const STATUS_FILTER_ORDER = ['pending_approval', 'approved', 'published', 'rejected'];

export default async function PacksPage() {
  const packs = await getPacks();

  const pending = packs.filter(p => p.status === 'pending_approval');
  const rest = packs.filter(p => p.status !== 'pending_approval');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Content Packs</h1>
        <span style={{ fontSize: '13px', color: '#555' }}>{packs.length} total</span>
      </div>

      {pending.length > 0 && (
        <>
          <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#F5A623', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pending approval ({pending.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
            {pending.map(pack => <PackCard key={pack.id} pack={pack} />)}
          </div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {rest.map(pack => <PackCard key={pack.id} pack={pack} />)}
          </div>
        </>
      )}

      {packs.length === 0 && (
        <p style={{ color: '#555', fontSize: '14px' }}>No content packs yet. They appear here when clusters reach readiness threshold or alerts are detected.</p>
      )}
    </div>
  );
}
```

### Step 7.7 — Create pack approval page `apps/nextjs/app/dashboard/packs/[id]/page.tsx`

```tsx
// apps/nextjs/app/dashboard/packs/[id]/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { DraftViewer } from '@/components/DraftViewer';
import Link from 'next/link';

interface Pack {
  id: string;
  pack_type: string;
  status: string;
  triggered_at: string;
  confidence_level: string;
  trigger_reason: string;
  readiness_score: number | null;
}

interface Draft {
  id: string;
  platform: string;
  draft_text: string;
  draft_data: string;
  approved: boolean;
  final_text: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  standard: 'Standard Pack',
  alert_breaking: 'Breaking Alert',
  alert_significant: 'Significant Alert',
  pinch_of_salt: 'Pinch of Salt',
};

export default function PackApprovalPage() {
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<Pack | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approvedCount, setApprovedCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/dashboard/api/packs/${id}`);
      if (!res.ok) throw new Error('Pack not found');
      const data = await res.json();
      setPack(data.pack);
      setDrafts(data.drafts);
      setApprovedCount(data.drafts.filter((d: Draft) => d.approved).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function handleDraftApproved() {
    setApprovedCount(c => c + 1);
  }

  if (loading) {
    return <div style={{ color: '#555', padding: '40px 0' }}>Loading…</div>;
  }
  if (error || !pack) {
    return <div style={{ color: '#ef4444', padding: '40px 0' }}>{error || 'Pack not found'}</div>;
  }

  const allApproved = approvedCount === drafts.length && drafts.length > 0;
  const typeLabel = TYPE_LABELS[pack.pack_type] || pack.pack_type;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <Link href="/dashboard/packs" style={{ fontSize: '13px', color: '#555', display: 'inline-block', marginBottom: '12px' }}>
          ← Back to packs
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{typeLabel}</h1>
          <span style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '999px',
            background: allApproved ? '#22c55e20' : '#F5A62320',
            color: allApproved ? '#22c55e' : '#F5A623',
          }}>
            {allApproved ? 'All approved' : `${approvedCount}/${drafts.length} approved`}
          </span>
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#555' }}>
          {pack.confidence_level} · {pack.trigger_reason} · {new Date(pack.triggered_at).toLocaleString()}
          {pack.readiness_score != null && ` · readiness ${pack.readiness_score.toFixed(1)}`}
        </div>
      </div>

      {/* Drafts */}
      {drafts.length === 0 ? (
        <p style={{ color: '#555' }}>No drafts found for this pack.</p>
      ) : (
        drafts.map(draft => (
          <DraftViewer
            key={draft.id}
            draft={draft}
            packId={pack.id}
            onApproved={handleDraftApproved}
          />
        ))
      )}
    </div>
  );
}
```

### Step 7.8 — Commit

```bash
git add \
  apps/nextjs/components/PackCard.tsx \
  apps/nextjs/components/DraftViewer.tsx \
  apps/nextjs/app/dashboard/api/packs/route.ts \
  "apps/nextjs/app/dashboard/api/packs/[id]/route.ts" \
  "apps/nextjs/app/dashboard/api/packs/[id]/approve/route.ts" \
  apps/nextjs/app/dashboard/packs/page.tsx \
  "apps/nextjs/app/dashboard/packs/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(nextjs): content packs queue + pack approval workflow

PackCard shows pack type, status, draft progress. PacksPage groups pending
vs recent. Pack approval page (client component) loads drafts via API, lets
operator approve each platform draft with optional inline edit. DraftViewer
handles edit/approve state locally, calls POST /dashboard/api/packs/[id]/approve.
Approve route auto-promotes pack status to 'approved' when all drafts done.
EOF
)"
```

---

## Final Step — Push

```bash
git push origin master
```

---

## Implementation Order Summary

| Task | Workstream | Files | Tests |
|------|-----------|-------|-------|
| 1 | Python | `services/draft.py`, `tests/test_draft.py` | 3 TDD |
| 2 | Python | `services/content_pack.py`, `tests/test_content_pack.py` | 3 TDD |
| 3 | Python | `routers/draft.py`, `main.py` (mod), `services/readiness.py` (mod) | existing suite |
| 4 | Next.js | `package.json`, config files, root layout, root page | npm install |
| 5 | Next.js | `lib/auth.ts`, `middleware.ts`, login page, auth API routes | — |
| 6 | Next.js | `lib/db.ts`, `lib/python-client.ts`, dashboard layout, home page, StatsBar | — |
| 7 | Next.js | PackCard, DraftViewer, packs list, pack approval, API routes | — |

## Environment Variables Required

| Variable | Service | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Python | Claude API key |
| `DATABASE_URL` | Python + Next.js | PostgreSQL connection string |
| `REDIS_URL` | Python | Redis connection string |
| `DASHBOARD_PASSWORD_HASH` | Next.js | bcrypt hash of operator password |
| `NEXTAUTH_SECRET` | Next.js | 32-char JWT signing secret |
| `PYTHON_SERVICE_URL` | Next.js | URL of Python FastAPI service |

## Key Design Decisions

- **Single Claude call per pack**: All 6 platforms generated in one `claude-opus-4-6` call — cheaper and coherent voice across platforms.
- **None-safe pipeline**: `generate_pack_drafts` returns `None` on any failure; callers handle gracefully without crashing.
- **Auto-trigger is fire-and-forget**: `asyncio.create_task` in `recalculate_cluster_readiness` — readiness response is never delayed by draft generation.
- **No ORM in Next.js**: Raw `postgres` tagged template literals — type-safe enough, no migration overhead.
- **Server Components for data**: Dashboard home and packs list are Server Components fetching directly from Postgres — no API roundtrip.
- **Pack approval page is Client Component**: Needs `useState` for optimistic approved counts and inline edit state.
- **`output: 'standalone'`** in `next.config.js` is required — the Next.js Dockerfile copies `.next/standalone`.
