import os

from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer

from schemas import SearchRequest

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
client = QdrantClient(url=QDRANT_URL)
model = SentenceTransformer("all-MiniLM-L6-v2")
COLLECTION_NAME = "strapi_docs"


def search_kb(req: SearchRequest):
    vector = model.encode(req.query, normalize_embeddings=True).tolist()
    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=vector,
        limit=req.top_k,
        with_payload=True,
    )

    return [
        {
            "source_id": str(r.payload.get("source_id", "")),
            "chunk_id": str(r.payload.get("chunk_id", "")),
            "text": r.payload.get("text", ""),
            "score": r.score,
        }
        for r in results.points
    ]