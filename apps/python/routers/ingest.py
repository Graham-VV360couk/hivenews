"""POST /ingest — receive a signal, deduplicate, embed, and store.

Signals with no embeddable content (no title and no content) are rejected
with HTTP 422 — a zero-vector embedding has undefined cosine similarity
and would corrupt clustering.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException

from database import get_conn
from models.signals import IngestRequest, IngestResponse
from services.clustering import assign_cluster
from services.dedup import is_duplicate, mark_seen
from services.embedding import generate_embedding

router = APIRouter()


async def _store_signal(req: IngestRequest, embedding: list[float]) -> UUID:
    """Insert signal into DB and return its UUID."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO signals (
                source_id, title, content, url, published_at,
                domain_tags, source_type, is_public, provenance_url,
                embedding
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10::vector
            )
            RETURNING id
            """,
            req.source_id,
            req.title,
            req.content,
            req.url,
            req.published_at,
            req.domain_tags,
            req.source_type,
            req.is_public,
            req.provenance_url or req.url,
            embedding,
        )
        return row["id"]


@router.post("/ingest", response_model=IngestResponse)
async def ingest_signal(req: IngestRequest) -> IngestResponse:
    # Reject signals with no text to embed — zero vectors corrupt clustering
    text_to_embed = f"{req.title or ''} {req.content or ''}".strip()
    if not text_to_embed:
        raise HTTPException(
            status_code=422,
            detail="Signal must have title or content to be ingested.",
        )

    if await is_duplicate(req.url):
        return IngestResponse(id=None, deduplicated=True, message="Signal already seen — skipped.")

    embedding = await generate_embedding(text_to_embed)
    signal_id = await _store_signal(req, embedding)
    await mark_seen(req.url)
    await assign_cluster(signal_id, embedding)

    return IngestResponse(id=signal_id, deduplicated=False, message="Signal ingested.")
