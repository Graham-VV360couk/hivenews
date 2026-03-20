# apps/python/tests/test_trajectory.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_create_trajectory_returns_uuid():
    """create_trajectory inserts a row and returns its UUID."""
    new_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=new_id)
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import create_trajectory
        result = await create_trajectory(
            name="AI agents displace SaaS",
            domain_tags=["ai"],
            description="LLM agents will erode traditional SaaS subscriptions within 18 months.",
        )

    assert result == new_id


async def test_get_active_trajectories_returns_list():
    """get_active_trajectories returns a list of active trajectory dicts."""
    traj_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[{
        "id": traj_id,
        "name": "AI agents displace SaaS",
        "domain_tags": ["ai"],
        "confidence_score": 6.5,
        "confidence_direction": "rising",
        "status": "active",
        "description": "LLM agents will erode...",
    }])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import get_active_trajectories
        result = await get_active_trajectories()

    assert len(result) == 1
    assert result[0]["name"] == "AI agents displace SaaS"


async def test_update_trajectory_confidence_returns_true_when_found():
    """update_trajectory_confidence updates score and returns True when row exists."""
    traj_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=3)  # current version_number
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import update_trajectory_confidence
        result = await update_trajectory_confidence(
            trajectory_id=traj_id,
            new_score=7.5,
            direction="rising",
            reason="Three new corroborating signals this week.",
        )

    assert result is True


async def test_update_trajectory_confidence_returns_false_when_not_found():
    """Returns False if trajectory_id doesn't exist."""
    traj_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=None)  # no version found

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import update_trajectory_confidence
        result = await update_trajectory_confidence(
            trajectory_id=traj_id,
            new_score=7.5,
            direction="rising",
            reason="Test",
        )

    assert result is False


async def test_attach_signal_to_trajectory():
    """attach_signal appends signal_id to supporting or contradicting array."""
    traj_id = uuid.uuid4()
    sig_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import attach_signal
        result = await attach_signal(traj_id, sig_id, supporting=True)

    assert result is True
    mock_conn.execute.assert_awaited_once()
