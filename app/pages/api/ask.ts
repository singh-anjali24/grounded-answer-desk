/**
 * pages/api/ask.ts
 *
 * Grounded Answer Desk — API route
 *
 * Architecture (two independent paths):
 *
 *  Path A — Agent answering (MCP boundary):
 *    1. Send the user's question to the OpenClaw Gateway.
 *    2. The Gateway runs the agent loop: the LLM autonomously calls
 *       search_kb_tool / get_source_tool via MCP to retrieve passages.
 *    3. The LLM formulates a grounded, cited answer (or abstains).
 *    4. We parse the final response for citations.
 *
 *  Path B — Retrieval Inspector (observability):
 *    1. Separately call MCP search_kb_tool directly to get the raw
 *       retrieval results (chunks + scores + sources).
 *    2. This is purely for the inspector panel — making RAG visible,
 *       not a black box. The agent does NOT use this data.
 *
 *  The agent retrieves ONLY through MCP tools. This API route never
 *  injects chunks into the prompt — the agent decides what to retrieve.
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

export interface AgentToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  result_preview: string;
}

export interface AgentResponse {
  answer: string;
  citations: Citation[];
  retrieval: RetrievedChunk[];
  abstained: boolean;
  agent_tool_calls: AgentToolCall[];
}

// ── Config ────────────────────────────────────────────────────────────────────

// OpenClaw Gateway on VPS — runs the agent loop with MCP tool calling
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";

// MCP server on VPS — used directly ONLY for the Retrieval Inspector panel
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:8001/mcp";

// ── Path A: Agent call via OpenClaw Gateway ───────────────────────────────────

interface OpenClawResult {
  answer: string;
  tool_calls: AgentToolCall[];
}

async function callAgent(
  question: string,
  retries = 2
): Promise<OpenClawResult> {
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
          max_tokens: 1536,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: question },
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
        throw new Error(`OpenClaw error ${resp.status}: ${err}`);
      }

      const data = await resp.json();

      // Collect any tool calls the agent made during the loop
      // OpenClaw Gateway returns the full conversation in choices[0].message
      // and may include tool_calls in intermediate messages
      const tool_calls: AgentToolCall[] = [];

      // Parse tool calls from the response if available
      const choices = data.choices ?? [];
      for (const choice of choices) {
        const msg = choice.message;
        if (msg?.tool_calls) {
          for (const tc of msg.tool_calls) {
            const fn = tc.function ?? tc;
            let args: Record<string, unknown> = {};
            try {
              args =
                typeof fn.arguments === "string"
                  ? JSON.parse(fn.arguments)
                  : fn.arguments ?? {};
            } catch {
              // If arguments can't be parsed, leave empty
            }
            tool_calls.push({
              tool_name: fn.name ?? "unknown",
              arguments: args,
              result_preview: "",
            });
          }
        }
      }

      // Extract the final answer text
      const answer = data.choices?.[0]?.message?.content ?? "";

      return { answer, tool_calls };
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(
        `[ask] Network error. Retrying in ${2000 * (attempt + 1)}ms...`
      );
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return { answer: "", tool_calls: [] };
}

// ── Path B: Direct MCP call for Retrieval Inspector ──────────────────────────

async function fetchInspectorData(
  query: string,
  topK = 5
): Promise<{ chunks: RetrievedChunk[]; error: string | null }> {
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
            for (const item of parsed) {
              chunks.push({
                source_id: String(item.source_id ?? ""),
                chunk_id: String(item.chunk_id ?? ""),
                text: String(item.text ?? ""),
                score: Number(item.score ?? 0),
              });
            }
          } else if (typeof parsed === "object" && parsed !== null) {
            chunks.push({
              source_id: String(parsed.source_id ?? ""),
              chunk_id: String(parsed.chunk_id ?? ""),
              text: String(parsed.text ?? ""),
              score: Number(parsed.score ?? 0),
            });
          }
        } catch {
          // ignore JSON parse errors on individual chunks
        }
      }
    }

    // Sort by score descending
    chunks.sort((a, b) => b.score - a.score);

    return { chunks, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ask] Inspector MCP error:", msg);
    return { chunks: [], error: msg };
  } finally {
    try {
      await client?.close();
    } catch {}
  }
}

// ── Parse citations from the LLM's response ─────────────────────────────────

function parseCitations(
  answer: string,
  inspectorChunks: RetrievedChunk[]
): Citation[] {
  // Match [source_id/chunk_id] patterns in the LLM's response
  const citationPattern = /\[([^\]\/]+)\/([^\]]+)\]/g;
  const seen = new Set<string>();
  const citations: Citation[] = [];

  let match;
  while ((match = citationPattern.exec(answer)) !== null) {
    const sourceId = match[1].trim();
    const chunkId = match[2].trim();
    const key = `${sourceId}/${chunkId}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // Try to find the matching chunk in the inspector data for score/excerpt
    const chunk = inspectorChunks.find(
      (c) => c.source_id === sourceId && c.chunk_id === chunkId
    );

    citations.push({
      source_id: sourceId,
      chunk_id: chunkId,
      score: chunk?.score ?? 0,
      excerpt: chunk?.text
        ? chunk.text.slice(0, 200) + (chunk.text.length > 200 ? "…" : "")
        : "",
    });
  }

  return citations;
}

// ── Detect abstention ────────────────────────────────────────────────────────

function isAbstention(answer: string): boolean {
  const lower = answer.toLowerCase();
  return (
    lower.includes("i don't have that in my sources") ||
    lower.includes("i don\u2019t have that in my sources") ||
    lower.includes("not in my sources") ||
    lower.includes("don't have enough information in my sources") ||
    lower.includes("no relevant information in my sources") ||
    lower.includes("cannot answer") ||
    (lower.includes("not") && lower.includes("my sources") && answer.length < 200)
  );
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
    // Run both paths in parallel:
    //  Path A: Agent answers the question (retrieves via MCP autonomously)
    //  Path B: Inspector gets raw retrieval data (for transparency panel)
    const [agentResult, inspectorResult] = await Promise.all([
      callAgent(q),
      fetchInspectorData(q),
    ]);

    const answer = agentResult.answer;
    const abstained = isAbstention(answer);

    // Parse real citations from the LLM's response text
    const citations = abstained
      ? []
      : parseCitations(answer, inspectorResult.chunks);

    const response: AgentResponse = {
      answer,
      citations,
      retrieval: inspectorResult.chunks,
      abstained,
      agent_tool_calls: agentResult.tool_calls,
    };

    return res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ask]", message);
    return res.status(500).json({ error: `API error 500: ${message}` });
  }
}
