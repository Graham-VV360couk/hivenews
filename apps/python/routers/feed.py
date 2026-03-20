"""Feed ingestion routes.

POST /feed/poll            — fetch all active RSS sources, ingest new items
POST /feed/backfill/hn     — backfill HN stories via Algolia (no auth, years of history)
POST /feed/backfill/reddit — backfill Reddit posts via public JSON API
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

import feedparser
import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from database import get_conn
from services.alert_detection import (
    check_rate_limit,
    classify_alert_tier,
    create_alert_candidate,
    route_confidence,
)
from services.clustering import assign_cluster
from services.dedup import is_duplicate, mark_seen
from services.embedding import generate_embedding
from services.readiness import recalculate_cluster_readiness
from services.reality_check import run_reality_check
from services.scoring import ALERT_CANDIDATE_THRESHOLD, apply_scores_to_signal, score_signal

log = logging.getLogger(__name__)
router = APIRouter(prefix="/feed", tags=["feed"])

# ---------------------------------------------------------------------------
# Core pipeline — shared between poll and backfill routes
# ---------------------------------------------------------------------------

async def _store_signal(
    source_id, title, content, url, published_at,
    domain_tags, source_type, embedding
) -> UUID:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO signals (
                source_id, title, content, url, published_at,
                domain_tags, source_type, is_public, provenance_url, embedding
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$4,$8::vector)
            RETURNING id
            """,
            source_id, title, content, url, published_at,
            domain_tags, source_type, embedding,
        )
        return row["id"]


async def _get_source_info(source_id) -> dict | None:
    if not source_id:
        return None
    async with get_conn() as conn:
        row = await conn.fetchrow("SELECT name, tier FROM sources WHERE id = $1", source_id)
        return dict(row) if row else None


async def _get_signal_cluster(signal_id: str) -> UUID | None:
    async with get_conn() as conn:
        row = await conn.fetchrow("SELECT cluster_id FROM signals WHERE id = $1", signal_id)
        return row["cluster_id"] if row else None


async def run_pipeline(
    source_id, title: str, content: str, url: str,
    published_at: datetime | None, domain_tags: list[str], source_type: str
) -> str:
    """
    Run a single item through the full ingest pipeline.
    Returns: 'ingested' | 'duplicate' | 'error'
    """
    if not title and not content:
        return "error"

    try:
        if await is_duplicate(url):
            return "duplicate"

        text = f"{title} {content}".strip()
        embedding = await generate_embedding(text)
        signal_id = await _store_signal(
            source_id, title, content, url, published_at,
            domain_tags, source_type, embedding
        )
        await mark_seen(url)
        await assign_cluster(signal_id, embedding)

        try:
            source_info = await _get_source_info(source_id)
            scores = await score_signal(
                title=title,
                content=content,
                source_name=source_info["name"] if source_info else "Unknown",
                source_tier=source_info["tier"] if source_info else 3,
                domain_tags=domain_tags,
            )
            if scores:
                await apply_scores_to_signal(str(signal_id), scores)
                if scores["composite"] >= ALERT_CANDIDATE_THRESHOLD:
                    source_tier = source_info["tier"] if source_info else 3
                    reality = await run_reality_check({
                        "id": str(signal_id),
                        "title": title,
                        "content": content,
                        "source_tier": source_tier,
                        "domain_tags": domain_tags,
                        "magnitude_score": scores["magnitude"],
                        "published_at": published_at,
                    })
                    if reality["passed"] and await check_rate_limit(domain_tags):
                        alert_tier = classify_alert_tier(
                            scores["composite"], reality["corroboration_count"], source_tier
                        )
                        if alert_tier:
                            confidence = route_confidence(
                                alert_tier, reality["corroboration_count"],
                                source_tier, reality["too_good_to_be_true"]
                            )
                            await create_alert_candidate(
                                signal_id, scores, reality, alert_tier, confidence
                            )
        except Exception as exc:
            log.warning("Post-ingest pipeline failed for %s: %s", url, exc)

        if cluster_id := await _get_signal_cluster(str(signal_id)):
            try:
                await recalculate_cluster_readiness(cluster_id)
            except Exception as exc:
                log.warning("Readiness recalculation failed: %s", exc)

        return "ingested"
    except Exception as exc:
        log.error("Pipeline error for %s: %s", url, exc)
        return "error"


# ---------------------------------------------------------------------------
# RSS poll
# ---------------------------------------------------------------------------

@router.post("/poll")
async def poll_rss_sources() -> dict:
    """Fetch all active RSS sources and ingest any new items found in the feed."""
    async with get_conn() as conn:
        sources = await conn.fetch(
            "SELECT id, name, url, domain_tags FROM sources WHERE platform = 'rss' AND is_active = TRUE AND url IS NOT NULL"
        )

    ingested = skipped = errors = 0

    async with httpx.AsyncClient(timeout=20) as client:
        for source in sources:
            try:
                resp = await client.get(source["url"], follow_redirects=True)
                feed = feedparser.parse(resp.text)
            except Exception as exc:
                log.warning("Failed to fetch feed %s: %s", source["url"], exc)
                errors += 1
                continue

            for entry in feed.entries:
                url = entry.get("link", "")
                if not url:
                    continue

                title = entry.get("title", "")
                content = (
                    entry.get("summary", "")
                    or entry.get("content", [{}])[0].get("value", "")
                )

                # Parse published date
                published_at = None
                if pt := entry.get("published_parsed"):
                    try:
                        published_at = datetime(*pt[:6], tzinfo=timezone.utc)
                    except Exception:
                        pass

                result = await run_pipeline(
                    source_id=source["id"],
                    title=title,
                    content=content,
                    url=url,
                    published_at=published_at,
                    domain_tags=list(source["domain_tags"] or []),
                    source_type="rss",
                )
                if result == "ingested":
                    ingested += 1
                elif result == "duplicate":
                    skipped += 1
                else:
                    errors += 1

            # Update last_ingested
            async with get_conn() as conn:
                await conn.execute(
                    "UPDATE sources SET last_ingested = NOW() WHERE id = $1", source["id"]
                )

    return {
        "sources_polled": len(sources),
        "ingested": ingested,
        "skipped_duplicates": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# HN backfill (Algolia Search API — no auth required)
# ---------------------------------------------------------------------------

class HNBackfillRequest(BaseModel):
    query: str = ""
    tags: str = "story"           # story | ask_hn | show_hn | poll
    domain_tags: list[str] = []
    days_back: int = 365          # how many days of history to fetch
    max_items: int = 1000


@router.post("/backfill/hn")
async def backfill_hn(req: HNBackfillRequest) -> dict:
    """
    Backfill stories from Hacker News via the Algolia HN Search API.
    Free, no auth required. Supports full history going back years.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=req.days_back)
    cutoff_ts = int(cutoff.timestamp())

    ingested = skipped = errors = page = 0
    base = "https://hn.algolia.com/api/v1/search_by_date"

    params = {
        "tags": req.tags,
        "numericFilters": f"created_at_i>{cutoff_ts}",
        "hitsPerPage": 100,
        "page": 0,
    }
    if req.query:
        params["query"] = req.query

    # Find or look up the HN source id
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM sources WHERE platform = 'hackernews' AND is_active = TRUE LIMIT 1"
        )
    hn_source_id = row["id"] if row else None

    async with httpx.AsyncClient(timeout=30) as client:
        while ingested + skipped < req.max_items:
            params["page"] = page
            try:
                resp = await client.get(base, params=params)
                data = resp.json()
            except Exception as exc:
                log.error("HN API error page %d: %s", page, exc)
                break

            hits = data.get("hits", [])
            if not hits:
                break

            for hit in hits:
                if ingested + skipped >= req.max_items:
                    break

                url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
                title = hit.get("title", "")
                content = hit.get("story_text", "") or ""

                ts = hit.get("created_at_i")
                published_at = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None

                result = await run_pipeline(
                    source_id=hn_source_id,
                    title=title,
                    content=content,
                    url=url,
                    published_at=published_at,
                    domain_tags=req.domain_tags,
                    source_type="hackernews",
                )
                if result == "ingested":
                    ingested += 1
                elif result == "duplicate":
                    skipped += 1
                else:
                    errors += 1

            nb_pages = data.get("nbPages", 0)
            page += 1
            if page >= nb_pages:
                break

            await asyncio.sleep(0.3)  # be polite to the API

    return {
        "source": "hackernews",
        "query": req.query or "(all stories)",
        "days_back": req.days_back,
        "ingested": ingested,
        "skipped_duplicates": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Reddit backfill (public .json API)
# ---------------------------------------------------------------------------

class RedditBackfillRequest(BaseModel):
    subreddit: str                # e.g. "MachineLearning"
    domain_tags: list[str] = []
    days_back: int = 90
    max_items: int = 500


@router.post("/backfill/reddit")
async def backfill_reddit(req: RedditBackfillRequest) -> dict:
    """
    Backfill posts from a Reddit subreddit via the public JSON API.
    Uses 'top' listing sorted by 'year' for historical coverage.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=req.days_back)

    ingested = skipped = errors = 0
    after = None

    # Find or look up the Reddit source id
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM sources WHERE platform = 'reddit' AND LOWER(name) LIKE $1 AND is_active = TRUE LIMIT 1",
            f"%{req.subreddit.lower()}%",
        )
    reddit_source_id = row["id"] if row else None

    headers = {"User-Agent": "NewsHive/1.0 backfill-bot"}
    base = f"https://www.reddit.com/r/{req.subreddit}/top.json"

    async with httpx.AsyncClient(timeout=30, headers=headers) as client:
        while ingested + skipped < req.max_items:
            params: dict = {"limit": 100, "t": "year" if req.days_back > 30 else "month"}
            if after:
                params["after"] = after

            try:
                resp = await client.get(base, params=params)
                if resp.status_code == 429:
                    log.warning("Reddit rate limited, stopping")
                    break
                data = resp.json()
            except Exception as exc:
                log.error("Reddit API error: %s", exc)
                break

            posts = data.get("data", {}).get("children", [])
            if not posts:
                break

            for post in posts:
                if ingested + skipped >= req.max_items:
                    break

                p = post["data"]
                created_utc = p.get("created_utc", 0)
                published_at = datetime.fromtimestamp(created_utc, tz=timezone.utc)

                if published_at < cutoff:
                    continue

                url = p.get("url", "")
                permalink = f"https://reddit.com{p.get('permalink', '')}"
                title = p.get("title", "")
                content = p.get("selftext", "") or ""

                result = await run_pipeline(
                    source_id=reddit_source_id,
                    title=title,
                    content=content,
                    url=url or permalink,
                    published_at=published_at,
                    domain_tags=req.domain_tags,
                    source_type="reddit",
                )
                if result == "ingested":
                    ingested += 1
                elif result == "duplicate":
                    skipped += 1
                else:
                    errors += 1

            after = data.get("data", {}).get("after")
            if not after:
                break

            await asyncio.sleep(1.0)  # Reddit enforces ~1 req/sec

    return {
        "source": f"reddit/r/{req.subreddit}",
        "days_back": req.days_back,
        "ingested": ingested,
        "skipped_duplicates": skipped,
        "errors": errors,
    }
