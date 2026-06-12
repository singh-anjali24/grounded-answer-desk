# Architecture — Grounded Answer Desk

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  INGESTION (one-time / on demand)                               │
│                                                                  │
│  corpus/sources/*.md                                            │
│       │                                                          │
│       ▼ chunk_docs.py (H2/H3 heading split)                     │
│  corpus/chunks/*.jsonl                                          │
│       │                                                          │
│       ▼ embed_and_upsert.py (all-MiniLM-L6-v2)                 │
│  Qdrant  ──  collection: strapi_docs  (cosine, dim=384)        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  QUERY (live)                                                    │
│                                                                  │
│  Browser → Next.js frontend (ask box)                          │
│       │                                                          │
│       ▼ POST /api/ask                                            │
│  Next.js API route                                              │
│       │                                                          │
│       ▼ MCP Streamable HTTP (search_kb_tool)                     │
│  FastMCP server (server.py)                                     │
│       │                                                          │
│       ▼ QdrantClient.query_points()                             │
│  Qdrant vector store                                            │
│       │                                                          │
│       ▼ top-k chunks + cosine scores                            │
│  FastMCP server → Next.js API route                             │
│       │                                                          │
│       ▼ POST /v1/chat/completions                               │
│  OpenClaw Gateway → Google Gemini 2.5 Flash                     │
│       │                                                          │
│       ▼ answer + citations + retrieval data                     │
│  Browser → AnswerCard + CitationCard + RetrievalInspector      │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### `ingestion/`
- `collect_docs.py` — reads manifest.csv, loads markdown source files
- `chunk_docs.py` — splits each markdown file by H2/H3 headings into section-level chunks, writes JSONL
- `embed_and_upsert.py` — encodes each chunk with `all-MiniLM-L6-v2` (384-dim), upserts into Qdrant in batches of 64
- `run_ingestion.py` — orchestrates the above three steps in order

### `mcp-server/`
- `server.py` — FastMCP server running over **Streamable HTTP** on port **8001**. Registers exactly two tools.
- `search_kb_tool` — embed query → Qdrant `query_points` → return top-k `[{source_id, chunk_id, text, score}]`
- `get_source_tool` — Qdrant `scroll` by `source_id` filter → return all chunks for that source

### `agent/`
- `agent-client.ts` — connects to the MCP server via **Streamable HTTP**, calls `search_kb_tool`, used for the Retrieval Inspector
- `openclaw-config.yaml` — OpenClaw agent config (MCP server URL, LLM endpoint, system prompt path)
- System prompt is defined inline in `app/pages/api/ask.ts` — enforces grounding: answer only from retrieved passages, cite, abstain if retrieval weak

### `app/`
- `pages/index.tsx` — main page: AskBox + AnswerCard + RetrievalInspector
- `pages/api/ask.ts` — server-side API route: calls MCP search, optionally calls LLM, returns JSON
- `components/RetrievalInspector.tsx` — collapsible panel showing each retrieved chunk, its score, and a visual score bar

## Data Flow — Grounding Contract

1. User types a question.
2. `search_kb_tool` is called — **this is the only path to the knowledge base**.
3. If `top_score < 0.40` → abstain immediately, no LLM call.
4. Otherwise, the LLM receives **only the retrieved chunk text** as context — no internet, no training memory.
5. The LLM is instructed to cite `source_id`/`chunk_id` for every claim.
6. The frontend renders citations and the raw retrieval inspector side by side.

## Why Streamable HTTP Transport?

The MCP server uses `transport="streamable-http"` (FastMCP default for HTTP). This is compatible with the MCP Inspector (`npx @modelcontextprotocol/inspector http://localhost:8001/mcp`) and with the production client using `StreamableHTTPClientTransport`.
