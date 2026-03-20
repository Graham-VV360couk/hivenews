import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import init_pool, close_pool
from redis_client import init_redis, close_redis
from routers import ingest, score, honeypot, draft, publish, trajectory, monthly, feed, connections, story

log = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


async def _run_migrations():
    """Run any pending migrations safely (all use IF NOT EXISTS)."""
    migration_file = os.path.join(os.path.dirname(__file__), "migrations", "002_living_story.sql")
    if not os.path.exists(migration_file):
        return
    with open(migration_file) as f:
        sql = f.read()
    try:
        from database import get_conn
        async with get_conn() as conn:
            await conn.execute(sql)
        log.info("Migration 002_living_story applied")
    except Exception as exc:
        log.error("Migration failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await init_redis()
    await _run_migrations()
    yield
    await close_pool()
    await close_redis()


app = FastAPI(title="NewsHive Python Service", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(ingest.router)
app.include_router(score.router)
app.include_router(honeypot.router)
app.include_router(draft.router)
app.include_router(publish.router)
app.include_router(trajectory.router)
app.include_router(monthly.router)
app.include_router(feed.router)
app.include_router(connections.router)
app.include_router(story.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
