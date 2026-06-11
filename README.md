# Grounded Answer Desk

> **Confer Inc. AI/ML Take-Home · RAG + MCP track**  
> A production-grade Q&A system that retrieves from a vector knowledge base through an MCP server, answers with citations, and shows the retrieval inspector so you can see exactly why it answered.

---

## Architecture

```
Question (frontend)
    │
    ▼
OpenClaw/Hermes Agent
    │   calls via MCP (SSE)
    ▼
MCP Server  ─── search_kb_tool(query) ──▶  Qdrant vector store
            ◀── top-k chunks + scores ───
    │   calls via MCP (SSE)
    ▼
get_source_tool(source_id) → full source doc
    │
    ▼
LLM (Ollama / any OpenAI-compatible)
    │
    ▼
Answer + Citations + Retrieval Inspector (frontend)
```

**Key constraint:** the agent **never touches Qdrant directly** — it only calls the two MCP tools. That's the point.

---

## Stack

| Layer | Technology |
|---|---|
| Vector store | Qdrant (Docker) |
| Embeddings | `all-MiniLM-L6-v2` via `sentence-transformers` (local, no API key) |
| MCP server | Python · `mcp` SDK · FastMCP · SSE transport |
| Agent | OpenClaw + MCP TypeScript SDK |
| LLM | Ollama (`llama3.2`) or any OpenAI-compatible endpoint |
| Frontend | Next.js 15 · deployed on Vercel |
| Corpus | Strapi v5 documentation (5 sources, ~50 chunks) |

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (for Qdrant)
- (Optional) Ollama running locally for LLM generation

---

## Quick Start (local dev) — ~10 minutes

### 1 · Clone & environment

```bash
git clone https://github.com/YOUR_USERNAME/grounded-answer-desk.git
cd grounded-answer-desk
cp .env.example .env
# Edit .env — at minimum set QDRANT_URL and optionally LLM_BASE_URL
```

### 2 · Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3 · Start Qdrant

```bash
docker run -d \
  --name qdrant \
  -p 6335:6333 -p 6336:6334 \
  -v "$(pwd)/data/qdrant:/qdrant/storage" \
  qdrant/qdrant
```

Wait ~5 seconds for Qdrant to become healthy:
```bash
curl http://localhost:6335/healthz
# → {"title":"qdrant - vector search engine","version":"..."}
```

### 4 · Run ingestion

```bash
python ingestion/run_ingestion.py
```

This will:
- Load the 5 Strapi docs from `corpus/sources/`
- Split into section-level chunks and write to `corpus/chunks/`
- Embed each chunk with `all-MiniLM-L6-v2`
- Upsert into the `strapi_docs` Qdrant collection

Expected output: `Upserted ~50 chunks into strapi_docs`

### 5 · Start the MCP server

```bash
cd mcp-server
python server.py
# → Uvicorn running on http://127.0.0.1:8000
# MCP Inspector URL: http://127.0.0.1:8000/sse
```

### 6 · (Optional) Start Ollama for LLM

```bash
ollama serve
ollama pull llama3.2
```

### 7 · Start the frontend

```bash
cd app
npm install
npm run dev
# → http://localhost:3000
```

Open http://localhost:3000 — type a question, see the grounded answer, citations, and retrieval inspector.

---

## MCP Tools

The MCP server exposes exactly two tools (as required):

### `search_kb_tool(query: str, top_k: int = 4) → list`

Embeds `query` with `all-MiniLM-L6-v2`, runs cosine-similarity search in Qdrant, returns top-k chunks:

```json
[
  {
    "source_id": "strapi-002",
    "chunk_id": "strapi-002-3",
    "text": "## Role management\nSuperAdmin can create ...",
    "score": 0.8214
  }
]
```

### `get_source_tool(source_id: str) → dict`

Retrieves all chunks belonging to a source document:

```json
{
  "source_id": "strapi-002",
  "found": true,
  "chunks": [{ "id": "...", "payload": { ... } }]
}
```

---

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:8000/sse
```

Or open https://inspector.tools.anthropic.com and connect to `http://localhost:8000/sse`.

Test queries:
- `search_kb_tool` → `{"query": "How does RBAC work in Strapi?", "top_k": 4}`
- `get_source_tool` → `{"source_id": "strapi-002"}`

---

## Corpus

The knowledge base is **Strapi v5 documentation** (5 topics):

| ID | Title | Chunks |
|---|---|---|
| strapi-001 | Users & Permissions | 13 |
| strapi-002 | Role-Based Access Control | ~10 |
| strapi-003 | API Tokens | ~9 |
| strapi-004 | Webhooks | ~8 |
| strapi-005 | Content-Type Builder / Models | ~12 |

Chunking strategy: split by H2/H3 Markdown headings → each section is one chunk (~50–300 words). No overlap needed at this corpus size.

---

## Grounding & Abstention

- **System prompt** (`agent/prompts/system.txt`) instructs the agent to answer only from retrieved passages and cite `source_id`/`chunk_id` for every claim.
- **Abstention threshold:** if `top_score < 0.40`, the system returns: _"I don't have that in my sources."_
- **No hallucination path:** the LLM only sees the retrieved chunk text, never its full training knowledge.

---

## VPS Deployment

```bash
# On the VPS (Ubuntu 22.04+):
git clone https://github.com/YOUR_USERNAME/grounded-answer-desk.git
cd grounded-answer-desk
cp .env.example .env && nano .env   # fill in your values
bash scripts/deploy.sh
```

`deploy.sh` will:
1. Install Python, Node, Docker
2. Create a Python venv and install `requirements.txt`
3. Start Qdrant as a Docker container (persisted to `data/qdrant/`)
4. Run the ingestion pipeline
5. Register the MCP server as a `systemd` service (auto-restarts)
6. Build and start the Next.js frontend with PM2

Frontend → Vercel: push the `app/` folder to Vercel (set `NEXT_PUBLIC_API_URL` and `LLM_BASE_URL` env vars in the Vercel dashboard).

---

## Rubric Checklist

| Requirement | Status |
|---|---|
| OpenClaw/Hermes agent | `agent/agent-client.ts` + `agent/openclaw-config.yaml` |
| Ingest corpus → chunks → embed → vector store | `ingestion/` pipeline + Qdrant |
| MCP server with `search_kb` + `get_source` | `mcp-server/server.py` |
| Agent retrieves **only** through MCP tools | Enforced by architecture |
| Grounded answers with citations | System prompt + citation cards |
| Abstain when retrieval is weak | Score threshold 0.40 |
| Retrieval inspector (chunks + scores + source) | `RetrievalInspector.tsx` |
| README redeploys from scratch | This file |
| Deployed, public, persistent | Vercel + VPS + systemd |

---

## Project Structure

```
grounded-answer-desk/
├── agent/
│   ├── agent-client.ts          # MCP → LLM agent
│   ├── openclaw-config.yaml     # OpenClaw config
│   └── prompts/system.txt       # Grounding system prompt
├── app/                         # Next.js frontend
│   ├── components/
│   │   ├── AskBox.tsx
│   │   ├── AnswerCard.tsx
│   │   ├── CitationCard.tsx
│   │   └── RetrievalInspector.tsx
│   ├── lib/api.ts
│   ├── pages/
│   │   ├── index.tsx
│   │   └── api/ask.ts
│   └── styles/globals.css
├── corpus/
│   ├── manifest.csv             # Source registry
│   ├── sources/                 # Raw markdown docs
│   └── chunks/                  # Pre-chunked JSONL
├── ingestion/
│   ├── run_ingestion.py         # Pipeline entry point
│   ├── collect_docs.py
│   ├── chunk_docs.py
│   ├── embed_and_upsert.py
│   └── utils.py
├── mcp-server/
│   ├── server.py                # FastMCP SSE server
│   ├── search_kb.py             # search_kb_tool impl
│   ├── get_source.py            # get_source_tool impl
│   └── schemas.py               # Pydantic models
├── scripts/
│   ├── deploy.sh                # VPS full deploy
│   ├── start.sh                 # Local start all
│   └── smoke-test.sh            # Sanity checks
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   └── corpus-notes.md
├── .env.example                 # Env var template
├── requirements.txt             # Python deps
└── README.md                    # This file
```
