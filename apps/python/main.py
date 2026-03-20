from contextlib import asynccontextmanager

from fastapi import FastAPI

from database import init_pool, close_pool
from redis_client import init_redis, close_redis
from routers import ingest, score, honeypot, draft, publish


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
app.include_router(publish.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
