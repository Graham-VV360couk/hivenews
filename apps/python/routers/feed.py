"""Feed ingestion routes.

POST /feed/poll            — fetch all active RSS sources, ingest new items
POST /feed/backfill/hn     — backfill HN stories via Algolia (no auth, years of history)
POST /feed/backfill/reddit — backfill Reddit posts via public JSON API
"""

import asyncio
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from uuid import UUID

import feedparser
import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
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
from services.narrative import synthesise_narrative
from services.readiness import recalculate_cluster_readiness
from services.reality_check import run_reality_check
from services.scoring import ALERT_CANDIDATE_THRESHOLD, apply_scores_to_signal, score_signal

log = logging.getLogger(__name__)
router = APIRouter(prefix="/feed", tags=["feed"])


def _mem_mb() -> str:
    """Return current RSS memory usage in MB (Linux only, safe to call anywhere)."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    kb = int(line.split()[1])
                    return f"{kb // 1024}MB"
    except Exception:
        pass
    return "?"

# Thread pool for running blocking feedparser calls without freezing the event loop
_thread_pool = ThreadPoolExecutor(max_workers=4)


async def _parse_feed(text: str):
    """Run feedparser (blocking) in a thread pool to avoid blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_thread_pool, feedparser.parse, text)

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
        await assign_cluster(signal_id, embedding, domain_tags=domain_tags, title=title)

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

# Max new items per feed per poll run.
# First-time poll (no last_ingested): higher cap — accept the upfront cost.
# Subsequent polls: lower cap — feeds typically have <20 new items/day.
_MAX_NEW_FIRST_RUN = 100
_MAX_NEW_PER_FEED  = 30


@router.post("/poll")
async def poll_rss_sources() -> dict:
    """Fetch all active RSS sources and ingest any new items found in the feed."""
    async with get_conn() as conn:
        sources = await conn.fetch(
            "SELECT id, name, url, domain_tags, last_ingested FROM sources "
            "WHERE platform IN ('rss', 'github') AND is_active = TRUE AND url IS NOT NULL"
        )

    ingested = skipped = errors = 0

    async with httpx.AsyncClient(timeout=20) as client:
        for source in sources:
            last_ingested = source["last_ingested"]
            cutoff: datetime | None = None
            if last_ingested:
                if last_ingested.tzinfo is None:
                    last_ingested = last_ingested.replace(tzinfo=timezone.utc)
                cutoff = last_ingested - timedelta(hours=1)

            # Streaming fetch with 3MB cap (same as poll-stream) to avoid OOM
            _MAX_FEED_BYTES = 3 * 1024 * 1024
            fetch_error = None
            chunks: list[bytes] = []
            try:
                async with client.stream("GET", source["url"], follow_redirects=True) as resp:
                    if resp.status_code >= 400:
                        fetch_error = f"HTTP {resp.status_code}"
                    else:
                        total_bytes = 0
                        async for chunk in resp.aiter_bytes(65536):
                            chunks.append(chunk)
                            total_bytes += len(chunk)
                            if total_bytes >= _MAX_FEED_BYTES:
                                log.warning("Feed %s: capped at 3MB", source["name"])
                                break
            except BaseException as exc:
                if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                    raise
                if not chunks:
                    fetch_error = str(exc)
                else:
                    log.warning("Feed %s stream close: %s (proceeding)", source["name"], exc)

            if fetch_error:
                log.warning("Failed to fetch feed %s: %s", source["url"], fetch_error)
                errors += 1
                continue

            try:
                feed = await _parse_feed(b"".join(chunks).decode("utf-8", errors="replace"))
            except Exception as exc:
                log.warning("Failed to parse feed %s: %s", source["url"], exc)
                errors += 1
                continue

            cap = _MAX_NEW_FIRST_RUN if not source["last_ingested"] else _MAX_NEW_PER_FEED
            new_count = 0
            for entry in feed.entries[:150]:
                if new_count >= cap:
                    break

                url = entry.get("link", "")
                if not url:
                    continue

                published_at = None
                if pt := entry.get("published_parsed"):
                    try:
                        published_at = datetime(*pt[:6], tzinfo=timezone.utc)
                    except Exception:
                        pass

                if cutoff and published_at and published_at < cutoff:
                    continue

                title = entry.get("title", "")
                content = (
                    entry.get("summary", "")
                    or (entry.get("content") or [{}])[0].get("value", "")
                )

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
                    new_count += 1
                elif result == "duplicate":
                    skipped += 1
                else:
                    errors += 1
                    new_count += 1

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
# RSS poll — streaming (SSE) with per-feed log events
# ---------------------------------------------------------------------------

@router.post("/poll-stream")
async def poll_rss_stream() -> StreamingResponse:
    """
    Same as /feed/poll but streams Server-Sent Events so the dashboard can
    display live per-feed progress logs.
    """

    async def _generate():
        def evt(data: dict) -> str:
            return f"data: {json.dumps(data)}\n\n"

        async with get_conn() as conn:
            sources = await conn.fetch(
                "SELECT id, name, url, domain_tags, last_ingested "
                "FROM sources "
                "WHERE platform IN ('rss', 'github') AND is_active = TRUE AND url IS NOT NULL "
                "ORDER BY name"
            )

        yield evt({"type": "start", "total": len(sources),
                   "msg": f"Found {len(sources)} active RSS source(s)"})

        total_ingested = total_skipped = total_errors = 0

        async with httpx.AsyncClient(timeout=20) as client:
            for source in sources:
                name = source["name"]
                url  = source["url"]
                domain_tags = list(source["domain_tags"] or [])
                last_ingested = source["last_ingested"]  # datetime | None

                yield evt({"type": "feed_start", "name": name, "url": url,
                           "msg": f"Connecting to {name}…"})

                try:
                    # --- Fetch (streaming, hard 3MB cap) ---
                    # Large feeds (e.g. HuggingFace 750 items) can be 15-20MB
                    # raw. Buffering with client.get() OOMs the container.
                    # Stream and stop at 3MB. Breaking early may raise
                    # CancelledError during httpx cleanup — catch BaseException
                    # so it doesn't silently kill the generator.
                    _MAX_FEED_BYTES = 3 * 1024 * 1024
                    fetch_error = None
                    chunks: list[bytes] = []
                    try:
                        async with client.stream("GET", url, follow_redirects=True) as resp:
                            if resp.status_code >= 400:
                                fetch_error = f"HTTP {resp.status_code}"
                            else:
                                total_bytes = 0
                                async for chunk in resp.aiter_bytes(65536):
                                    chunks.append(chunk)
                                    total_bytes += len(chunk)
                                    if total_bytes >= _MAX_FEED_BYTES:
                                        log.warning("Feed %s: capped at 3MB", name)
                                        break
                    except BaseException as exc:
                        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                            raise
                        if not chunks:
                            # Nothing downloaded at all — real error
                            fetch_error = str(exc)
                        else:
                            # Got data but cleanup raised (e.g. CancelledError
                            # from early break) — log and proceed with what we have
                            log.warning("Feed %s stream close: %s (proceeding with %dKB)",
                                        name, exc, sum(len(c) for c in chunks) // 1024)

                    if fetch_error:
                        yield evt({"type": "feed_error", "name": name,
                                   "msg": f"  ✗ Failed to fetch: {fetch_error}"})
                        total_errors += 1
                        continue

                    feed_text = b"".join(chunks).decode("utf-8", errors="replace")
                    log.info("[%s] mem=%s fetched %dKB (%d chunks)",
                             name, _mem_mb(), len(feed_text) // 1024, len(chunks))

                    # --- Parse ---
                    try:
                        feed = await _parse_feed(feed_text)
                    except Exception as exc:
                        yield evt({"type": "feed_error", "name": name,
                                   "msg": f"  ✗ Failed to parse feed: {exc}"})
                        total_errors += 1
                        continue

                    entry_count = len(feed.entries)
                    feed_title  = feed.feed.get("title", name)
                    log.info("[%s] mem=%s parsed %d entries", name, _mem_mb(), entry_count)

                    # Build cutoff: skip entries older than last_ingested
                    # (with 1hr overlap to avoid missing late-arriving items)
                    cutoff: datetime | None = None
                    if last_ingested:
                        li = last_ingested
                        if li.tzinfo is None:
                            li = li.replace(tzinfo=timezone.utc)
                        cutoff = li - timedelta(hours=1)

                    # Pre-filter to candidates newer than cutoff.
                    # RSS feeds are newest-first, so we only need to scan the
                    # first MAX_SCAN entries — no value in looking at entry 500+
                    # of a 750-item feed.
                    MAX_SCAN = 150
                    candidates = []
                    for entry in feed.entries[:MAX_SCAN]:
                        url_item = entry.get("link", "")
                        if not url_item:
                            continue
                        published_at = None
                        if pt := entry.get("published_parsed"):
                            try:
                                published_at = datetime(*pt[:6], tzinfo=timezone.utc)
                            except Exception:
                                pass
                        if cutoff and published_at and published_at < cutoff:
                            continue
                        candidates.append((url_item, entry, published_at))

                    new_count = len(candidates)
                    cap = _MAX_NEW_FIRST_RUN if not last_ingested else _MAX_NEW_PER_FEED
                    log.info("[%s] mem=%s %d candidates (cap=%d, cutoff=%s)",
                             name, _mem_mb(), new_count, cap,
                             cutoff.isoformat() if cutoff else "none")
                    yield evt({"type": "feed_connected", "name": name,
                               "feed_title": feed_title, "entry_count": entry_count,
                               "new_count": new_count,
                               "msg": f"  ✓ Connected — \"{feed_title}\" — {entry_count} item(s), {new_count} new since last poll"})

                    # --- Process ---
                    ingested = skipped = errors = 0
                    batch = candidates[:cap]

                    for idx, (url_item, entry, published_at) in enumerate(batch):
                        # Keepalive BEFORE each item — guarantees the SSE
                        # connection never goes silent for longer than one
                        # item's processing timeout (30s)
                        yield evt({
                            "type": "feed_progress",
                            "name": name,
                            "processed": idx,
                            "total": len(batch),
                            "ingested": ingested,
                            "msg": f"  … {idx + 1}/{len(batch)}",
                        })

                        title   = entry.get("title", "")
                        content = (
                            entry.get("summary", "")
                            or (entry.get("content") or [{}])[0].get("value", "")
                        )
                        log.info("[%s] item %d/%d mem=%s url=%.80s",
                                 name, idx + 1, len(batch), _mem_mb(), url_item)
                        try:
                            result = await asyncio.wait_for(
                                run_pipeline(
                                    source_id=source["id"],
                                    title=title,
                                    content=content,
                                    url=url_item,
                                    published_at=published_at,
                                    domain_tags=domain_tags,
                                    source_type="rss",
                                ),
                                timeout=30,
                            )
                        except asyncio.TimeoutError:
                            log.warning("Pipeline timeout for %s", url_item)
                            result = "error"
                        except Exception as exc:
                            log.warning("Pipeline exception for %s: %s", url_item, exc)
                            result = "error"

                        if result == "ingested":
                            ingested += 1
                        elif result == "duplicate":
                            skipped += 1
                        else:
                            errors += 1

                        # Yield control back to the event loop between items.
                        # Prevents rate-limit pile-ups and keeps the SSE
                        # stream flushed.
                        await asyncio.sleep(0)

                    log.info("[%s] mem=%s done — ingested=%d skipped=%d errors=%d",
                             name, _mem_mb(), ingested, skipped, errors)
                    capped = max(0, new_count - cap)
                    total_ingested += ingested
                    total_skipped  += skipped
                    total_errors   += errors

                    parts = [f"ingested {ingested}"]
                    if skipped:
                        parts.append(f"{skipped} duplicate(s) skipped")
                    if errors:
                        parts.append(f"{errors} error(s)")
                    if capped:
                        parts.append(f"{capped} deferred to next poll")
                    yield evt({
                        "type": "feed_done",
                        "name": name,
                        "ingested": ingested,
                        "skipped": skipped,
                        "errors": errors,
                        "capped": capped,
                        "msg": f"  → {', '.join(parts)}",
                    })

                    # Update last_ingested timestamp
                    async with get_conn() as conn:
                        await conn.execute(
                            "UPDATE sources SET last_ingested = NOW() WHERE id = $1",
                            source["id"]
                        )

                except Exception as exc:
                    log.error("Unhandled error processing feed %s: %s", name, exc)
                    yield evt({"type": "feed_error", "name": name,
                               "msg": f"  ✗ Unexpected error: {exc}"})
                    total_errors += 1

        yield evt({
            "type": "complete",
            "total_ingested": total_ingested,
            "total_skipped": total_skipped,
            "total_errors": total_errors,
            "sources": len(sources),
            "msg": (
                f"Done — {total_ingested} ingested, "
                f"{total_skipped} duplicates skipped, "
                f"{total_errors} error(s) across {len(sources)} feed(s)"
            ),
        })

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
# Reddit — news extraction with quality filters
# ---------------------------------------------------------------------------

# Domains that indicate images, videos, or memes — not news articles
_NOISE_DOMAINS = {
    "i.redd.it", "v.redd.it", "imgur.com", "i.imgur.com",
    "gfycat.com", "redgifs.com", "streamable.com",
    "reddit.com", "old.reddit.com",  # self/discussion posts via URL
    "gallery",  # reddit galleries
}


def _is_noise(post: dict) -> bool:
    """Return True if this post should be filtered out as non-news."""
    # Self/text posts have no external article to link to
    if post.get("is_self"):
        return True
    url = post.get("url", "")
    # Extract domain from URL
    try:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc.lower().lstrip("www.")
        if domain in _NOISE_DOMAINS:
            return True
        # Image/video file extensions
        path = urlparse(url).path.lower()
        if any(path.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".mp4", ".webm")):
            return True
    except Exception:
        pass
    return False


class RedditBackfillRequest(BaseModel):
    subreddit: str                   # e.g. "MachineLearning"
    domain_tags: list[str] = []
    days_back: int = 90
    max_items: int = 300
    min_score: int = 10              # ignore posts below this upvote count
    search_query: str = ""           # optional keyword filter within subreddit
    links_only: bool = True          # skip self/text posts, only external articles


@router.post("/backfill/reddit")
async def backfill_reddit(req: RedditBackfillRequest) -> dict:
    """
    Pull news articles from a Reddit subreddit.

    Filters applied:
    - links_only: skip self/text posts (no external article)
    - min_score: skip low-upvote posts (noise, memes)
    - domain blocklist: skip image hosts, video hosts, reddit galleries
    - search_query: if set, uses /search endpoint to find keyword-relevant posts

    Use search_query to narrow a broad subreddit (e.g. r/technology + "AI agents")
    rather than pulling the full firehose.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=req.days_back)

    ingested = skipped_dup = filtered = errors = 0
    after = None

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM sources WHERE platform = 'reddit' "
            "AND LOWER(name) LIKE $1 AND is_active = TRUE LIMIT 1",
            f"%{req.subreddit.lower()}%",
        )
    reddit_source_id = row["id"] if row else None

    headers = {"User-Agent": "NewsHive/1.0 news-bot"}
    time_filter = "year" if req.days_back > 30 else "month"

    # Use search endpoint when a query is provided — much better signal/noise
    if req.search_query:
        base = f"https://www.reddit.com/r/{req.subreddit}/search.json"
    else:
        base = f"https://www.reddit.com/r/{req.subreddit}/top.json"

    async with httpx.AsyncClient(timeout=30, headers=headers) as client:
        while (ingested + skipped_dup) < req.max_items:
            params: dict = {"limit": 100, "t": time_filter}
            if after:
                params["after"] = after
            if req.search_query:
                params["q"] = req.search_query
                params["restrict_sr"] = "1"
                params["sort"] = "top"

            try:
                resp = await client.get(base, params=params)
                if resp.status_code == 429:
                    log.warning("Reddit rate limited on r/%s", req.subreddit)
                    break
                resp.raise_for_status()
                data = resp.json()
            except Exception as exc:
                log.error("Reddit API error r/%s: %s", req.subreddit, exc)
                break

            posts = data.get("data", {}).get("children", [])
            if not posts:
                break

            for post in posts:
                if (ingested + skipped_dup) >= req.max_items:
                    break

                p = post["data"]
                created_utc = p.get("created_utc", 0)
                published_at = datetime.fromtimestamp(created_utc, tz=timezone.utc)

                if published_at < cutoff:
                    filtered += 1
                    continue

                # Quality filters
                score = p.get("score", 0)
                if score < req.min_score:
                    filtered += 1
                    continue

                if req.links_only and _is_noise(p):
                    filtered += 1
                    continue

                url = p.get("url", "")
                permalink = f"https://reddit.com{p.get('permalink', '')}"
                title = p.get("title", "")
                # For link posts, content is usually empty or the crosspost caption
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
                    skipped_dup += 1
                else:
                    errors += 1

            after = data.get("data", {}).get("after")
            if not after:
                break

            await asyncio.sleep(1.0)  # Reddit rate limit ~1 req/sec

    return {
        "source": f"reddit/r/{req.subreddit}",
        "search_query": req.search_query or None,
        "days_back": req.days_back,
        "min_score": req.min_score,
        "ingested": ingested,
        "skipped_duplicates": skipped_dup,
        "filtered_noise": filtered,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# HN live poll — official Firebase API (no auth required, fully public)
# Fetches top/new/best story IDs then resolves each item individually.
# This is the canonical source; use Algolia backfill for historical depth.
# ---------------------------------------------------------------------------

HN_BASE = "https://hacker-news.firebaseio.com/v0"

class HNLiveRequest(BaseModel):
    feed: str = "top"          # top | new | best
    max_items: int = 200
    domain_tags: list[str] = []


@router.post("/hn-live")
async def poll_hn_live(req: HNLiveRequest) -> dict:
    """
    Poll Hacker News using the official Firebase REST API.
    Fetches story IDs from /topstories, /newstories, or /beststories,
    then resolves each item. No authentication required.
    """
    feed_map = {"top": "topstories", "new": "newstories", "best": "beststories"}
    feed_path = feed_map.get(req.feed, "topstories")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM sources WHERE platform = 'hackernews' AND is_active = TRUE LIMIT 1"
        )
    hn_source_id = row["id"] if row else None

    ingested = skipped = errors = 0

    async with httpx.AsyncClient(timeout=30) as client:
        # Step 1 — fetch the list of story IDs
        try:
            id_resp = await client.get(f"{HN_BASE}/{feed_path}.json")
            id_resp.raise_for_status()
            story_ids: list[int] = id_resp.json()
        except Exception as exc:
            log.error("Failed to fetch HN %s: %s", feed_path, exc)
            return {"error": str(exc)}

        story_ids = story_ids[: req.max_items]

        # Step 2 — fetch each item concurrently in batches of 20
        async def fetch_item(item_id: int) -> dict | None:
            try:
                r = await client.get(f"{HN_BASE}/item/{item_id}.json")
                r.raise_for_status()
                return r.json()
            except Exception:
                return None

        batch_size = 20
        unresolved = 0
        for i in range(0, len(story_ids), batch_size):
            batch = story_ids[i: i + batch_size]
            items = await asyncio.gather(*[fetch_item(sid) for sid in batch])

            for item in items:
                if not item:
                    unresolved += 1
                    continue
                if item.get("type") != "story":
                    continue

                url   = item.get("url") or f"https://news.ycombinator.com/item?id={item.get('id')}"
                title = item.get("title", "")
                text  = item.get("text", "") or ""
                ts    = item.get("time")
                published_at = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None

                result = await run_pipeline(
                    source_id=hn_source_id,
                    title=title,
                    content=text,
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

            await asyncio.sleep(0.1)  # gentle pacing between batches

        errors += unresolved  # unresolved item fetches count as errors

    return {
        "source": f"hackernews/{req.feed}",
        "feed": req.feed,
        "requested": len(story_ids),
        "ingested": ingested,
        "skipped_duplicates": skipped,
        "errors": errors,
        "fetch_errors": unresolved,
    }


# ---------------------------------------------------------------------------
# Name clusters — generate short names for unnamed clusters using Claude Haiku
# ---------------------------------------------------------------------------

@router.post("/name-clusters")
async def name_clusters() -> dict:
    """
    Find clusters with no name (or a single-signal placeholder that looks like an article title),
    pull their top 5 signal titles, and ask Claude Haiku for a concise 3-6 word cluster name.
    Runs in batches; safe to call multiple times.
    """
    from anthropic import AsyncAnthropic
    from config import settings

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    async with get_conn() as conn:
        # Get clusters that have no name or only a long placeholder title
        clusters = await conn.fetch(
            """
            SELECT c.id, c.domain_tags,
                   array_agg(s.title ORDER BY s.importance_composite DESC NULLS LAST) AS titles
            FROM clusters c
            JOIN signals s ON s.cluster_id = c.id
            WHERE c.is_active = TRUE
              AND (c.name IS NULL OR length(c.name) > 60)
            GROUP BY c.id
            HAVING COUNT(s.id) >= 2
            LIMIT 50
            """
        )

    if not clusters:
        return {"named": 0, "message": "No unnamed clusters found"}

    named = 0
    for row in clusters:
        titles = [t for t in (row["titles"] or []) if t][:5]
        if not titles:
            continue
        domain_hint = ", ".join(row["domain_tags"]) if row["domain_tags"] else "technology"
        prompt = (
            f"These news article titles were automatically grouped into one cluster "
            f"because they cover similar topics (domain: {domain_hint}):\n\n"
            + "\n".join(f"- {t}" for t in titles)
            + "\n\nGive this cluster a concise name (3-6 words) that captures "
            "the common theme. Return ONLY the name, no punctuation, no explanation."
        )
        try:
            resp = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=32,
                messages=[{"role": "user", "content": prompt}],
            )
            name = resp.content[0].text.strip().strip('"').strip("'")
            if name:
                async with get_conn() as conn:
                    await conn.execute(
                        "UPDATE clusters SET name = $1, updated_at = NOW() WHERE id = $2",
                        name, row["id"]
                    )
                    # Also backfill domain_tags from signals if empty
                    await conn.execute(
                        """
                        UPDATE clusters SET domain_tags = (
                            SELECT array_agg(DISTINCT dt)
                            FROM signals s, unnest(s.domain_tags) dt
                            WHERE s.cluster_id = $1
                        )
                        WHERE id = $1 AND domain_tags = '{}'
                        """,
                        row["id"]
                    )
                named += 1
                # Also synthesise narrative for newly named clusters
                asyncio.create_task(synthesise_narrative(str(row["id"])))
        except Exception as exc:
            log.warning("Failed to name cluster %s: %s", row["id"], exc)

    return {"named": named, "total_processed": len(clusters)}


@router.post("/synthesise-narratives")
async def synthesise_all_narratives() -> dict:
    """Synthesise narratives for all named clusters that don't have one yet."""
    async with get_conn() as conn:
        clusters = await conn.fetch(
            """
            SELECT id FROM clusters
            WHERE is_active = TRUE
              AND name IS NOT NULL
              AND (narrative IS NULL OR narrative_updated_at < NOW() - INTERVAL '24 hours')
            LIMIT 20
            """
        )

    synthesised = 0
    for row in clusters:
        result = await synthesise_narrative(str(row["id"]))
        if result:
            synthesised += 1

    return {"synthesised": synthesised, "total_processed": len(clusters)}


# ---------------------------------------------------------------------------
# Health check — lets the dashboard confirm the Python service is reachable
# and that key dependencies (DB, Redis, OpenAI) are responsive
# ---------------------------------------------------------------------------

@router.get("/health")
async def feed_health() -> dict:
    """Quick connectivity check for the ingest dashboard."""
    checks: dict[str, str] = {}

    # Database
    try:
        async with get_conn() as conn:
            count = await conn.fetchval("SELECT COUNT(*) FROM sources")
        checks["database"] = f"ok ({count} sources)"
    except Exception as exc:
        checks["database"] = f"error: {exc}"

    # Redis (via dedup service which uses it)
    try:
        from redis_client import get_redis
        r = await get_redis()
        await r.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"

    # OpenAI embedding (single test call)
    try:
        from services.embedding import generate_embedding
        await generate_embedding("health check")
        checks["openai_embedding"] = "ok"
    except Exception as exc:
        checks["openai_embedding"] = f"error: {exc}"

    all_ok = all(v.startswith("ok") for v in checks.values())
    return {"status": "ok" if all_ok else "degraded", "checks": checks}


# ---------------------------------------------------------------------------
# Reddit scheduled poll — sorts by New, detects early signals, fetches comments
# ---------------------------------------------------------------------------

# Trigger phrases that indicate a post worth fetching comments for
_REDDIT_SIGNAL_PHRASES = {
    "just dropped", "just released", "just launched", "just shipped",
    "benchmark", "benchmarks", "vs ", " vs.", "comparison",
    "outperforms", "beats gpt", "beats claude", "beats gemini",
    "state of the art", "sota", "new model", "new paper",
    "open source", "open-source", "github.com",
}

_REDDIT_MEDIA_DOMAINS = {
    # Only filter genuine media/image hosts — NOT reddit.com itself,
    # since Reddit RSS entry links ARE reddit.com permalinks (that's what we want)
    "i.redd.it", "v.redd.it", "imgur.com", "i.imgur.com",
    "gfycat.com", "redgifs.com", "streamable.com",
}


def _is_high_signal(post: dict) -> bool:
    """Return True if this post warrants fetching its comments."""
    title = (post.get("title") or "").lower()
    url   = (post.get("url") or "").lower()
    text  = (post.get("selftext") or "").lower()
    combined = f"{title} {url} {text}"
    if "github.com" in url or "github.com" in text:
        return True
    return any(phrase in combined for phrase in _REDDIT_SIGNAL_PHRASES)


def _extract_subreddit(source) -> str | None:
    """Get subreddit name from source handle or URL."""
    if source["handle"]:
        h = source["handle"].strip()
        if h.startswith("r/"):
            h = h[2:]
        return h.lstrip("/")
    url = source["url"] or ""
    # e.g. https://reddit.com/r/MachineLearning
    parts = [p for p in url.split("/") if p]
    if "r" in parts:
        idx = parts.index("r")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    return None


async def _fetch_top_comments(client: httpx.AsyncClient, subreddit: str, post_id: str, n: int = 5) -> str:
    """Fetch the top N root comments for a post. Returns them as a single string."""
    try:
        url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}.json"
        resp = await client.get(url, params={"limit": 20, "sort": "top", "depth": 1})
        if resp.status_code != 200:
            return ""
        data = resp.json()
        comments_listing = data[1]["data"]["children"] if len(data) > 1 else []
        texts = []
        for c in comments_listing[:n]:
            body = (c.get("data") or {}).get("body", "").strip()
            if body and body != "[deleted]" and body != "[removed]":
                texts.append(body)
        return "\n\n".join(texts)
    except Exception:
        return ""


async def poll_reddit_sources() -> dict:
    """
    Poll all active Reddit sources, sorting by New to catch early signals.
    Fetches comments for high-signal posts (GitHub links, benchmarks, etc.).
    """
    async with get_conn() as conn:
        sources = await conn.fetch(
            "SELECT id, name, url, handle, domain_tags, last_ingested "
            "FROM sources "
            "WHERE platform = 'reddit' AND is_active = TRUE"
        )

    if not sources:
        return {"sources_polled": 0, "ingested": 0, "skipped_duplicates": 0, "errors": 0}

    ingested = skipped = errors = 0
    headers = {"User-Agent": "NewsHive/1.0 news-signal-bot"}

    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        for source in sources:
            subreddit = _extract_subreddit(source)
            if not subreddit:
                log.warning("Reddit source %s has no subreddit — skipping", source["name"])
                continue

            last_ingested = source["last_ingested"]
            cutoff: datetime | None = None
            if last_ingested:
                li = last_ingested
                if li.tzinfo is None:
                    li = li.replace(tzinfo=timezone.utc)
                cutoff = li - timedelta(minutes=5)

            # Use RSS feed — no auth required, no 403s
            # JSON API requires OAuth; RSS is publicly accessible
            rss_url = f"https://www.reddit.com/r/{subreddit}/new.rss"
            try:
                resp = await client.get(rss_url)
                if resp.status_code == 429:
                    log.warning("Reddit rate limited on r/%s", subreddit)
                    await asyncio.sleep(10)
                    continue
                if resp.status_code >= 400:
                    log.warning("Reddit fetch failed r/%s: HTTP %s", subreddit, resp.status_code)
                    errors += 1
                    continue
                feed = await _parse_feed(resp.text)
            except Exception as exc:
                log.warning("Reddit fetch failed r/%s: %s", subreddit, exc)
                errors += 1
                continue

            source_ingested = 0
            for entry in feed.entries[:100]:
                post_url = entry.get("link", "")
                if not post_url:
                    continue

                # Skip noise domains
                try:
                    from urllib.parse import urlparse
                    domain = urlparse(post_url).netloc.lower().lstrip("www.")
                    if domain in _REDDIT_MEDIA_DOMAINS:
                        continue
                    path = urlparse(post_url).path.lower()
                    if any(path.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".mp4", ".webm")):
                        continue
                except Exception:
                    pass

                published_at = None
                if pt := entry.get("published_parsed"):
                    try:
                        published_at = datetime(*pt[:6], tzinfo=timezone.utc)
                    except Exception:
                        pass

                if cutoff and published_at and published_at < cutoff:
                    continue

                title   = entry.get("title", "")
                content = entry.get("summary", "") or ""

                # Best-effort comment fetch for high-signal posts via JSON API
                # Extract post ID from URL: /r/sub/comments/{id}/title/
                try:
                    parts = [p for p in post_url.split("/") if p]
                    if "comments" in parts:
                        post_id = parts[parts.index("comments") + 1]
                        signal_data = {"title": title, "selftext": content, "url": post_url}
                        if _is_high_signal(signal_data) and post_id:
                            comment_text = await _fetch_top_comments(client, subreddit, post_id)
                            if comment_text:
                                content = f"{content}\n\n--- Top comments ---\n{comment_text}".strip()
                            await asyncio.sleep(2.0)
                except Exception:
                    pass

                result = await run_pipeline(
                    source_id=source["id"],
                    title=title,
                    content=content,
                    url=post_url,
                    published_at=published_at,
                    domain_tags=list(source["domain_tags"] or []),
                    source_type="reddit",
                )
                if result == "ingested":
                    ingested += 1
                    source_ingested += 1
                elif result == "duplicate":
                    skipped += 1
                else:
                    errors += 1

                await asyncio.sleep(1.0)

            log.info("Reddit r/%s: ingested=%d", subreddit, source_ingested)

            async with get_conn() as conn:
                await conn.execute(
                    "UPDATE sources SET last_ingested = NOW() WHERE id = $1", source["id"]
                )

            await asyncio.sleep(2.0)

    return {
        "sources_polled": len(sources),
        "ingested": ingested,
        "skipped_duplicates": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# X / Twitter poll — placeholder until API credentials are configured
# ---------------------------------------------------------------------------

async def poll_x_sources() -> dict:
    """
    Poll active X / Twitter sources via RSSHub.
    Requires RSSHUB_BASE_URL to be set in config.
    Each source needs either a full feed URL or a handle — we construct
    {rsshub_base_url}/twitter/user/{handle} for handle-only sources.
    """
    rsshub_base = (settings.rsshub_base_url or "").rstrip("/")
    if not rsshub_base:
        raise NotImplementedError("X polling requires RSSHUB_BASE_URL to be configured")

    async with get_conn() as conn:
        sources = await conn.fetch(
            "SELECT id, name, url, handle, domain_tags, last_ingested "
            "FROM sources WHERE platform = 'x' AND is_active = TRUE"
        )

    if not sources:
        return {"sources_polled": 0, "ingested": 0, "skipped_duplicates": 0, "errors": 0}

    ingested = skipped = errors = 0
    headers = {"User-Agent": "NewsHive/1.0 (+https://newshive.geekybee.net)"}

    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        for source in sources:
            # Determine feed URL
            feed_url = source["url"] or ""
            if not feed_url:
                handle = (source["handle"] or "").lstrip("@")
                if not handle:
                    log.warning("X source %s has no URL or handle — skipping", source["name"])
                    continue
                feed_url = f"{rsshub_base}/twitter/user/{handle}"

            last_ingested = source["last_ingested"]
            cutoff: datetime | None = None
            if last_ingested:
                li = last_ingested
                if li.tzinfo is None:
                    li = li.replace(tzinfo=timezone.utc)
                cutoff = li - timedelta(minutes=5)

            try:
                resp = await client.get(feed_url)
                if resp.status_code == 429:
                    log.warning("X/RSSHub rate limited on %s", source["name"])
                    await asyncio.sleep(10)
                    continue
                if resp.status_code >= 400:
                    log.warning("X/RSSHub fetch failed %s: HTTP %s", source["name"], resp.status_code)
                    errors += 1
                    continue
                feed = await _parse_feed(resp.text)
            except Exception as exc:
                log.warning("X/RSSHub fetch failed %s: %s", source["name"], exc)
                errors += 1
                continue

            source_ingested = 0
            for entry in feed.entries[:50]:
                url = entry.get("link", "")
                if not url:
                    continue

                published_at = None
                if pt := entry.get("published_parsed"):
                    try:
                        published_at = datetime(*pt[:6], tzinfo=timezone.utc)
                    except Exception:
                        pass

                if cutoff and published_at and published_at < cutoff:
                    continue

                result = await run_pipeline(
                    source_id=source["id"],
                    title=entry.get("title", ""),
                    content=entry.get("summary", "") or "",
                    url=url,
                    published_at=published_at,
                    domain_tags=list(source["domain_tags"] or []),
                    source_type="x",
                )
                if result == "ingested":
                    ingested += 1
                    source_ingested += 1
                elif result == "duplicate":
                    skipped += 1
                else:
                    errors += 1

                await asyncio.sleep(0.5)

            log.info("X @%s: ingested=%d", source["handle"] or source["name"], source_ingested)
            async with get_conn() as conn:
                await conn.execute(
                    "UPDATE sources SET last_ingested = NOW() WHERE id = $1", source["id"]
                )
            await asyncio.sleep(2.0)

    return {
        "sources_polled": len(sources),
        "ingested": ingested,
        "skipped_duplicates": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Seed default RSS sources from the INGESTION.md spec
# Idempotent — skips sources that already exist (matched by URL)
# ---------------------------------------------------------------------------

_DEFAULT_SOURCES = [
    # AI
    {"name": "ArXiv CS.AI", "url": "https://rss.arxiv.org/rss/cs.AI", "platform": "rss", "domain_tags": ["ai"], "tier": 1},
    {"name": "OpenAI Blog", "url": "https://openai.com/blog/rss/", "platform": "rss", "domain_tags": ["ai"], "tier": 1},
    {"name": "Anthropic News", "url": "https://www.anthropic.com/rss.xml", "platform": "rss", "domain_tags": ["ai"], "tier": 1},
    {"name": "Google DeepMind Blog", "url": "https://deepmind.google/blog/rss.xml", "platform": "rss", "domain_tags": ["ai"], "tier": 1},
    {"name": "Hugging Face Blog", "url": "https://huggingface.co/blog/feed.xml", "platform": "rss", "domain_tags": ["ai"], "tier": 2},
    {"name": "MIT News — AI", "url": "https://news.mit.edu/rss/topic/artificial-intelligence2", "platform": "rss", "domain_tags": ["ai"], "tier": 1},
    {"name": "VentureBeat AI", "url": "https://venturebeat.com/category/ai/feed/", "platform": "rss", "domain_tags": ["ai"], "tier": 2},
    {"name": "TechCrunch AI", "url": "https://techcrunch.com/category/artificial-intelligence/feed/", "platform": "rss", "domain_tags": ["ai"], "tier": 2},
    {"name": "Wired AI", "url": "https://www.wired.com/feed/tag/artificial-intelligence/latest/rss", "platform": "rss", "domain_tags": ["ai"], "tier": 2},
    # VR / AR
    {"name": "Road to VR", "url": "https://www.roadtovr.com/feed/", "platform": "rss", "domain_tags": ["vr"], "tier": 1},
    {"name": "Upload VR", "url": "https://uploadvr.com/feed/", "platform": "rss", "domain_tags": ["vr"], "tier": 1},
    {"name": "VR Scout", "url": "https://vrscout.com/feed/", "platform": "rss", "domain_tags": ["vr"], "tier": 2},
    {"name": "XR Today", "url": "https://www.xrtoday.com/feed/", "platform": "rss", "domain_tags": ["vr"], "tier": 2},
    # SEO
    {"name": "Search Engine Land", "url": "https://searchengineland.com/feed", "platform": "rss", "domain_tags": ["seo"], "tier": 1},
    {"name": "Search Engine Journal", "url": "https://www.searchenginejournal.com/feed/", "platform": "rss", "domain_tags": ["seo"], "tier": 1},
    {"name": "Moz Blog", "url": "https://moz.com/blog/feed", "platform": "rss", "domain_tags": ["seo"], "tier": 2},
    {"name": "Ahrefs Blog", "url": "https://ahrefs.com/blog/feed/", "platform": "rss", "domain_tags": ["seo"], "tier": 2},
    {"name": "Google Search Central Blog", "url": "https://developers.google.com/search/blog/atom.xml", "platform": "rss", "domain_tags": ["seo"], "tier": 1},
    # Vibe Coding
    {"name": "Dev.to", "url": "https://dev.to/feed", "platform": "rss", "domain_tags": ["vibe_coding"], "tier": 2},
    {"name": "Hacker News Best (RSS)", "url": "https://news.ycombinator.com/rss", "platform": "rss", "domain_tags": ["ai", "vibe_coding"], "tier": 1},
    {"name": "The Pragmatic Engineer", "url": "https://newsletter.pragmaticengineer.com/feed", "platform": "rss", "domain_tags": ["vibe_coding"], "tier": 2},
    # Cross-domain
    {"name": "MIT Technology Review", "url": "https://www.technologyreview.com/feed/", "platform": "rss", "domain_tags": ["cross"], "tier": 1},
    {"name": "The Verge Tech", "url": "https://www.theverge.com/rss/index.xml", "platform": "rss", "domain_tags": ["cross"], "tier": 2},
    {"name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/index", "platform": "rss", "domain_tags": ["cross"], "tier": 2},
]


@router.post("/seed-sources")
async def seed_default_sources() -> dict:
    """
    Insert the default RSS sources from the INGESTION.md spec.
    Skips any source whose URL already exists in the database (idempotent).
    """
    added = skipped = 0
    async with get_conn() as conn:
        for s in _DEFAULT_SOURCES:
            existing = await conn.fetchval(
                "SELECT id FROM sources WHERE url = $1", s["url"]
            )
            if existing:
                skipped += 1
                continue
            await conn.execute(
                """
                INSERT INTO sources (name, url, platform, domain_tags, tier)
                VALUES ($1, $2, $3, $4, $5)
                """,
                s["name"], s["url"], s["platform"], s["domain_tags"], s["tier"],
            )
            added += 1

    return {"added": added, "already_existed": skipped, "total": len(_DEFAULT_SOURCES)}
