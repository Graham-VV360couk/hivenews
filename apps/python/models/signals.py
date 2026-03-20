from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class IngestRequest(BaseModel):
    url: str
    title: str | None = None
    content: str | None = None
    published_at: datetime | None = None
    source_id: UUID | None = None
    source_type: str = "rss_feed"
    domain_tags: list[str] = []
    is_public: bool = True
    provenance_url: str | None = None


class IngestResponse(BaseModel):
    id: UUID | None
    deduplicated: bool
    message: str
