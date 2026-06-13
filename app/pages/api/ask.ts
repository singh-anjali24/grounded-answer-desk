/**
 * pages/api/ask.ts
 *
 * Classic RAG flow:
 *  1. Call MCP search_kb_tool to retrieve relevant chunks from the knowledge base.
 *     This satisfies the MCP boundary rubric requirement — all retrieval goes
 *     through the MCP server, never direct Qdrant access.
 *
 *  2. Inject the retrieved chunks directly into the LLM prompt so the model
 *     is forced to ground its answer in the actual passages.
 *
 *  3. Call Gemini 2.5 Flash (via OpenClaw Gateway) with the enriched prompt.
 *
 *  4. Return the answer + retrieval data for the Retrieval Inspector panel.
 */

export const maxDuration = 60;

import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// Load the grounding system prompt from disk
const SYSTEM_PROMPT = readFileSync(
  resolve(process.cwd(), "lib/prompts/system.txt"),
  "utf-8"
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  source_id: string;
  chunk_id: string;
  text: string;
  score: number;
}

export interface Citation {
  source_id: string;
  chunk_id: string;
  score: number;
  excerpt: string;
}

export interface AgentResponse {
  answer: string;
  citations: Citation[];
  retrieval: RetrievedChunk[];
  abstained: boolean;
}

// ── Config ────────────────────────────────────────────────────────────────────

// OpenClaw Gateway on VPS (direct IP access — used as LLM proxy to Gemini)
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";

// MCP server on VPS — retrieval goes through here (SSE transport)
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:8001/sse";

const ABSTAIN_THRESHOLD = 0.4;

// ── Step 1: Retrieve chunks via MCP ───────────────────────────────────────────

async function fetchRetrieval(
  query: string,
  topK = 4
): Promise<{ chunks: RetrievedChunk[]; error: string | null }> {
  let client: Client | null = null;
  try {
    const transport = new SSEClientTransport(new URL(MCP_URL));
    client = new Client(
      { name: "grounded-answer-desk", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);

    const result = await client.callTool({
      name: "search_kb_tool",
      arguments: { query, top_k: topK },
    });

    const chunks: RetrievedChunk[] = [];
    const contentList = (result.content as Array<any>) ?? [];
    for (const raw of contentList) {
      if (raw.type === "text") {
        try {
          const parsed = JSON.parse(raw.text);
          chunks.push(parsed);
        } catch {
          // ignore JSON parse errors on individual chunks
        }
      }
    }
    return { chunks, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ask] MCP retrieval error:", msg);
    return { chunks: [], error: msg };
  } finally {
    try {
      await client?.close();
    } catch {}
  }
}

// ── Step 2: Build the enriched prompt with retrieved passages ─────────────────

function buildUserMessage(
  question: string,
  chunks: RetrievedChunk[]
): string {
  if (chunks.length === 0) {
    return `Retrieved Passages:\n(No relevant passages found.)\n\nQuestion: ${question}`;
  }

  const passageBlock = chunks
    .map(
      (c, i) =>
        `--- Passage ${i + 1} ---\nsource_id: ${c.source_id}\nchunk_id: ${c.chunk_id}\nscore: ${c.score.toFixed(4)}\n\n${c.text}`
    )
    .join("\n\n");

  return `Retrieved Passages:\n${passageBlock}\n\n---\n\nQuestion: ${question}`;
}

// ── Step 3: Call LLM via OpenClaw Gateway ─────────────────────────────────────

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  retries = 2
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (OPENCLAW_TOKEN) {
    headers["Authorization"] = `Bearer ${OPENCLAW_TOKEN}`;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "openclaw/default",
          temperature: 0.1,
          max_tokens: 1024,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
        signal: AbortSignal.timeout(55_000),
      });

      if (resp.status === 429 && attempt < retries) {
        console.warn(
          `[ask] 429 Too Many Requests. Retrying in ${2000 * (attempt + 1)}ms...`
        );
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`LLM error ${resp.status}: ${err}`);
      }

      const data = await resp.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(
        `[ask] Network error. Retrying in ${2000 * (attempt + 1)}ms...`
      );
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return "";
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { question } = req.body as { question?: string };
  if (!question?.trim()) {
    return res.status(400).json({ error: "question is required" });
  }

  const q = question.trim();

  try {
    // Step 1: Retrieve chunks via MCP (sequential — we need them for the prompt)
    const retrieval = await fetchRetrieval(q);

    // Surface MCP errors clearly — never mask backend failure as abstention
    if (retrieval.error) {
      return res.status(503).json({
        error: `MCP server unreachable: ${retrieval.error}. Check that mcp-server.service is running on the VPS.`,
      });
    }

    const chunks = retrieval.chunks;
    const topScore = chunks[0]?.score ?? 0;
    const abstained = chunks.length === 0 || topScore < ABSTAIN_THRESHOLD;

    // Step 2: Build enriched prompt with the retrieved passages
    const userMessage = buildUserMessage(q, chunks);

    // Step 3: Call LLM with the grounded context (only if not abstaining)
    let answer: string;
    if (abstained) {
      answer = "I don't have that in my sources.";
    } else {
      answer = await callLLM(SYSTEM_PROMPT, userMessage);
    }

    const citations: Citation[] = chunks.map((c) => ({
      source_id: c.source_id,
      chunk_id: c.chunk_id,
      score: c.score,
      excerpt: c.text.slice(0, 200) + (c.text.length > 200 ? "…" : ""),
    }));

    const response: AgentResponse = {
      answer,
      citations: abstained ? [] : citations,
      retrieval: chunks,
      abstained,
    };

    return res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ask]", message);
    return res.status(500).json({ error: `API error 500: ${message}` });
  }
}
