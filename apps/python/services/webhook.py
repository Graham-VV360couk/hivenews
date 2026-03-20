"""Webhook notification service.

On every successful pack publish, POST a notification to all active
api_subscribers that have a webhook_url configured.

Payload sent to each webhook:
{
  "event": "pack.published",
  "pack_id": "...",
  "pack_type": "standard|alert_breaking|...",
  "domain_tags": ["ai", "vr"],
  "published_at": "2026-03-20T08:00:00Z"
}

Failures are logged but never block the publish flow.
"""
import logging
from datetime import datetime, timezone
from uuid import UUID

import httpx

from database import get_conn

log = logging.getLogger(__name__)

_TIMEOUT = 5.0  # seconds — webhooks must not slow down publish


async def fire_webhooks(
    pack_id: UUID,
    pack_type: str,
    domain_tags: list[str],
) -> None:
    """POST pack.published notification to all active subscribers with webhook URLs.

    Never raises — failures are logged and skipped.
    """
    try:
        async with get_conn() as conn:
            subscribers = await conn.fetch(
                """
                SELECT webhook_url, api_key
                FROM api_subscribers
                WHERE is_active = TRUE
                  AND webhook_url IS NOT NULL
                  AND webhook_url != ''
                """
            )
    except Exception as exc:
        log.warning("Failed to fetch webhook subscribers: %s", exc)
        return

    if not subscribers:
        return

    payload = {
        "event": "pack.published",
        "pack_id": str(pack_id),
        "pack_type": pack_type,
        "domain_tags": domain_tags,
        "published_at": datetime.now(timezone.utc).isoformat(),
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for sub in subscribers:
            try:
                await client.post(
                    sub["webhook_url"],
                    json=payload,
                    headers={"X-NewsHive-Event": "pack.published"},
                )
            except Exception as exc:
                log.warning("Webhook delivery failed to %s: %s", sub["webhook_url"], exc)
