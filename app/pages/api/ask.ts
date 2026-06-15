/**
 * pages/api/ask.ts
 *
 * Grounded Answer Desk — API route
 *
 * Architecture:
 *
 *  Path A — Agent answering (OpenClaw handles the MCP agent loop):
 *    1. Send question + grounding system prompt to OpenClaw Gateway.
 *    2. OpenClaw internally runs the agent loop: Gemini autonomously
 *       calls search_kb_tool / get_source_tool via MCP.
 *    3. The final grounded answer (with citations) is returned.
 *    4. We parse the response for citations.
 *
 *  Path B — Retrieval Inspector (observability):
 *    1. Separately call MCP search_kb_tool directly for raw retrieval
 *       data (chunks + scores). This is for the inspector panel only.
 *
 *  OpenClaw manages the MCP tool-calling loop internally — the LLM
 *  decides when to call search_kb_tool and get_source_tool. This API
 *  route never injects chunks into the prompt.
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

// OpenClaw Gateway on VPS — runs the agent loop with MCP tool calling internally
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";

// MCP server on VPS — used directly ONLY for the Retrieval Inspector panel
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:8001/sse";

// ── Fallback LLM config (used when OpenClaw gateway is unreachable) ──────────
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const LLM_BASE_URL =
  process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1";
const LLM_MODEL =
  process.env.LLM_MODEL ?? "meta-llama/llama-3-8b-instruct:free";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";

// ── Path A: Agent call via OpenClaw Gateway ───────────────────────────────────
//
// OpenClaw internally manages the agent loop:
//   1. Gemini reads our system prompt + the user question
//   2. Gemini decides to call search_kb_tool via MCP
//   3. OpenClaw executes the tool call through the registered MCP server
//   4. Gemini receives the results and may call get_source_tool
//   5. Gemini formulates a grounded answer with [source_id/chunk_id] citations
//   6. OpenClaw returns the final answer via /v1/chat/completions
//
// We never see the intermediate tool calls — they happen inside OpenClaw.

async function callAgent(
  question: string,
  retries = 1
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
          max_tokens: 1536,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: question },
          ],
        }),
        signal: AbortSignal.timeout(25_000),
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

// ── Fallback: Direct LLM call with pre-fetched MCP chunks ────────────────────
// Used when OpenClaw gateway is unreachable. Calls the LLM API directly with
// chunks already retrieved via MCP, bypassing the agent tool-calling loop.

const FALLBACK_SYSTEM_PROMPT =
  SYSTEM_PROMPT +
  "\n\nIMPORTANT: The knowledge base search has already been performed for you. " +
  "The retrieved passages are provided below the user's question. " +
  "You do NOT need to call any tools — answer ONLY from the provided passages, " +
  "following all citation rules in your instructions above.";

function buildFallbackUserMessage(
  question: string,
  chunks: RetrievedChunk[]
): string {
  const passages = chunks
    .map(
      (c, i) =>
        `[Passage ${i + 1}] (source_id: ${c.source_id}, chunk_id: ${c.chunk_id}, score: ${c.score.toFixed(3)})\n${c.text}`
    )
    .join("\n\n");

  return `${question}\n\n--- Retrieved Passages ---\n${passages}\n--- End of Passages ---`;
}

async function callGoogleAI(userMessage: string): Promise<string> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: FALLBACK_SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.1, maxOutputTokens: 1536 },
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google AI error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callOpenAICompatible(userMessage: string): Promise<string> {
  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.1,
      max_tokens: 1536,
      messages: [
        { role: "system", content: FALLBACK_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callLLMDirect(
  question: string,
  chunks: RetrievedChunk[]
): Promise<string> {
  const userMessage = buildFallbackUserMessage(question, chunks);

  // Prefer Google AI Studio if API key is available
  if (GOOGLE_API_KEY) {
    console.log("[ask] Fallback: using Google AI Studio");
    return callGoogleAI(userMessage);
  }

  // Fall back to OpenRouter / any OpenAI-compatible API
  if (LLM_API_KEY) {
    console.log("[ask] Fallback: using OpenAI-compatible API");
    return callOpenAICompatible(userMessage);
  }

  throw new Error(
    "No LLM API key configured for fallback. Set GOOGLE_API_KEY or LLM_API_KEY."
  );
}

// ── Path B: Direct MCP call for Retrieval Inspector ──────────────────────────

async function fetchInspectorData(
  query: string,
  topK = 5
): Promise<{ chunks: RetrievedChunk[]; error: string | null }> {
  let client: Client | null = null;
  try {
    const transport = new SSEClientTransport(new URL(MCP_URL));
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
          // ignore
        }
      }
    }

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
    (lower.includes("not") &&
      lower.includes("my sources") &&
      answer.length < 200)
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
    // Run both paths in parallel — allSettled ensures OpenClaw failure
    // doesn't prevent inspector data from being collected
    const [agentSettled, inspectorSettled] = await Promise.allSettled([
      callAgent(q),
      fetchInspectorData(q),
    ]);

    const inspectorResult =
      inspectorSettled.status === "fulfilled"
        ? inspectorSettled.value
        : { chunks: [] as RetrievedChunk[], error: "Inspector MCP failed" };

    let answer: string;
    let usedFallback = false;

    if (agentSettled.status === "fulfilled") {
      answer = agentSettled.value;
    } else {
      // OpenClaw is down — try direct MCP retrieval + LLM fallback
      const reason =
        agentSettled.reason instanceof Error
          ? agentSettled.reason.message
          : String(agentSettled.reason);
      console.warn(
        "[ask] OpenClaw failed, attempting direct LLM fallback:",
        reason
      );

      if (inspectorResult.chunks.length === 0) {
        // Both OpenClaw and MCP failed — surface the original error
        throw agentSettled.reason;
      }

      usedFallback = true;
      answer = await callLLMDirect(q, inspectorResult.chunks);
    }

    const abstained = isAbstention(answer);

    const citations = abstained
      ? []
      : parseCitations(answer, inspectorResult.chunks);

    const agent_tool_calls: AgentToolCall[] = [
      {
        tool_name: "search_kb_tool",
        arguments: { query: q },
        result_preview: usedFallback
          ? "OpenClaw unavailable — used direct MCP retrieval + LLM fallback"
          : "Executed internally by OpenClaw agent via MCP",
      },
    ];

    const response: AgentResponse = {
      answer,
      citations,
      retrieval: inspectorResult.chunks,
      abstained,
      agent_tool_calls,
    };

    return res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ask]", message);
    return res.status(500).json({ error: `API error 500: ${message}` });
  }
}
