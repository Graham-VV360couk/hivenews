"""POST /draft — trigger content pack creation for a cluster or alert candidate.

Used by N8N automations and HiveDeck dashboard to manually trigger draft generation.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.content_pack import trigger_pack_for_cluster, trigger_pack_for_alert
from services.readiness import should_trigger_content_pack

log = logging.getLogger(__name__)
router = APIRouter()


class DraftRequest(BaseModel):
    cluster_id: UUID | None = None
    alert_candidate_id: UUID | None = None
    pack_type: str = "standard"
    force: bool = False  # bypass readiness check


class DraftResponse(BaseModel):
    pack_id: UUID | None
    created: bool
    reason: str


@router.post("/draft", response_model=DraftResponse)
async def trigger_draft(req: DraftRequest) -> DraftResponse:
    """Trigger content pack creation for a cluster or alert candidate.

    - cluster_id: checks readiness score unless force=True
    - alert_candidate_id: skips readiness check (alerts always trigger)
    - Both provided: alert_candidate_id takes precedence
    - Neither provided: returns 422
    """
    if req.cluster_id is None and req.alert_candidate_id is None:
        raise HTTPException(status_code=422, detail="Provide cluster_id or alert_candidate_id")

    # Alert candidate path — always trigger regardless of readiness
    if req.alert_candidate_id is not None:
        pack_id = await trigger_pack_for_alert(req.alert_candidate_id)
        if pack_id is None:
            return DraftResponse(pack_id=None, created=False, reason="draft_generation_failed")
        return DraftResponse(pack_id=pack_id, created=True, reason="alert_candidate")

    # Cluster path — check readiness unless force=True
    if req.cluster_id is not None:
        if not req.force:
            from database import get_conn
            async with get_conn() as conn:
                row = await conn.fetchrow(
                    "SELECT readiness_score, days_since_last_pack FROM clusters WHERE id = $1",
                    req.cluster_id,
                )
            if not row:
                raise HTTPException(status_code=404, detail="Cluster not found")

            readiness_score = row["readiness_score"] or 0.0
            days_since = row["days_since_last_pack"]

            if not should_trigger_content_pack(readiness_score, days_since):
                return DraftResponse(
                    pack_id=None,
                    created=False,
                    reason=f"not_ready (score={readiness_score}, days={days_since})",
                )

        pack_id = await trigger_pack_for_cluster(req.cluster_id)
        if pack_id is None:
            return DraftResponse(pack_id=None, created=False, reason="draft_generation_failed")

        reason = "forced" if req.force else "readiness_threshold"
        return DraftResponse(pack_id=pack_id, created=True, reason=reason)

    # Unreachable but satisfies type checker
    raise HTTPException(status_code=422, detail="Invalid request")
