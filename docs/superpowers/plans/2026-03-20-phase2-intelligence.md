# Phase 2 — Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add importance scoring (Claude API), alert candidate detection, reality check pipeline, and cluster readiness recalculation — the intelligence layer that determines what matters.

**Architecture:** All scoring runs async after signal ingestion. Claude API calls are wrapped with structured JSON responses. Alert candidates fire a webhook trigger for N8N. Readiness recalculation updates the cluster table on every new signal.

**Tech Stack:** Python 3.11, FastAPI, Anthropic SDK, asyncpg, pytest + mocks

---

## File Map

```
apps/python/
├── services/
│   ├── scoring.py          Importance scoring via Claude (4 axes → composite)
│   ├── alert_detection.py  Alert candidate creation + alert tier classification
│   ├── reality_check.py    Reality check pipeline (source tier, corroboration, plausibility)
│   └── readiness.py        Cluster readiness score recalculation
├── routers/
│   └── score.py            POST /score (standalone endpoint for N8N)
└── tests/
    ├── test_scoring.py
    ├── test_alert_detection.py
    ├── test_reality_check.py
    └── test_readiness.py
```

**Modified:**
- `routers/ingest.py` — wire scoring + readiness after cluster assignment

---

## Task 1: Importance Scoring Service

**Files:**
- Create: `apps/python/services/scoring.py`
- Create: `apps/python/tests/test_scoring.py`

Logic from SCORING.md:
```
composite = magnitude*0.35 + irreversibility*0.25 + blast_radius*0.25 + velocity*0.15
```

- [ ] **Step 1.1: Write failing tests**

```python
# tests/test_scoring.py
from unittest.mock import AsyncMock, MagicMock, patch
import json


async def test_composite_score_calculation():
    from services.scoring import calculate_composite
    score = calculate_composite(magnitude=8.0, irreversibility=7.0, blast_radius=6.0, velocity=9.0)
    expected = round(8.0*0.35 + 7.0*0.25 + 6.0*0.25 + 9.0*0.15, 1)
    assert score == expected


async def test_score_signal_returns_all_axes():
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "magnitude": 7.0, "irreversibility": 6.0,
        "blast_radius": 8.0, "velocity": 5.0,
        "reasoning": "Significant AI development"
    }))]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    with patch("services.scoring._get_client", return_value=mock_client):
        from services.scoring import score_signal
        result = await score_signal(
            title="GPT-5 released",
            content="OpenAI releases GPT-5 with major capabilities",
            source_name="OpenAI Blog",
            source_tier=1,
            domain_tags=["ai"]
        )
    assert result["magnitude"] == 7.0
    assert result["irreversibility"] == 6.0
    assert result["blast_radius"] == 8.0
    assert result["velocity"] == 5.0
    assert "composite" in result
    assert result["composite"] == round(7.0*0.35 + 6.0*0.25 + 8.0*0.25 + 5.0*0.15, 1)


async def test_score_signal_handles_malformed_claude_response():
    """If Claude returns invalid JSON, scoring returns None gracefully."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="Sorry, I cannot score this.")]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    with patch("services.scoring._get_client", return_value=mock_client):
        from services.scoring import score_signal
        result = await score_signal("title", "content", "source", 3, ["ai"])
    assert result is None


async def test_score_above_threshold_flags_alert_candidate():
    from services.scoring import calculate_composite, ALERT_CANDIDATE_THRESHOLD
    score = calculate_composite(magnitude=9.0, irreversibility=9.0, blast_radius=9.0, velocity=9.0)
    assert score > ALERT_CANDIDATE_THRESHOLD
```

- [ ] **Step 1.2: Run to verify failure**
```bash
cd apps/python && python -m pytest tests/test_scoring.py -v
```

- [ ] **Step 1.3: Implement scoring.py**

```python
# services/scoring.py
"""Importance scoring via Claude API. Four axes → weighted composite.

Thresholds (from SCORING.md):
  ALERT_CANDIDATE_THRESHOLD = 8.0
  WATCH_THRESHOLD           = 6.0
"""
import json
import logging

from anthropic import AsyncAnthropic

from config import settings

log = logging.getLogger(__name__)

ALERT_CANDIDATE_THRESHOLD = 8.0
WATCH_THRESHOLD = 6.0

_WEIGHTS = {"magnitude": 0.35, "irreversibility": 0.25, "blast_radius": 0.25, "velocity": 0.15}
_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def calculate_composite(magnitude: float, irreversibility: float, blast_radius: float, velocity: float) -> float:
    return round(
        magnitude * _WEIGHTS["magnitude"] +
        irreversibility * _WEIGHTS["irreversibility"] +
        blast_radius * _WEIGHTS["blast_radius"] +
        velocity * _WEIGHTS["velocity"],
        1
    )


_SCORING_PROMPT = """You are scoring a technology signal for NewsHive, an intelligence platform \
covering AI, VR/AR, Vibe Coding, and SEO.

Score this signal on four axes from 0-10:

MAGNITUDE: How significant is the change from the previous state?
IRREVERSIBILITY: Can this be undone, or does it permanently shift the landscape?
BLAST RADIUS: How many adjacent domains and people does this affect?
VELOCITY: How fast is this moving? How quickly must people adapt?

Signal:
Title: {title}
Content: {content}
Source: {source_name} (Tier {source_tier})
Domain: {domain_tags}

Return JSON only — no preamble, no explanation:
{{"magnitude": X, "irreversibility": X, "blast_radius": X, "velocity": X, "reasoning": "brief explanation"}}"""


async def score_signal(
    title: str,
    content: str,
    source_name: str,
    source_tier: int,
    domain_tags: list[str],
) -> dict | None:
    """Call Claude to score a signal. Returns dict with axes + composite, or None on failure."""
    prompt = _SCORING_PROMPT.format(
        title=title or "",
        content=(content or "")[:2000],
        source_name=source_name,
        source_tier=source_tier,
        domain_tags=", ".join(domain_tags),
    )
    try:
        response = await _get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        data = json.loads(raw)
        return {
            "magnitude": float(data["magnitude"]),
            "irreversibility": float(data["irreversibility"]),
            "blast_radius": float(data["blast_radius"]),
            "velocity": float(data["velocity"]),
            "reasoning": data.get("reasoning", ""),
            "composite": calculate_composite(
                data["magnitude"], data["irreversibility"],
                data["blast_radius"], data["velocity"]
            ),
        }
    except Exception as exc:
        log.warning("Scoring failed for signal titled %r: %s", title, exc)
        return None


async def apply_scores_to_signal(signal_id: str, scores: dict) -> None:
    """Persist scoring results to the signals table."""
    from database import get_conn
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE signals SET
                magnitude_score       = $1,
                irreversibility_score = $2,
                blast_radius_score    = $3,
                velocity_score        = $4,
                importance_composite  = $5,
                is_alert_candidate    = $6
            WHERE id = $7
            """,
            scores["magnitude"],
            scores["irreversibility"],
            scores["blast_radius"],
            scores["velocity"],
            scores["composite"],
            scores["composite"] >= ALERT_CANDIDATE_THRESHOLD,
            signal_id,
        )
```

- [ ] **Step 1.4: Run tests**
```bash
python -m pytest tests/test_scoring.py -v
```
Expected: 4 PASSED

- [ ] **Step 1.5: Commit**
```bash
git add apps/python/services/scoring.py apps/python/tests/test_scoring.py
git commit -m "feat: Claude importance scoring — 4 axes, composite score, alert threshold"
```

---

## Task 2: Reality Check Pipeline

**Files:**
- Create: `apps/python/services/reality_check.py`
- Create: `apps/python/tests/test_reality_check.py`

Logic from SCORING.md: source tier, corroboration count, too_good_to_be_true flag, plausibility (Claude), recency (48h).

- [ ] **Step 2.1: Write failing tests**

```python
# tests/test_reality_check.py
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
import json


async def test_passes_tier1_source_with_corroboration():
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-1", "title": "Big news", "content": "Details",
        "source_tier": 1, "domain_tags": ["ai"],
        "magnitude_score": 8.0, "published_at": datetime.now(timezone.utc),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=3), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.9, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is True


async def test_fails_too_good_to_be_true():
    """magnitude > 9.5 + corroboration < 2 + tier > 1 = too good to be true."""
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-2", "title": "Wild claim", "content": "Unbelievable",
        "source_tier": 3, "domain_tags": ["ai"],
        "magnitude_score": 9.8, "published_at": datetime.now(timezone.utc),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=0), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.8, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is False
    assert result["too_good_to_be_true"] is True


async def test_fails_stale_signal():
    """Signals older than 48h fail reality check."""
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-3", "title": "Old news", "content": "Details",
        "source_tier": 1, "domain_tags": ["ai"],
        "magnitude_score": 8.5,
        "published_at": datetime.now(timezone.utc) - timedelta(days=3),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=3), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.9, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is False


async def test_passes_tier3_with_high_corroboration():
    """Tier 3 source passes if corroboration >= 3."""
    from services.reality_check import run_reality_check
    signal = {
        "id": "sig-4", "title": "Community scoop", "content": "Details",
        "source_tier": 3, "domain_tags": ["ai"],
        "magnitude_score": 8.2, "published_at": datetime.now(timezone.utc),
    }
    with patch("services.reality_check._count_corroborating_signals", new_callable=AsyncMock, return_value=3), \
         patch("services.reality_check._assess_plausibility", new_callable=AsyncMock, return_value={"plausible": True, "score": 0.85, "concerns": []}):
        result = await run_reality_check(signal)
    assert result["passed"] is True
```

- [ ] **Step 2.2: Run to verify failure**
```bash
python -m pytest tests/test_reality_check.py -v
```

- [ ] **Step 2.3: Implement reality_check.py**

```python
# services/reality_check.py
"""Reality check pipeline for alert candidates. See SCORING.md for full logic."""
import json
import logging
from datetime import datetime, timezone, timedelta

from anthropic import AsyncAnthropic
from config import settings

log = logging.getLogger(__name__)
_client: AsyncAnthropic | None = None

_RECENCY_HOURS = 48
_PLAUSIBILITY_THRESHOLD = 0.6


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def _count_corroborating_signals(signal_id: str, domain_tags: list[str], hours: int = 24) -> int:
    from database import get_conn
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT COUNT(*) AS cnt FROM signals
            WHERE id != $1
              AND domain_tags && $2
              AND ingested_at > NOW() - ($3 || ' hours')::interval
              AND processed = TRUE
            """,
            signal_id, domain_tags, str(hours),
        )
        return row["cnt"] if row else 0


_PLAUSIBILITY_PROMPT = """You are a senior technology analyst assessing whether a signal is plausible.

Signal: {title} — {content}
Source tier: {tier}
Domain: {domain}

Does this signal:
1. Contradict established physical, legal, or market reality?
2. Require capabilities that do not currently exist?
3. Claim something so extreme it would require massive independent corroboration?
4. Appear to be satire, fiction, or deliberate misinformation?

Return JSON only:
{{"plausible": true/false, "score": 0.0-1.0, "concerns": ["list any concerns"]}}"""


async def _assess_plausibility(title: str, content: str, tier: int, domain: list[str]) -> dict:
    try:
        response = await _get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=256,
            messages=[{"role": "user", "content": _PLAUSIBILITY_PROMPT.format(
                title=title or "",
                content=(content or "")[:1000],
                tier=tier,
                domain=", ".join(domain),
            )}],
        )
        return json.loads(response.content[0].text.strip())
    except Exception as exc:
        log.warning("Plausibility check failed: %s", exc)
        # Default to plausible on error — don't suppress alerts due to API issues
        return {"plausible": True, "score": 0.5, "concerns": ["plausibility check failed"]}


async def run_reality_check(signal: dict) -> dict:
    """Run all reality checks. Returns dict with 'passed' bool and detail fields."""
    source_tier = signal.get("source_tier", 3)
    magnitude = signal.get("magnitude_score", 0.0) or 0.0
    published_at = signal.get("published_at")
    domain_tags = signal.get("domain_tags", [])
    signal_id = str(signal["id"])

    corroboration_count = await _count_corroborating_signals(signal_id, domain_tags)

    too_good_to_be_true = (
        magnitude > 9.5
        and corroboration_count < 2
        and source_tier > 1
    )

    plausibility = await _assess_plausibility(
        signal.get("title", ""),
        signal.get("content", ""),
        source_tier,
        domain_tags,
    )

    is_fresh = True
    if published_at:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=_RECENCY_HOURS)
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        is_fresh = published_at > cutoff

    source_tier_passed = source_tier <= 2
    plausibility_passed = plausibility.get("score", 0) > _PLAUSIBILITY_THRESHOLD

    passed = (
        not too_good_to_be_true
        and plausibility_passed
        and is_fresh
        and (source_tier_passed or corroboration_count >= 3)
    )

    return {
        "passed": passed,
        "source_tier": source_tier,
        "source_tier_passed": source_tier_passed,
        "corroboration_count": corroboration_count,
        "too_good_to_be_true": too_good_to_be_true,
        "plausibility_score": plausibility.get("score"),
        "plausibility_passed": plausibility_passed,
        "plausibility_concerns": plausibility.get("concerns", []),
        "is_fresh": is_fresh,
    }
```

- [ ] **Step 2.4: Run tests**
```bash
python -m pytest tests/test_reality_check.py -v
```
Expected: 4 PASSED

- [ ] **Step 2.5: Commit**
```bash
git add apps/python/services/reality_check.py apps/python/tests/test_reality_check.py
git commit -m "feat: reality check pipeline — source tier, corroboration, plausibility, recency"
```

---

## Task 3: Alert Detection

**Files:**
- Create: `apps/python/services/alert_detection.py`
- Create: `apps/python/tests/test_alert_detection.py`

Logic from SCORING.md: classify tier (breaking/significant/watch), confidence routing, rate limiting (max 2 per domain per week).

- [ ] **Step 3.1: Write failing tests**

```python
# tests/test_alert_detection.py
from unittest.mock import AsyncMock, patch
from uuid import uuid4


async def test_breaking_alert_high_composite_tier1():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=9.2, corroboration_count=4, source_tier=1)
    assert result == "breaking"


async def test_significant_alert():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=8.7, corroboration_count=2, source_tier=2)
    assert result == "significant"


async def test_watch_alert_low_corroboration():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=8.2, corroboration_count=1, source_tier=2)
    assert result == "watch"


async def test_no_alert_below_threshold():
    from services.alert_detection import classify_alert_tier
    result = classify_alert_tier(composite=7.5, corroboration_count=5, source_tier=1)
    assert result is None


async def test_confidence_routing_confirmed():
    from services.alert_detection import route_confidence
    result = route_confidence(alert_tier="breaking", corroboration_count=4, source_tier=1)
    assert result == "confirmed"


async def test_confidence_routing_pinch_of_salt():
    from services.alert_detection import route_confidence
    result = route_confidence(alert_tier="watch", corroboration_count=1, source_tier=3)
    assert result == "pinch_of_salt"


async def test_too_good_to_be_true_always_pinch_of_salt():
    from services.alert_detection import route_confidence
    result = route_confidence(
        alert_tier="breaking", corroboration_count=5, source_tier=1,
        too_good_to_be_true=True
    )
    assert result == "pinch_of_salt"


async def test_rate_limit_blocks_third_alert_same_domain():
    from services.alert_detection import check_rate_limit
    with patch("services.alert_detection._count_recent_domain_alerts",
               new_callable=AsyncMock, return_value=2):
        allowed = await check_rate_limit(["ai"])
    assert allowed is False


async def test_rate_limit_allows_first_two_alerts():
    from services.alert_detection import check_rate_limit
    with patch("services.alert_detection._count_recent_domain_alerts",
               new_callable=AsyncMock, return_value=1):
        allowed = await check_rate_limit(["ai"])
    assert allowed is True
```

- [ ] **Step 3.2: Run to verify failure**
```bash
python -m pytest tests/test_alert_detection.py -v
```

- [ ] **Step 3.3: Implement alert_detection.py**

```python
# services/alert_detection.py
"""Alert candidate creation and classification. See SCORING.md for all thresholds."""
import logging
from uuid import UUID

log = logging.getLogger(__name__)

_MAX_ALERTS_PER_DOMAIN_PER_WEEK = 2


def classify_alert_tier(composite: float, corroboration_count: int, source_tier: int) -> str | None:
    """Return alert tier or None if composite doesn't meet threshold."""
    if composite >= 9.0 and corroboration_count >= 3 and source_tier <= 2:
        return "breaking"
    if composite >= 8.5 and corroboration_count >= 2:
        return "significant"
    if composite >= 8.0:
        return "watch"
    return None


def route_confidence(
    alert_tier: str,
    corroboration_count: int,
    source_tier: int,
    too_good_to_be_true: bool = False,
) -> str:
    """Map alert tier + context to confidence label."""
    if too_good_to_be_true:
        return "pinch_of_salt"
    if alert_tier == "breaking" and corroboration_count >= 3 and source_tier <= 1:
        return "confirmed"
    if alert_tier in ("breaking", "significant") and corroboration_count >= 2:
        return "developing"
    return "pinch_of_salt"


async def _count_recent_domain_alerts(domain_tags: list[str]) -> int:
    from database import get_conn
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT COUNT(*) AS cnt FROM alert_candidates
            WHERE created_at > NOW() - INTERVAL '7 days'
              AND EXISTS (
                  SELECT 1 FROM signals s
                  WHERE s.id = ANY(alert_candidates.signal_ids)
                    AND s.domain_tags && $1
              )
            """,
            domain_tags,
        )
        return row["cnt"] if row else 0


async def check_rate_limit(domain_tags: list[str]) -> bool:
    """Return True if another alert is allowed for these domains this week."""
    count = await _count_recent_domain_alerts(domain_tags)
    return count < _MAX_ALERTS_PER_DOMAIN_PER_WEEK


async def create_alert_candidate(
    signal_id: UUID,
    scores: dict,
    reality_check: dict,
    alert_tier: str,
    confidence_level: str,
) -> UUID:
    """Insert alert_candidates row and return its UUID."""
    from database import get_conn
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO alert_candidates (
                signal_ids, magnitude_score, irreversibility_score,
                blast_radius_score, velocity_score, composite_score,
                reality_check_passed, source_tier_min, corroboration_count,
                too_good_to_be_true, alert_tier, confidence_level, fired_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
            )
            RETURNING id
            """,
            [signal_id],
            scores["magnitude"], scores["irreversibility"],
            scores["blast_radius"], scores["velocity"], scores["composite"],
            reality_check["passed"],
            reality_check["source_tier"],
            reality_check["corroboration_count"],
            reality_check["too_good_to_be_true"],
            alert_tier, confidence_level,
        )
        return row["id"]
```

- [ ] **Step 3.4: Run tests**
```bash
python -m pytest tests/test_alert_detection.py -v
```
Expected: 9 PASSED

- [ ] **Step 3.5: Commit**
```bash
git add apps/python/services/alert_detection.py apps/python/tests/test_alert_detection.py
git commit -m "feat: alert detection — tier classification, confidence routing, rate limiting"
```

---

## Task 4: Cluster Readiness

**Files:**
- Create: `apps/python/services/readiness.py`
- Create: `apps/python/tests/test_readiness.py`

Logic from SCORING.md: volume (0-25) + diversity (0-25) + novelty (0-20) + trajectory_shift (0-20) + cross_domain (0-10). Threshold 75.0. Hard cap 5 days.

- [ ] **Step 4.1: Write failing tests**

```python
# tests/test_readiness.py
from unittest.mock import AsyncMock, patch


async def test_readiness_score_components_sum_correctly():
    from services.readiness import calculate_readiness_score
    score = calculate_readiness_score(
        signal_count=20, unique_sources=10,
        novelty_score=15.0, trajectory_shift_score=10.0, cross_domain_score=5.0
    )
    # volume: min(20/20*25, 25) = 25
    # diversity: min(10/10*25, 25) = 25
    # novelty: 15.0, trajectory: 10.0, cross_domain: 5.0
    assert score == 80.0


async def test_readiness_caps_components_at_max():
    from services.readiness import calculate_readiness_score
    score = calculate_readiness_score(
        signal_count=100, unique_sources=50,
        novelty_score=20.0, trajectory_shift_score=20.0, cross_domain_score=10.0
    )
    assert score == 100.0


async def test_readiness_below_threshold_does_not_trigger():
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=70.0, days_since_last_pack=2) is False


async def test_readiness_above_threshold_triggers():
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=76.0, days_since_last_pack=2) is True


async def test_hard_cap_triggers_regardless_of_score():
    """If 5+ days since last pack, trigger regardless of readiness score."""
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=30.0, days_since_last_pack=5) is True


async def test_no_previous_pack_treated_as_hard_cap():
    """days_since_last_pack=None (never published) → always trigger after threshold."""
    from services.readiness import should_trigger_content_pack
    assert should_trigger_content_pack(readiness_score=76.0, days_since_last_pack=None) is True
```

- [ ] **Step 4.2: Run to verify failure**
```bash
python -m pytest tests/test_readiness.py -v
```

- [ ] **Step 4.3: Implement readiness.py**

```python
# services/readiness.py
"""Cluster readiness scoring. Determines when a cluster has enough signal
for a content pack. See SCORING.md for full component breakdown."""
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
    if days_since_last_pack is None or days_since_last_pack >= HARD_CAP_DAYS:
        return readiness_score >= READINESS_THRESHOLD
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
        return score
```

- [ ] **Step 4.4: Run tests**
```bash
python -m pytest tests/test_readiness.py -v
```
Expected: 6 PASSED

- [ ] **Step 4.5: Commit**
```bash
git add apps/python/services/readiness.py apps/python/tests/test_readiness.py
git commit -m "feat: cluster readiness scoring — volume, diversity, threshold, hard cap"
```

---

## Task 5: Wire Into Ingest + Score Endpoint

**Files:**
- Modify: `apps/python/routers/ingest.py`
- Create: `apps/python/routers/score.py`
- Modify: `apps/python/main.py`

- [ ] **Step 5.1: Update ingest.py to run the full pipeline after clustering**

After `assign_cluster`, add:
```python
from services.scoring import score_signal, apply_scores_to_signal, ALERT_CANDIDATE_THRESHOLD
from services.reality_check import run_reality_check
from services.alert_detection import classify_alert_tier, route_confidence, check_rate_limit, create_alert_candidate
from services.readiness import recalculate_cluster_readiness
```

And after `await assign_cluster(signal_id, embedding)`:
```python
    # Run scoring async — don't fail ingest if scoring fails
    try:
        source_info = await _get_source_info(req.source_id)
        scores = await score_signal(
            title=req.title or "",
            content=req.content or "",
            source_name=source_info["name"] if source_info else "Unknown",
            source_tier=source_info["tier"] if source_info else 3,
            domain_tags=req.domain_tags,
        )
        if scores:
            await apply_scores_to_signal(str(signal_id), scores)

            if scores["composite"] >= ALERT_CANDIDATE_THRESHOLD:
                source_tier = source_info["tier"] if source_info else 3
                reality = await run_reality_check({
                    "id": str(signal_id),
                    "title": req.title, "content": req.content,
                    "source_tier": source_tier,
                    "domain_tags": req.domain_tags,
                    "magnitude_score": scores["magnitude"],
                    "published_at": req.published_at,
                })
                if reality["passed"] and await check_rate_limit(req.domain_tags):
                    alert_tier = classify_alert_tier(
                        scores["composite"], reality["corroboration_count"], source_tier
                    )
                    if alert_tier:
                        confidence = route_confidence(
                            alert_tier, reality["corroboration_count"],
                            source_tier, reality["too_good_to_be_true"]
                        )
                        await create_alert_candidate(signal_id, scores, reality, alert_tier, confidence)
    except Exception as exc:
        log.warning("Post-ingest pipeline failed for signal %s: %s", signal_id, exc)

    # Recalculate cluster readiness (updates cluster table)
    if cluster_id := await _get_signal_cluster(str(signal_id)):
        try:
            await recalculate_cluster_readiness(cluster_id)
        except Exception as exc:
            log.warning("Readiness recalculation failed for cluster %s: %s", cluster_id, exc)
```

Add helper functions:
```python
async def _get_source_info(source_id) -> dict | None:
    if not source_id:
        return None
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT name, tier FROM sources WHERE id = $1", source_id
        )
        return dict(row) if row else None

async def _get_signal_cluster(signal_id: str) -> UUID | None:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT cluster_id FROM signals WHERE id = $1", signal_id
        )
        return row["cluster_id"] if row else None
```

- [ ] **Step 5.2: Create score.py standalone endpoint**

```python
# routers/score.py
"""POST /score — standalone scoring endpoint for N8N or manual triggers."""
from uuid import UUID
from pydantic import BaseModel
from fastapi import APIRouter
from services.scoring import score_signal, apply_scores_to_signal

router = APIRouter()


class ScoreRequest(BaseModel):
    signal_id: UUID
    title: str
    content: str
    source_name: str = "Unknown"
    source_tier: int = 3
    domain_tags: list[str] = []


class ScoreResponse(BaseModel):
    signal_id: UUID
    magnitude: float | None
    irreversibility: float | None
    blast_radius: float | None
    velocity: float | None
    composite: float | None
    scored: bool


@router.post("/score", response_model=ScoreResponse)
async def score_signal_endpoint(req: ScoreRequest) -> ScoreResponse:
    scores = await score_signal(req.title, req.content, req.source_name, req.source_tier, req.domain_tags)
    if scores:
        await apply_scores_to_signal(str(req.signal_id), scores)
    return ScoreResponse(
        signal_id=req.signal_id,
        magnitude=scores["magnitude"] if scores else None,
        irreversibility=scores["irreversibility"] if scores else None,
        blast_radius=scores["blast_radius"] if scores else None,
        velocity=scores["velocity"] if scores else None,
        composite=scores["composite"] if scores else None,
        scored=scores is not None,
    )
```

- [ ] **Step 5.3: Register score router in main.py**

```python
from routers import ingest, score
app.include_router(score.router)
```

- [ ] **Step 5.4: Run full test suite**
```bash
python -m pytest tests/ -v --tb=short
```
Expected: all tests pass (27+ tests)

- [ ] **Step 5.5: Commit and push**
```bash
git add apps/python/
git commit -m "feat: wire Phase 2 pipeline into ingest — scoring, reality check, alert detection, readiness"
git push origin master
```
