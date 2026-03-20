"""Publish an approved content pack to all social platforms.

For each approved draft in the pack:
  - x        → post_tweet (single) or post_thread (thread)
  - linkedin  → post_to_linkedin
  - facebook  → post_to_facebook
  - blog      → marked published_at = NOW() (served via Next.js /blog/{pack_id})
  - instagram → deferred (requires media pipeline)
  - hivecast  → deferred (HeyGen integration, later phase)

Updates content_drafts.platform_post_id and published_at.
Updates content_packs.status = 'published', published_at = NOW().
"""
import json
import logging
from uuid import UUID

from database import get_conn
from services.social.x import post_tweet, post_thread
from services.social.linkedin import post_to_linkedin
from services.social.meta import post_to_facebook

log = logging.getLogger(__name__)


async def publish_pack(pack_id: UUID) -> dict:
    """Publish all approved drafts for a content pack.

    Returns:
        {"pack_id": str, "published": int, "skipped": int, "errors": list}
    """
    async with get_conn() as conn:
        pack = await conn.fetchrow(
            "SELECT id, status FROM content_packs WHERE id = $1",
            pack_id,
        )
        if not pack:
            return {"error": f"Pack {pack_id} not found"}

        drafts = await conn.fetch(
            """
            SELECT id, platform, final_text, draft_text, draft_data, approved
            FROM content_drafts
            WHERE pack_id = $1 AND approved = TRUE
            ORDER BY platform
            """,
            pack_id,
        )

    published = 0
    skipped = 0
    errors = []

    for draft in drafts:
        platform = draft["platform"]
        text = draft["final_text"] or draft["draft_text"] or ""
        platform_post_id = None

        try:
            if platform == "x":
                data = json.loads(draft["draft_data"] or "{}")
                tweets = data.get("tweets", [text])
                if len(tweets) == 1:
                    platform_post_id = await post_tweet(tweets[0])
                else:
                    platform_post_id = await post_thread(tweets)

            elif platform == "linkedin":
                platform_post_id = await post_to_linkedin(text)

            elif platform == "facebook":
                platform_post_id = await post_to_facebook(text)

            elif platform == "blog":
                # Blog is served by Next.js — just mark published
                platform_post_id = f"blog:{pack_id}"

            else:
                # instagram / hivecast — deferred
                skipped += 1
                continue

        except Exception as exc:
            log.warning("Publish failed for %s draft of pack %s: %s", platform, pack_id, exc)
            errors.append({"platform": platform, "error": str(exc)})
            continue

        # Update draft record
        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE content_drafts
                SET platform_post_id = $1, published_at = NOW()
                WHERE id = $2
                """,
                platform_post_id,
                draft["id"],
            )
        published += 1

    # Mark pack as published
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE content_packs
            SET status = 'published', published_at = NOW()
            WHERE id = $1
            """,
            pack_id,
        )

    log.info("Pack %s published: %d platforms, %d skipped, %d errors",
             pack_id, published, skipped, len(errors))

    return {
        "pack_id": str(pack_id),
        "published": published,
        "skipped": skipped,
        "errors": errors,
    }
