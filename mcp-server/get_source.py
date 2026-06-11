import os

from qdrant_client import QdrantClient, models
from schemas import SourceRequest

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
client = QdrantClient(url=QDRANT_URL)
COLLECTION_NAME = "strapi_docs"

def get_source(req: SourceRequest):
    scroll_filter = models.Filter(
        must=[
            models.FieldCondition(
                key="source_id",
                match=models.MatchValue(value=str(req.source_id)),
            )
        ]
    )

    result, _ = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=scroll_filter,
        limit=100,
        with_payload=True,
        with_vectors=False,
    )

    if not result:
        return {"source_id": str(req.source_id), "found": False}

    return {
        "source_id": str(req.source_id),
        "found": True,
        "chunks": [
            {
                "id": str(point.id),
                "payload": point.payload,
            }
            for point in result
        ],
    }