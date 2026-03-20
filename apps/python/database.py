"""asyncpg connection pool with pgvector codec registered on every connection."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import asyncpg
from pgvector.asyncpg import register_vector

from config import settings

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Register the pgvector codec on each connection acquired from the pool.

    This allows passing list[float] / numpy arrays for vector columns and
    receiving numpy arrays back — no manual JSON serialisation required.
    """
    await register_vector(conn)


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=2,
        max_size=10,
        command_timeout=60,
        init=_init_connection,
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
