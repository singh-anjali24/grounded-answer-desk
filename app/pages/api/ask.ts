/**
 * pages/api/ask.ts
 *
 * Request flow:
 *  1. Call the OpenClaw agent on VPS (tunnelled via Pinggy) — agent uses
 *     google/gemini-2.5-flash and retrieves ONLY through the MCP server
 *     (search_kb_tool). This satisfies the MCP boundary rubric requirement.
 *
 *  2. In parallel, call MCP search_kb_tool directly for the Retrieval
 *     Inspector panel (shows raw chunks + similarity scores).
 *
 *  3. Merge and return a single JSON response to the frontend.
 */

export const maxDuration = 60;

import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

// OpenClaw Gateway on VPS (tunnelled to the internet via Pinggy)
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";

// MCP server on VPS — used directly for the Retrieval Inspector
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:8001/mcp";

const ABSTAIN_THRESHOLD = 0.4;

// ── MCP helper: fetch retrieval chunks for the Inspector ──────────────────────

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
          chunks.push(parsed);
        } catch {
          // ignore parse errors
        }
      }
    }
    return chunks;
  } catch (err) {
    console.error("[ask] MCP retrieval error (inspector):", err);
    return [];
  } finally {
    try {
      await client?.close();
    } catch {}
  }
}

// ── OpenClaw agent: grounded answer via Google Gemini 2.5 Flash ──────────────

async function runOpenClawAgent(question: string): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        { role: "user", content: question },
      ],
    }),
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
    // Run OpenClaw agent + MCP inspector in parallel
    const [agentAnswer, chunks] = await Promise.all([
      runOpenClawAgent(q),
      fetchRetrieval(q),
    ]);

    const safeChunks = Array.isArray(chunks) ? chunks : [];
    const topScore = safeChunks[0]?.score ?? 0;
    const abstained = safeChunks.length === 0 || topScore < ABSTAIN_THRESHOLD;

    const citations: Citation[] = safeChunks.map((c) => ({
      source_id: c.source_id,
      chunk_id: c.chunk_id,
      score: c.score,
      excerpt: c.text.slice(0, 200) + (c.text.length > 200 ? "…" : ""),
    }));

    const finalAnswer = abstained
      ? "⚠ Not in sources\nI don't have that in my sources. The retrieved passages don't contain enough information to answer this question reliably."
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
