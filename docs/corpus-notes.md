# Corpus Notes — Strapi v5 Documentation

## Corpus Selection

**Domain:** Strapi CMS v5 — a popular open-source headless CMS.  
**Why:** Public docs, well-structured Markdown, rich with technical Q&A content (permissions, APIs, webhooks, models). Good coverage of questions that have clear yes/no answers in the docs — ideal for testing grounding and abstention.

## Sources

| ID | File | Title | URL |
|---|---|---|---|
| strapi-001 | `strapi-001-users-permissions.md` | Users & Permissions | https://docs.strapi.io/cms/features/users-permissions |
| strapi-002 | `strapi-002-rbac.md` | Role-Based Access Control | https://docs.strapi.io/cms/features/rbac |
| strapi-003 | `strapi-003-api-tokens.md` | API Tokens | https://docs.strapi.io/cms/features/api-tokens |
| strapi-004 | `strapi-004-webhooks.md` | Webhooks | https://docs.strapi.io/cms/features/webhooks |
| strapi-005 | `strapi-005-models.md` | Content-Type Builder / Models | https://docs.strapi.io/cms/features/content-type-builder |

## Chunking Strategy

**Method:** Split each markdown file by H2 (`##`) and H3 (`###`) headings. Each heading + its paragraph text = one chunk.

**Rationale:**
- Strapi docs are already well-organized into semantic sections.
- H2/H3 boundaries map naturally to independent topics (e.g. "JWT configuration", "Rate limiting", "Deleting a role").
- Typical chunk size: 50–300 words — well within embedding model context.
- No overlap needed at this corpus size — sections don't bleed into each other.

## Embedding Model

**Model:** `all-MiniLM-L6-v2` (sentence-transformers)  
**Dimensions:** 384  
**Distance:** Cosine  
**Why:** Zero API cost, runs locally on CPU, good balance of speed and quality for English text retrieval tasks. Fine for a corpus of ~50 chunks.

## Chunk Stats (approximate)

| Source | Chunks |
|---|---|
| strapi-001 | 13 |
| strapi-002 | ~10 |
| strapi-003 | ~9 |
| strapi-004 | ~8 |
| strapi-005 | ~12 |
| **Total** | **~52** |

## Test Questions (in-corpus)

These should return high-scoring results (score > 0.6):
- "How does JWT authentication work in Strapi?"
- "What happens when you delete a user role?"
- "How do I create an API token in Strapi?"
- "What events trigger a webhook?"
- "What is the difference between Authenticated and Public roles?"

## Test Questions (out-of-corpus)

These should trigger abstention (score < 0.40):
- "What is the refund policy for Strapi Cloud?"
- "How do I deploy Strapi to AWS Lambda?"
- "What version of Node.js does Strapi require?" (may be too shallow)
- "Tell me about the Strapi marketplace plugins"

## Extending the Corpus

To add new sources:
1. Add a row to `corpus/manifest.csv`
2. Add the markdown file to `corpus/sources/`
3. Re-run `python ingestion/run_ingestion.py`

Qdrant's upsert is idempotent by `chunk_id` — existing chunks won't be duplicated.
