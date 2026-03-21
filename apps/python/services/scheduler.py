"""Background polling scheduler.

RSS  — every 2 hours
X    — every 15 minutes (placeholder until X API credentials are configured)

Started from FastAPI lifespan via start_scheduler().
Each loop waits for its interval AFTER the job completes, so a slow poll
never causes two concurrent runs.
"""
import asyncio
import logging

log = logging.getLogger(__name__)

_RSS_INTERVAL    = 2 * 3600   # 2 hours
_REDDIT_INTERVAL = 1 * 3600   # 1 hour  — /new sorted, catches early signals
_X_INTERVAL      = 15 * 60    # 15 minutes (placeholder)
_WARMUP          = 60         # seconds after startup before first run


async def _rss_poll_loop():
    await asyncio.sleep(_WARMUP)
    while True:
        try:
            log.info("Scheduler: starting RSS poll")
            from routers.feed import poll_rss_sources
            result = await poll_rss_sources()
            log.info(
                "Scheduler: RSS poll complete — ingested=%s skipped=%s errors=%s",
                result.get("ingested"),
                result.get("skipped_duplicates"),
                result.get("errors"),
            )
        except Exception as exc:
            log.error("Scheduler: RSS poll failed: %s", exc)
        await asyncio.sleep(_RSS_INTERVAL)


async def _reddit_poll_loop():
    await asyncio.sleep(_WARMUP + 90)  # stagger behind RSS
    while True:
        try:
            log.info("Scheduler: starting Reddit poll")
            from routers.feed import poll_reddit_sources
            result = await poll_reddit_sources()
            log.info(
                "Scheduler: Reddit poll complete — ingested=%s skipped=%s errors=%s",
                result.get("ingested"),
                result.get("skipped_duplicates"),
                result.get("errors"),
            )
        except Exception as exc:
            log.error("Scheduler: Reddit poll failed: %s", exc)
        await asyncio.sleep(_REDDIT_INTERVAL)


async def _x_poll_loop():
    await asyncio.sleep(_WARMUP + 30)  # stagger slightly behind RSS
    while True:
        try:
            from routers.feed import poll_x_sources
            result = await poll_x_sources()
            log.info("Scheduler: X poll complete — %s", result)
        except NotImplementedError:
            log.debug("Scheduler: X poll skipped — not yet configured")
        except Exception as exc:
            log.error("Scheduler: X poll failed: %s", exc)
        await asyncio.sleep(_X_INTERVAL)


def start_scheduler() -> None:
    """Create background polling tasks. Must be called inside an async context."""
    asyncio.create_task(_rss_poll_loop(),    name="scheduler-rss")
    asyncio.create_task(_reddit_poll_loop(), name="scheduler-reddit")
    asyncio.create_task(_x_poll_loop(),      name="scheduler-x")
    log.info("Scheduler started — RSS every 2h, Reddit every 1h, X every 15min")
