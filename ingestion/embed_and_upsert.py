import json
import os
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.http import models as rest
from sentence_transformers import SentenceTransformer

BASE = Path(__file__).resolve().parents[1]
CHUNKS_DIR = BASE / "corpus" / "chunks"
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = "strapi_docs"
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"


def iter_jsonl_files(chunks_dir):
    for path in sorted(Path(chunks_dir).glob("*.jsonl")):
        yield path


def load_chunks(path):
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def main():
    model = SentenceTransformer(EMBED_MODEL_NAME)
    client = QdrantClient(url=QDRANT_URL)

    sample_vec = model.encode("test", normalize_embeddings=True).tolist()
    dim = len(sample_vec)

    if client.collection_exists(COLLECTION_NAME):
        info = client.get_collection(COLLECTION_NAME)
        vcount = info.vectors_count or 0
        if vcount > 0:
            print(f"Collection '{COLLECTION_NAME}' already has {vcount} vectors; skipping upsert.")
            return
        else:
            print(f"Collection '{COLLECTION_NAME}' exists but is empty — re-ingesting …")
    else:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=rest.VectorParams(
                size=dim,
                distance=rest.Distance.COSINE,
            ),
        )

    points = []
    point_id = 1
    count = 0

    for jsonl_file in iter_jsonl_files(CHUNKS_DIR):
        for chunk in load_chunks(jsonl_file):
            count += 1
            text = chunk["text"]
            vec = model.encode(text, normalize_embeddings=True).tolist()
            points.append(
                rest.PointStruct(
                    id=point_id,
                    vector=vec,
                    payload={
                        "chunk_id": chunk["chunk_id"],
                        "source_id": chunk["source_id"],
                        "title": chunk["title"],
                        "url": chunk["url"],
                        "section_title": chunk.get("section_title", ""),
                        "text": text,
                    },
                )
            )
            point_id += 1

            if len(points) >= 64:
                client.upsert(collection_name=COLLECTION_NAME, points=points)
                points = []

    if points:
        client.upsert(collection_name=COLLECTION_NAME, points=points)

    print(f"Loaded {count} chunks from {CHUNKS_DIR}")
    print(f"Upserted {point_id - 1} chunks into {COLLECTION_NAME}")


if __name__ == "__main__":
    main()