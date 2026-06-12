from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=4, ge=1, le=20)


class SourceRequest(BaseModel):
    source_id: str
