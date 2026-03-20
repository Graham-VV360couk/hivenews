"""POST /publish — publish an approved content pack to all social platforms."""
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.publisher import publish_pack

log = logging.getLogger(__name__)
router = APIRouter()


class PublishRequest(BaseModel):
    pack_id: UUID


@router.post("/publish")
async def trigger_publish(req: PublishRequest) -> dict:
    """Publish all approved drafts in a content pack to their platforms."""
    result = await publish_pack(req.pack_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
