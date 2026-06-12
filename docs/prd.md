# Product Requirements Document (PRD)
## Grounded Answer Desk

**Version:** 1.0  
**Date:** June 2026  
**Author:** Anjali Singh  
**Track:** AI/ML Take-Home — RAG + MCP  
**Submitted to:** Confer Inc.

---

## 1. Overview

### 1.1 Problem Statement

Large language models (LLMs) are powerful but inherently prone to hallucination — generating confident-sounding answers that are factually incorrect or completely fabricated. For domain-specific Q&A systems (e.g., product documentation, internal knowledge bases), hallucinated answers are worse than no answer at all: they mislead users and erode trust.

The challenge is to build a system that:
- Answers questions **only from a defined corpus** of documents
- Makes the retrieval process **transparent** to the user
- **Refuses to answer** when the knowledge base does not contain relevant information
- Satisfies a strict **architectural boundary**: the AI agent must retrieve through a standardised MCP interface, not by directly querying the vector store

### 1.2 Solution

**Grounded Answer Desk** is a retrieval-augmented generation (RAG) Q&A system built on top of the **Model Context Protocol (MCP)**. It answers questions about Strapi v5 documentation by:

1. Retrieving semantically relevant document chunks via an MCP server
2. Passing only those retrieved chunks to a Gemini 2.5 Flash LLM
3. Requiring the LLM to cite every claim with a `source_id` and `chunk_id`
4. Abstaining honestly when the retrieval confidence is below a threshold
5. Displaying a **Retrieval Inspector** panel so users can see exactly which passages were used

---

## 2. Goals and Non-Goals

### Goals

| # | Goal |
|---|------|
| G1 | Provide accurate, grounded answers to questions about Strapi v5 documentation |
| G2 | Enforce strict MCP boundary — agent never touches Qdrant directly |
| G3 | Show retrieval transparency via a live inspector panel (chunks + scores) |
| G4 | Abstain when top retrieval score falls below 0.40 |
| G5 | Deploy publicly on Vercel with a persistent VPS backend |
| G6 | Survive VPS reboots via systemd services |
| G7 | Be reproducible from scratch via a single deploy script |

### Non-Goals

| # | Non-Goal |
|---|----------|
| NG1 | Real-time corpus updates / document ingestion via the UI |
| NG2 | Multi-user authentication or user accounts |
| NG3 | Support for languages other than English |
| NG4 | Fine-tuning the LLM on the corpus |
| NG5 | Streaming responses |

---

## 3. Users and Stakeholders

| User | Description | Primary Need |
|------|-------------|--------------|
| **Developer / Evaluator** | Confer Inc. reviewer assessing the submission | Verify the MCP architecture, grounding, abstention, and retrieval inspector work correctly |
| **End User** | Developer using Strapi and looking for documentation answers | Fast, accurate, cited answers without reading full docs |

---

## 4. Functional Requirements

### 4.1 Corpus Ingestion

| ID | Requirement |
|----|-------------|
| FR-01 | System must load source documents from `corpus/sources/*.md` |
| FR-02 | Documents must be split into chunks at H2/H3 Markdown headings |
| FR-03 | Each chunk must be embedded using `all-MiniLM-L6-v2` (384 dimensions) |
| FR-04 | Embedded chunks must be upserted into a Qdrant collection named `strapi_docs` using cosine similarity |
| FR-05 | Each chunk must carry metadata: `source_id`, `chunk_id`, `title`, `section_title`, `url`, `text` |

### 4.2 MCP Server

| ID | Requirement |
|----|-------------|
| FR-06 | MCP server must expose exactly two tools: `search_kb_tool` and `get_source_tool` |
| FR-07 | `search_kb_tool(query, top_k)` must embed the query and return top-k chunks with cosine scores |
| FR-08 | `get_source_tool(source_id)` must return all chunks for the given source document |
| FR-09 | MCP server must use **Streamable HTTP transport** on port 8001 |
| FR-10 | MCP server must be publicly reachable from Vercel (direct VPS IP, no tunnel required) |

### 4.3 Agent (OpenClaw + Gemini)

| ID | Requirement |
|----|-------------|
| FR-11 | Agent must call `search_kb_tool` before generating any answer |
| FR-12 | Agent must answer **only** from retrieved passages — no training data, no web search |
| FR-13 | Agent must cite `source_id` and `chunk_id` for every factual claim |
| FR-14 | If top retrieval score < 0.40, agent must respond: _"I don't have that in my sources."_ |
| FR-15 | Agent must use **Google Gemini 2.5 Flash** via Google AI Studio API |
| FR-16 | Agent must run on the OpenClaw Gateway (port 18789) on the VPS |

### 4.4 Frontend

| ID | Requirement |
|----|-------------|
| FR-17 | Frontend must provide a text input for user questions |
| FR-18 | Frontend must display the answer with inline source citations |
| FR-19 | Frontend must show a **Retrieval Inspector** panel with: chunk text, source_id, chunk_id, and similarity score |
| FR-20 | Frontend must visually distinguish abstained answers |
| FR-21 | Frontend must be deployed on Vercel with a public URL |

### 4.5 API Route

| ID | Requirement |
|----|-------------|
| FR-22 | `POST /api/ask` must accept `{ question: string }` |
| FR-23 | Response must include: `answer`, `citations[]`, `retrieval[]`, `abstained` |
| FR-24 | API must run both the agent call and MCP inspector call in parallel |
| FR-25 | API timeout must be 60 seconds maximum (Vercel serverless limit) |

---

## 5. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Availability**: Backend services (MCP server, OpenClaw Gateway) must auto-restart on crash via systemd |
| NFR-02 | **Persistence**: Services must survive VPS reboots without manual intervention |
| NFR-03 | **Reproducibility**: Full system must be deployable from scratch using `bash scripts/deploy.sh` |
| NFR-04 | **Latency**: End-to-end question → answer should complete within 30 seconds under normal load |
| NFR-05 | **Security**: API keys and secrets must never be committed to the repository (enforced by `.gitignore`) |
| NFR-06 | **Build integrity**: Next.js frontend must build without TypeScript errors |

---

## 6. Architecture Summary

```
Browser
  └─► Next.js on Vercel
        └─► POST /api/ask
              ├─► OpenClaw Gateway (VPS :18789)
              │     └─► search_kb_tool via MCP (HTTP)
              │           └─► MCP Server (VPS :8001)
              │                 └─► Qdrant (VPS :6333)
              │     └─► Google Gemini 2.5 Flash (Google AI Studio)
              │           └─► Grounded answer with citations
              └─► MCP Server (VPS :8001) — direct call for Retrieval Inspector
                    └─► top-k chunks + scores for Inspector panel
```

**Key architectural constraint:** The LLM agent has zero direct access to Qdrant. All knowledge retrieval flows through the MCP tool interface.

---

## 7. Data Model

### Chunk (stored in Qdrant)

```json
{
  "source_id": "strapi-003",
  "chunk_id": "strapi-003-4",
  "title": "API Tokens",
  "section_title": "Code-based configuration",
  "url": "https://docs.strapi.io/cms/features/api-tokens",
  "text": "### Code-based configuration\n\nNew API tokens are generated using a salt..."
}
```

### API Response (`POST /api/ask`)

```json
{
  "answer": "To create an API token in Strapi, navigate to...",
  "citations": [
    {
      "source_id": "strapi-003",
      "chunk_id": "strapi-003-3",
      "score": 0.808,
      "excerpt": "### Admin panel settings..."
    }
  ],
  "retrieval": [
    {
      "source_id": "strapi-003",
      "chunk_id": "strapi-003-2",
      "text": "## Configuration\nMost configuration options...",
      "score": 0.877
    }
  ],
  "abstained": false
}
```

---

## 8. Corpus

| Source ID | Document | Chunks |
|-----------|----------|--------|
| strapi-001 | Users & Permissions | 13 |
| strapi-002 | Role-Based Access Control (RBAC) | ~10 |
| strapi-003 | API Tokens | ~9 |
| strapi-004 | Webhooks | ~8 |
| strapi-005 | Content-Type Builder / Models | ~12 |

**Total:** ~52 chunks · Embedding model: `all-MiniLM-L6-v2` (384 dimensions) · Similarity: cosine

---

## 9. Grounding & Abstention Policy

| Condition | Behaviour |
|-----------|-----------|
| `top_score ≥ 0.40` | Answer from retrieved passages with citations |
| `top_score < 0.40` | Abstain: _"I don't have that in my sources."_ |
| No chunks returned | Abstain immediately |
| Agent uses web search | **Forbidden** — blocked by system prompt |
| Agent uses training knowledge | **Forbidden** — blocked by system prompt |

---

## 10. System Prompt

Located at `app/lib/prompts/system.txt`. Key rules enforced:

1. **Always call `search_kb_tool` first** before answering
2. **Answer only from retrieved passages** — no training data, no web search
3. **Cite `source_id` and `chunk_id`** for every fact
4. **Abstain** if retrieval score < 0.40
5. **Never hallucinate** — only facts from retrieved passages

---

## 11. Infrastructure

| Component | Technology | Location |
|-----------|-----------|----------|
| Frontend | Next.js 15 on Vercel | `app/` |
| OpenClaw Gateway | `openclaw.service` (systemd) | VPS port 18789 |
| MCP Server | `mcp-server.service` (systemd) | VPS port 8001 |
| Vector Store | Qdrant in Docker (`--restart always`) | VPS port 6333 |
| LLM | Google Gemini 2.5 Flash | Google AI Studio |
| VPS | AWS EC2 `t3.micro` (Ubuntu 22.04) | `ap-southeast-2` |

---

## 12. Success Metrics

| Metric | Target |
|--------|--------|
| In-corpus question answered with citations | ≥ 90% of relevant questions |
| Out-of-corpus question correctly abstained | 100% |
| Retrieval Inspector visible and populated | 100% of requests |
| Vercel deployment successful | Build passes, 0 TypeScript errors |
| VPS services survive reboot | Both systemd services auto-restart |
| System prompt enforced | No web search or training data leakage |

---

## 13. Out of Scope / Future Work

- **UI enhancements**: dark mode toggle, mobile responsiveness improvements
- **Multi-corpus support**: ingesting more than one documentation set
- **Feedback loop**: thumbs up/down to improve retrieval quality
- **Streaming answers**: token-by-token response rendering
- **Admin panel**: UI to add/update/delete corpus documents without CLI
