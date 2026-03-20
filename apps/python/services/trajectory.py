"""Trajectory management — named theories about where domains are heading.

A trajectory is a named, falsifiable prediction about the direction of a technology
domain. Confidence scores (0-10) are updated as supporting or contradicting signals
arrive. Every confidence update creates a trajectory_version for the audit trail.
"""
import logging
from uuid import UUID

from database import get_conn

log = logging.getLogger(__name__)


async def create_trajectory(
    name: str,
    domain_tags: list[str],
    description: str,
    initial_score: float = 5.0,
) -> UUID | None:
    """Insert a new trajectory and its first version. Returns the new UUID."""
    try:
        async with get_conn() as conn:
            traj_id = await conn.fetchval(
                """
                INSERT INTO trajectories
                  (name, domain_tags, description, confidence_score,
                   confidence_direction, status, first_published_at, last_updated_at)
                VALUES ($1, $2, $3, $4, 'stable', 'active', NOW(), NOW())
                RETURNING id
                """,
                name, domain_tags, description, initial_score,
            )
            await conn.execute(
                """
                INSERT INTO trajectory_versions
                  (trajectory_id, version_number, confidence_score,
                   description, reason_for_change)
                VALUES ($1, 1, $2, $3, 'Initial creation')
                """,
                traj_id, initial_score, description,
            )
        log.info("Created trajectory %s: %s", traj_id, name)
        return traj_id
    except Exception as exc:
        log.error("Failed to create trajectory: %s", exc)
        return None


async def get_active_trajectories() -> list[dict]:
    """Return all active trajectories ordered by confidence score descending."""
    try:
        async with get_conn() as conn:
            rows = await conn.fetch(
                """
                SELECT id, name, domain_tags, confidence_score,
                       confidence_direction, status, description,
                       first_published_at, last_updated_at
                FROM trajectories
                WHERE status = 'active'
                ORDER BY confidence_score DESC, last_updated_at DESC
                """,
            )
        return [dict(r) for r in rows]
    except Exception as exc:
        log.error("Failed to fetch active trajectories: %s", exc)
        return []


async def get_trajectory(trajectory_id: UUID) -> dict | None:
    """Return a single trajectory with its version history."""
    try:
        async with get_conn() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, name, domain_tags, confidence_score, confidence_direction,
                       status, description, most_likely_path, accelerated_scenario,
                       disruption_scenario, stagnation_scenario,
                       supporting_signal_ids, contradicting_signal_ids,
                       first_published_at, last_updated_at, outcome, outcome_notes
                FROM trajectories
                WHERE id = $1
                """,
                trajectory_id,
            )
            if not row:
                return None
            versions = await conn.fetch(
                """
                SELECT version_number, confidence_score, reason_for_change, created_at
                FROM trajectory_versions
                WHERE trajectory_id = $1
                ORDER BY version_number DESC
                LIMIT 20
                """,
                trajectory_id,
            )
        result = dict(row)
        result["versions"] = [dict(v) for v in versions]
        return result
    except Exception as exc:
        log.error("Failed to fetch trajectory %s: %s", trajectory_id, exc)
        return None


async def update_trajectory_confidence(
    trajectory_id: UUID,
    new_score: float,
    direction: str,
    reason: str,
) -> bool:
    """Update confidence score and record a new version. Returns False if not found."""
    try:
        async with get_conn() as conn:
            current_version = await conn.fetchval(
                "SELECT MAX(version_number) FROM trajectory_versions WHERE trajectory_id = $1",
                trajectory_id,
            )
            if current_version is None:
                return False
            next_version = current_version + 1
            await conn.execute(
                """
                UPDATE trajectories
                SET confidence_score = $1, confidence_direction = $2, last_updated_at = NOW()
                WHERE id = $3
                """,
                new_score, direction, trajectory_id,
            )
            await conn.execute(
                """
                INSERT INTO trajectory_versions
                  (trajectory_id, version_number, confidence_score, reason_for_change)
                VALUES ($1, $2, $3, $4)
                """,
                trajectory_id, next_version, new_score, reason,
            )
        return True
    except Exception as exc:
        log.error("Failed to update trajectory confidence %s: %s", trajectory_id, exc)
        return False


async def attach_signal(
    trajectory_id: UUID,
    signal_id: UUID,
    supporting: bool,
) -> bool:
    """Append a signal to the trajectory's supporting or contradicting array."""
    try:
        column = "supporting_signal_ids" if supporting else "contradicting_signal_ids"
        async with get_conn() as conn:
            await conn.execute(
                f"""
                UPDATE trajectories
                SET {column} = array_append(COALESCE({column}, '{{}}'), $1),
                    last_updated_at = NOW()
                WHERE id = $2
                """,
                signal_id, trajectory_id,
            )
        return True
    except Exception as exc:
        log.error("Failed to attach signal to trajectory: %s", exc)
        return False


async def resolve_trajectory(
    trajectory_id: UUID,
    status: str,
    outcome_notes: str,
) -> bool:
    """Mark trajectory as confirmed/abandoned/superseded."""
    valid = {"confirmed", "abandoned", "superseded"}
    if status not in valid:
        log.warning("Invalid trajectory status: %s", status)
        return False
    try:
        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE trajectories
                SET status = $1, outcome_notes = $2, outcome_at = NOW(), last_updated_at = NOW()
                WHERE id = $3
                """,
                status, outcome_notes, trajectory_id,
            )
        return True
    except Exception as exc:
        log.error("Failed to resolve trajectory %s: %s", trajectory_id, exc)
        return False
