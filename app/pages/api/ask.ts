/**
 * pages/api/ask.ts
 *
 * Grounded Answer Desk — API route
 *
 * Architecture: OpenAI function-calling agent loop
 *
 *  1. Send the user's question + MCP tool definitions to OpenClaw Gateway.
 *  2. The LLM autonomously decides to call search_kb_tool / get_source_tool.
 *  3. We execute the tool calls via the MCP server (the MCP boundary).
 *  4. Feed the tool results back to the LLM.
 *  5. The LLM produces a grounded, cited answer (or abstains).
 *  6. Repeat until the LLM gives a final text answer (max iterations).
 *
 *  The LLM decides what to retrieve — the application code only executes
 *  the tool calls the LLM requests, through the MCP server.
 *
 *  Separately, we also call MCP directly for the Retrieval Inspector panel
 *  (observability — showing raw chunks + scores to the evaluator).
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

// OpenClaw Gateway on VPS
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";

// MCP server on VPS — tools are executed through here (SSE transport)
const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:8001/sse";

const MAX_TOOL_ITERATIONS = 5;

// ── Tool definitions (OpenAI function-calling format) ─────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_kb_tool",
      description:
        "Search the knowledge base for relevant passages. Returns top-k chunks with text, source_id, chunk_id, and similarity scores. MUST be called before answering any question.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant passages",
          },
          top_k: {
            type: "integer",
            description: "Number of results to return (default 4, max 20)",
            default: 4,
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_source_tool",
      description:
        "Retrieve ALL chunks belonging to a source document. Use when you need more context about a specific source.",
      parameters: {
        type: "object",
        properties: {
          source_id: {
            type: "string",
            description: "The source document ID (e.g. 'strapi-002')",
          },
        },
        required: ["source_id"],
      },
    },
  },
];

// ── Execute a tool call via MCP ───────────────────────────────────────────────

async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  let client: Client | null = null;
  try {
    const transport = new SSEClientTransport(new URL(MCP_URL));
    client = new Client(
      { name: "grounded-answer-desk-agent", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    // Collect all text content from the MCP response
    const contentList = (result.content as Array<any>) ?? [];
    const texts: string[] = [];
    for (const raw of contentList) {
      if (raw.type === "text" && raw.text) {
        texts.push(raw.text);
      }
    }

    return texts.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ask] MCP tool ${toolName} error:`, msg);
    return JSON.stringify({ error: msg });
  } finally {
    try {
      await client?.close();
    } catch {}
  }
}

// ── Agent loop: LLM decides tools, we execute via MCP ─────────────────────────

interface AgentLoopResult {
  answer: string;
  tool_calls: AgentToolCall[];
}

async function runAgentLoop(question: string): Promise<AgentLoopResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (OPENCLAW_TOKEN) {
    headers["Authorization"] = `Bearer ${OPENCLAW_TOKEN}`;
  }

  // Build the conversation: system prompt + user question
  const messages: Array<Record<string, any>> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];

  const allToolCalls: AgentToolCall[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    // Call the LLM with tool definitions
    const resp = await fetch(`${OPENCLAW_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "openclaw/default",
        temperature: 0.1,
        max_tokens: 1536,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: iteration === 0 ? "required" : "auto",
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenClaw error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    if (!assistantMsg) {
      throw new Error("No response from LLM");
    }

    // Check if the LLM wants to call tools
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      // Add the assistant message (with tool_calls) to conversation
      messages.push(assistantMsg);

      // Execute each tool call via MCP
      for (const tc of assistantMsg.tool_calls) {
        const fn = tc.function ?? tc;
        const toolName = fn.name ?? "unknown";
        let args: Record<string, unknown> = {};
        try {
          args =
            typeof fn.arguments === "string"
              ? JSON.parse(fn.arguments)
              : fn.arguments ?? {};
        } catch {
          args = {};
        }

        console.log(`[ask] Agent calls ${toolName}(${JSON.stringify(args)})`);

        // Execute the tool via MCP (the MCP boundary)
        const toolResult = await executeMcpTool(toolName, args);

        // Track this tool call for the inspector
        allToolCalls.push({
          tool_name: toolName,
          arguments: args,
          result_preview:
            toolResult.slice(0, 300) +
            (toolResult.length > 300 ? "…" : ""),
        });

        // Add the tool result to the conversation
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      }

      // Continue the loop — send results back to the LLM
      continue;
    }

    // No tool calls — the LLM gave a final text answer
    return {
      answer: assistantMsg.content ?? "",
      tool_calls: allToolCalls,
    };
  }

  // Max iterations reached — return whatever we have
  return {
    answer:
      "I was unable to complete the retrieval in time. Please try again.",
    tool_calls: allToolCalls,
  };
}

// ── Retrieval Inspector: separate MCP call for observability ──────────────────

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
    // Run both paths in parallel:
    //  Path A: Agent loop — LLM calls tools via MCP, produces grounded answer
    //  Path B: Inspector — separate MCP call for raw retrieval data
    const [agentResult, inspectorResult] = await Promise.all([
      runAgentLoop(q),
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
