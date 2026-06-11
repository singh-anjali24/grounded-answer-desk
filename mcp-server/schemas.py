from pydantic import BaseModel


class SearchRequest(BaseModel):
    query: str
    top_k: int = 4


class SourceRequest(BaseModel):
    source_id: str
