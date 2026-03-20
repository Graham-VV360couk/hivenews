"""Shared pytest fixtures. DB and Redis are mocked — no real services needed."""

import os

# Set required env vars before any app module imports — Settings() runs at import time
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch


@pytest_asyncio.fixture
async def client():
    """Return an async test client with DB/Redis lifecycle mocked out."""
    with patch("main.init_pool", new_callable=AsyncMock), \
         patch("main.close_pool", new_callable=AsyncMock), \
         patch("main.init_redis", new_callable=AsyncMock), \
         patch("main.close_redis", new_callable=AsyncMock):
        # Import inside fixture to avoid module-level side effects before patching
        import importlib
        import main as main_module
        importlib.reload(main_module)
        async with AsyncClient(
            transport=ASGITransport(app=main_module.app),
            base_url="http://test",
        ) as ac:
            yield ac
