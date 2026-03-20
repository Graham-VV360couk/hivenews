from unittest.mock import AsyncMock, patch
from uuid import uuid4


async def test_ingest_new_signal_returns_id(client):
    signal_id = uuid4()
    with patch("routers.ingest.is_duplicate", new_callable=AsyncMock, return_value=False), \
         patch("routers.ingest.mark_seen", new_callable=AsyncMock), \
         patch("routers.ingest.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 1536), \
         patch("routers.ingest._store_signal", new_callable=AsyncMock, return_value=signal_id), \
         patch("routers.ingest.assign_cluster", new_callable=AsyncMock, return_value=uuid4()):
        response = await client.post("/ingest", json={
            "url": "https://example.com/new-article",
            "title": "Big AI announcement",
            "content": "Something happened in AI today.",
            "source_type": "rss_feed",
            "domain_tags": ["ai"],
        })
    assert response.status_code == 200
    data = response.json()
    assert data["deduplicated"] is False
    assert data["id"] == str(signal_id)


async def test_ingest_duplicate_returns_deduplicated_flag(client):
    with patch("routers.ingest.is_duplicate", new_callable=AsyncMock, return_value=True):
        response = await client.post("/ingest", json={
            "url": "https://example.com/seen-before",
            "title": "Seen before",
            "source_type": "rss_feed",
        })
    assert response.status_code == 200
    data = response.json()
    assert data["deduplicated"] is True
    assert data["id"] is None


async def test_ingest_no_text_returns_422(client):
    """Signals with no title or content are rejected — zero vectors corrupt clustering."""
    response = await client.post("/ingest", json={
        "url": "https://example.com/no-text",
        "source_type": "rss_feed",
    })
    assert response.status_code == 422


async def test_ingest_missing_url_returns_422(client):
    response = await client.post("/ingest", json={"title": "No URL here", "content": "Test"})
    assert response.status_code == 422
