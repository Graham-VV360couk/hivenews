"""Assign a signal to the nearest cluster or create a new one.

Uses pgvector cosine distance (threshold 0.3). Centroid update is computed in
Python with numpy — pgvector does not support scalar multiplication/division
operators on vector columns directly.
"""

from uuid import UUID

import numpy as np

from database import get_conn

_SIMILARITY_THRESHOLD = 0.3  # cosine distance — lower = more similar


async def assign_cluster(signal_id: UUID, embedding: list[float]) -> UUID:
    """Return cluster UUID. Creates a new cluster if no match within threshold."""
    emb_array = np.array(embedding, dtype=np.float32)

    async with get_conn() as conn:
        # Find nearest active cluster within the similarity threshold
        row = await conn.fetchrow(
            """
            SELECT id, signal_count, centroid_embedding
            FROM clusters
            WHERE is_active = TRUE
              AND centroid_embedding IS NOT NULL
              AND (centroid_embedding <=> $1::vector) < $2
            ORDER BY centroid_embedding <=> $1::vector
            LIMIT 1
            """,
            emb_array.tolist(),
            _SIMILARITY_THRESHOLD,
        )

        if row:
            cluster_id: UUID = row["id"]
            n = row["signal_count"]
            # Running average: new_centroid = (old_centroid * n + new_embedding) / (n + 1)
            old_centroid = np.array(row["centroid_embedding"], dtype=np.float32)
            new_centroid = ((old_centroid * n) + emb_array) / (n + 1)

            await conn.execute(
                """
                UPDATE clusters SET
                    signal_count = signal_count + 1,
                    centroid_embedding = $1::vector,
                    last_signal_at = NOW(),
                    updated_at = NOW()
                WHERE id = $2
                """,
                new_centroid.tolist(),
                cluster_id,
            )
        else:
            # No matching cluster — create one with this signal's embedding as centroid
            new_row = await conn.fetchrow(
                """
                INSERT INTO clusters (centroid_embedding, signal_count, first_signal_at, last_signal_at)
                VALUES ($1::vector, 1, NOW(), NOW())
                RETURNING id
                """,
                emb_array.tolist(),
            )
            cluster_id = new_row["id"]

        # Link signal to cluster
        await conn.execute(
            "UPDATE signals SET cluster_id = $1 WHERE id = $2",
            cluster_id,
            signal_id,
        )

    return cluster_id
