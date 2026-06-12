# Grounded Answer Desk

> **Confer Inc. AI/ML Take-Home · RAG + MCP track**  
> A production-grade Q&A system that retrieves from a vector knowledge base through an MCP server, answers with citations, and shows the retrieval inspector so you can see exactly why it answered.

---

## Architecture

```
Question (frontend)
    │
    ▼
Next.js API route (app/pages/api/ask.ts)
    │
    ├──► OpenClaw Gateway (VPS :18789) — Google Gemini 2.5 Flash
    │         │  retrieves via MCP (Streamable HTTP)
    │         ▼
    │    MCP Server (VPS :8001)
    │         │  search_kb_tool / get_source_tool
    │         ▼
    │    Qdrant vector store (VPS :6333)
    │         └── top-k chunks + cosine scores
    │
    └──► MCP Server (VPS :8001) — direct call for Retrieval Inspector
              │
              ▼
         top-k chunks + scores → Inspector panel

Answer + Citations + Retrieval Inspector (frontend)
```

**Key constraint:** the agent **never touches Qdrant directly** — it only retrieves through the two MCP tools (`search_kb_tool`, `get_source_tool`). That is the MCP boundary.

---

## Stack

| Layer | Technology |
|---|---|
| Vector store | Qdrant (Docker, persisted to `data/qdrant/`) |
| Embeddings | `all-MiniLM-L6-v2` via `sentence-transformers` (local, no API key) |
| MCP server | Python · `mcp` SDK · FastMCP · **Streamable HTTP transport** (port 8001) |
| Agent | **OpenClaw Gateway** on VPS — Google **Gemini 2.5 Flash** (Google AI Studio) |
| Frontend | Next.js 15 · deployed on **Vercel** |
| Corpus | Strapi v5 documentation (5 sources, ~50 chunks) |
| VPS | AWS EC2 (Ubuntu 22.04) — MCP + OpenClaw run as **systemd services** |

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (for Qdrant)
- A Google AI Studio API key (`gemini-2.5-flash`)
- OpenClaw installed globally on the VPS (`npm install -g openclaw`)

---

## Quick Start (local dev) — ~10 minutes

### 1 · Clone & environment

```bash
git clone https://github.com/singh-anjali24/grounded-answer-desk.git
cd grounded-answer-desk
cp .env.example .env
# Edit .env — set QDRANT_URL, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY
```

### 2 · Install Python dependencies

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3 · Start Qdrant

```bash
docker run -d \
  --name qdrant \
  --restart always \
  -p 6333:6333 -p 6334:6334 \
  -v "$(pwd)/data/qdrant:/qdrant/storage" \
  qdrant/qdrant
```

Wait ~5 seconds for Qdrant to become healthy:
```bash
curl http://localhost:6333/healthz
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
# → Uvicorn running on http://0.0.0.0:8001
# MCP endpoint: http://localhost:8001/mcp
```

### 6 · Start the frontend

```bash
cd app
npm install
npm run dev
# → http://localhost:3000
```

Set these in your local `app/.env.local`:
```
OPENCLAW_URL=http://localhost:18789
OPENCLAW_TOKEN=<your openclaw gateway token>
MCP_URL=http://localhost:8001/mcp
```

Open http://localhost:3000 — type a question, see the grounded answer, citations, and retrieval inspector.

---

## MCP Tools

The MCP server exposes exactly two tools (as required by the assignment):

### `search_kb_tool(query: str, top_k: int = 4) → list`

Embeds `query` with `all-MiniLM-L6-v2`, runs cosine-similarity search in Qdrant, returns top-k chunks:

```json
[
  {
    "source_id": "strapi-003",
    "chunk_id": "strapi-003-2",
    "text": "## Configuration\nMost configuration options for API tokens...",
    "score": 0.8747
  }
]
```

### `get_source_tool(source_id: str) → dict`

Retrieves all chunks belonging to a source document:

```json
{
  "source_id": "strapi-003",
  "found": true,
  "chunks": [{ "id": "...", "payload": { ... } }]
}
```

---

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector http://localhost:8001/mcp
```

Test queries:
- `search_kb_tool` → `{"query": "How does RBAC work in Strapi?", "top_k": 4}`
- `get_source_tool` → `{"source_id": "strapi-003"}`

---

## System Prompt (Grounding Contract)

The agent's system prompt is defined in `app/pages/api/ask.ts` and enforces strict grounding:

1. **Must call `search_kb_tool` first** before answering anything
2. **Answer ONLY from retrieved passages** — no training data, no web search
3. **Cite `source_id` and `chunk_id`** for every fact
4. **Abstain** if top retrieval score < 0.40: _"I don't have that in my sources."_
5. **Never hallucinate** — only facts from retrieved passages

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

Chunking strategy: split by H2/H3 Markdown headings → each section is one chunk (~50–300 words).

---

## VPS Deployment (full redeploy from scratch)

```bash
# On a fresh Ubuntu 22.04 VPS:
git clone https://github.com/singh-anjali24/grounded-answer-desk.git
cd grounded-answer-desk
cp .env.example .env && nano .env   # fill in your values
bash scripts/deploy.sh
```

`deploy.sh` will:
1. Install Python, Node, Docker
2. Create a Python venv and install `requirements.txt`
3. Start Qdrant as a Docker container (persisted to `data/qdrant/`, `--restart always`)
4. Run the ingestion pipeline
5. Register the MCP server as a `systemd` service (`mcp-server.service`)
6. Configure OpenClaw with Google AI Studio API key
7. Register OpenClaw Gateway as a `systemd` service (`openclaw.service`)

Both services auto-start on reboot and auto-restart on crash.

Frontend → Vercel: push triggers auto-deploy. Set these env vars in Vercel dashboard:
- `OPENCLAW_URL` — your VPS public IP + port 18789 (e.g. `http://3.x.x.x:18789`)
- `OPENCLAW_TOKEN` — from `~/.openclaw/openclaw.json` on the VPS
- `MCP_URL` — your VPS public IP + port 8001 (e.g. `http://3.x.x.x:8001/mcp`)

---

## Rubric Checklist

| Requirement | Implementation |
|---|---|
| OpenClaw agent on VPS | OpenClaw Gateway (`openclaw.service`) + Google Gemini 2.5 Flash |
| Ingest corpus → chunks → embed → vector store | `ingestion/` pipeline → Qdrant |
| MCP server with `search_kb_tool` + `get_source_tool` | `mcp-server/server.py` (FastMCP, Streamable HTTP) |
| Agent retrieves **only** through MCP tools | Enforced by architecture — no direct Qdrant access in agent |
| Grounded answers with citations | System prompt in `app/pages/api/ask.ts` + citation cards in frontend |
| Abstain when retrieval is weak | Score threshold 0.40 in `ask.ts` |
| Retrieval inspector (chunks + scores + source) | `app/components/RetrievalInspector.tsx` |
| README redeploys from scratch | `scripts/deploy.sh` + this README |
| Deployed, public, persistent | Vercel (frontend) + AWS EC2 with systemd (backend) |

---

## Project Structure

```
grounded-answer-desk/
├── agent/
│   └── openclaw-config.yaml     # OpenClaw agent config (MCP server URL, model)
├── app/                         # Next.js frontend (deployed to Vercel)
│   ├── components/
│   │   ├── AskBox.tsx
│   │   ├── AnswerCard.tsx
│   │   ├── CitationCard.tsx
│   │   └── RetrievalInspector.tsx
│   ├── lib/
│   │   └── agent-client.ts      # MCP client helper (used for inspector)
│   ├── pages/
│   │   ├── index.tsx
│   │   └── api/ask.ts           # Main API route + system prompt
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
│   ├── server.py                # FastMCP Streamable HTTP server (port 8001)
│   ├── search_kb.py             # search_kb_tool implementation
│   ├── get_source.py            # get_source_tool implementation
│   └── schemas.py               # Pydantic models
├── scripts/
│   ├── deploy.sh                # VPS full deploy from scratch
│   ├── start.sh                 # Start all services locally
│   └── smoke-test.sh            # Sanity checks
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   └── corpus-notes.md
├── .env.example                 # Env var template
├── requirements.txt             # Python deps
└── README.md                    # This file
```
