from unittest.mock import AsyncMock, MagicMock, patch, call
from uuid import uuid4

import numpy as np


async def test_assigns_to_existing_cluster_when_within_threshold():
    cluster_id = uuid4()
    existing_centroid = [0.1] * 1536
    mock_conn = AsyncMock()
    mock_conn.fetchrow.return_value = {
        "id": cluster_id,
        "signal_count": 5,
        "centroid_embedding": existing_centroid,
    }

    with patch("services.clustering.get_conn") as mock_get_conn:
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=False)
        from services.clustering import assign_cluster
        result = await assign_cluster(uuid4(), [0.1] * 1536)
        assert result == cluster_id


async def test_creates_new_cluster_when_no_match():
    new_cluster_id = uuid4()
    mock_conn = AsyncMock()
    # fetchrow called twice: nearest cluster query (None) then INSERT RETURNING id
    mock_conn.fetchrow.side_effect = [
        None,
        {"id": new_cluster_id},
    ]

    with patch("services.clustering.get_conn") as mock_get_conn:
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=False)
        from services.clustering import assign_cluster
        result = await assign_cluster(uuid4(), [0.2] * 1536)
        assert result == new_cluster_id


async def test_signal_linked_to_cluster_after_assignment():
    """Verifies that UPDATE signals SET cluster_id is called."""
    cluster_id = uuid4()
    signal_id = uuid4()
    mock_conn = AsyncMock()
    mock_conn.fetchrow.return_value = {
        "id": cluster_id,
        "signal_count": 3,
        "centroid_embedding": [0.1] * 1536,
    }

    with patch("services.clustering.get_conn") as mock_get_conn:
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=False)
        from services.clustering import assign_cluster
        await assign_cluster(signal_id, [0.1] * 1536)

        # Last execute call should link signal to cluster
        last_execute_call = mock_conn.execute.call_args_list[-1]
        sql, c_id, s_id = last_execute_call[0]
        assert "UPDATE signals" in sql
        assert c_id == cluster_id
        assert s_id == signal_id


async def test_centroid_updated_as_running_average():
    """New centroid = (old * n + new) / (n + 1)."""
    cluster_id = uuid4()
    n = 4
    old_centroid = np.array([0.0] * 1536, dtype=np.float32)
    new_embedding = np.array([1.0] * 1536, dtype=np.float32)
    expected_centroid = ((old_centroid * n) + new_embedding) / (n + 1)

    mock_conn = AsyncMock()
    mock_conn.fetchrow.return_value = {
        "id": cluster_id,
        "signal_count": n,
        "centroid_embedding": old_centroid.tolist(),
    }

    with patch("services.clustering.get_conn") as mock_get_conn:
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=False)
        from services.clustering import assign_cluster
        await assign_cluster(uuid4(), new_embedding.tolist())

        # First execute call is the centroid UPDATE
        update_call = mock_conn.execute.call_args_list[0]
        sql, centroid_arg, cid = update_call[0]
        assert "UPDATE clusters" in sql
        assert cid == cluster_id
        np.testing.assert_allclose(centroid_arg, expected_centroid.tolist(), rtol=1e-5)
