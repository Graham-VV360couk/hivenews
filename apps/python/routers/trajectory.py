"""Trajectory management endpoints."""
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.trajectory import (
    create_trajectory,
    get_active_trajectories,
    get_trajectory,
    update_trajectory_confidence,
    attach_signal,
    resolve_trajectory,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/trajectories", tags=["trajectories"])


class CreateTrajectoryRequest(BaseModel):
    name: str
    domain_tags: list[str] = []
    description: str
    initial_score: float = 5.0


class UpdateConfidenceRequest(BaseModel):
    new_score: float
    direction: str  # rising / falling / stable
    reason: str


class AttachSignalRequest(BaseModel):
    signal_id: UUID
    supporting: bool = True


class ResolveRequest(BaseModel):
    status: str  # confirmed / abandoned / superseded
    outcome_notes: str


@router.get("")
async def list_trajectories() -> list[dict]:
    """List all active trajectories."""
    return await get_active_trajectories()


@router.post("")
async def create(req: CreateTrajectoryRequest) -> dict:
    """Create a new trajectory."""
    traj_id = await create_trajectory(
        req.name, req.domain_tags, req.description, req.initial_score
    )
    if not traj_id:
        raise HTTPException(status_code=500, detail="Failed to create trajectory")
    return {"trajectory_id": str(traj_id)}


@router.get("/{trajectory_id}")
async def detail(trajectory_id: UUID) -> dict:
    """Get a single trajectory with version history."""
    traj = await get_trajectory(trajectory_id)
    if not traj:
        raise HTTPException(status_code=404, detail="Trajectory not found")
    return traj


@router.patch("/{trajectory_id}/confidence")
async def update_confidence(trajectory_id: UUID, req: UpdateConfidenceRequest) -> dict:
    """Update trajectory confidence score."""
    ok = await update_trajectory_confidence(
        trajectory_id, req.new_score, req.direction, req.reason
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Trajectory not found")
    return {"updated": True}


@router.post("/{trajectory_id}/signals")
async def add_signal(trajectory_id: UUID, req: AttachSignalRequest) -> dict:
    """Attach a signal to a trajectory."""
    ok = await attach_signal(trajectory_id, req.signal_id, req.supporting)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to attach signal")
    return {"attached": True}


@router.patch("/{trajectory_id}/resolve")
async def resolve(trajectory_id: UUID, req: ResolveRequest) -> dict:
    """Resolve a trajectory (confirmed/abandoned/superseded)."""
    ok = await resolve_trajectory(trajectory_id, req.status, req.outcome_notes)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid status or trajectory not found")
    return {"resolved": True}
