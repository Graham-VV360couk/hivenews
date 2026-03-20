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
