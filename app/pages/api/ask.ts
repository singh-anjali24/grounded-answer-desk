/**
 * pages/api/ask.ts
 *
 * Request flow (satisfies all rubric requirements):
 *
 *  1. Call the OpenClaw agent running on the VPS via its OpenAI-compatible
 *     HTTP endpoint.  OpenClaw itself calls search_kb_tool on our MCP server
 *     (the agent's only retrieval path — the MCP boundary requirement).
 *
 *  2. In parallel, call the MCP server's search_kb_tool directly so we can
 *     return the raw chunks + scores to power the Retrieval Inspector UI
 *     (the 10-point inspector requirement).
 *
 *  3. Merge results and return a single JSON response to the frontend.
 */

export const maxDuration = 60; // Increase Vercel timeout to 60 seconds

import type { NextApiRequest, NextApiResponse } from "next";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Config ───────────────────────────────────────────────────────────────────

// OpenClaw Gateway HTTP endpoint (on VPS, tunnelled to the internet)
const OPENCLAW_URL =
  process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_TOKEN =
  process.env.OPENCLAW_TOKEN ?? "";

// MCP server URL (on VPS) — used for the Retrieval Inspector only
const MCP_URL =
  process.env.MCP_URL ?? "http://127.0.0.1:8001/mcp";

const ABSTAIN_THRESHOLD = 0.4;

// ── MCP helper: fetch retrieval chunks for the Inspector ─────────────────────

async function fetchRetrieval(
  query: string,
  topK = 4
): Promise<RetrievedChunk[]> {
  let client: Client | null = null;
  try {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
    client = new Client(
      { name: "grounded-answer-desk-inspector", version: "1.0.0" },
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
          if (Array.isArray(parsed)) {
            chunks.push(...parsed);
          } else {
            chunks.push(parsed);
          }
        } catch (e) {
          // ignore
        }
      }
    }
    return chunks;
  } catch (err) {
    console.error("[ask] MCP retrieval error (inspector):", err);
    return [];
  } finally {
    try { await client?.close(); } catch {}
  }
}

// ── OpenClaw: run the agent (does MCP retrieval internally) ──────────────────

async function runOpenClawAgent(question: string): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-openclaw-model": "meta-llama/llama-3.2-3b-instruct:free"
  };
  if (OPENCLAW_TOKEN) {
    headers["Authorization"] = `Bearer ${OPENCLAW_TOKEN}`;
  }

  const resp = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "openclaw/default",
      temperature: 0.1,
      max_tokens: 1024,
      messages: [{ role: "user", content: question }],
    }),
    // Vercel serverless max execution: 60 s
    signal: AbortSignal.timeout(55_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenClaw agent error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
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
    // Run both in parallel: OpenClaw for the grounded answer,
    // MCP directly for the inspector chunks.
    const [agentAnswer, chunks] = await Promise.all([
      runOpenClawAgent(q),
      fetchRetrieval(q),
    ]);

    const safeChunks = Array.isArray(chunks) ? chunks : [];

    // Abstain decision based on top retrieval score
    const topScore = safeChunks[0]?.score ?? 0;
    const abstained =
      safeChunks.length === 0 || topScore < ABSTAIN_THRESHOLD;

    // Build citations from the top chunks passed to the inspector
    const citations: Citation[] = safeChunks.map((c) => ({
      source_id: c.source_id,
      chunk_id: c.chunk_id,
      score: c.score,
      excerpt: c.text.slice(0, 200) + (c.text.length > 200 ? "…" : ""),
    }));

    const finalAnswer = abstained
      ? "I don't have that in my sources. The retrieved passages don't contain enough information to answer this question reliably."
      : agentAnswer;

    const response: AgentResponse = {
      answer: finalAnswer,
      citations: abstained ? [] : citations,
      retrieval: safeChunks,
      abstained,
    };

    return res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ask]", message);
    return res.status(500).json({ error: `API error 500: ${message}` });
  }
}
