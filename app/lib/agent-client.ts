/**
 * agent-client.ts
 *
 * A thin TypeScript client that:
 *  1. Accepts a user question
 *  2. Calls the MCP search_kb_tool via the MCP SSE endpoint
 *  3. Feeds retrieved chunks + the question to an LLM (OpenAI-compatible)
 *  4. Returns a grounded answer with citations and the raw retrieval data
 *
 * This is used by the Next.js API route (app/pages/api/ask.ts).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:8000/sse";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "llama3.2";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "ollama";
const ABSTAIN_THRESHOLD = 0.40;



async function createMcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client(
    { name: "grounded-answer-desk-frontend", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

// ── Vector search via MCP ───────────────────────────────────────────────────

async function searchKb(
  client: Client,
  query: string,
  topK = 4
): Promise<RetrievedChunk[]> {
  const result = await client.callTool({
    name: "search_kb_tool",
    arguments: { query, top_k: topK },
  });

  // FastMCP returns tool results wrapped in content array
  const raw = result.content?.[0];
  if (raw?.type === "text") {
    return JSON.parse(raw.text) as RetrievedChunk[];
  }
  return [];
}

// ── LLM call (OpenAI-compatible) ────────────────────────────────────────────

async function callLlm(systemPrompt: string, userMsg: string): Promise<string> {
  const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── System prompt ───────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  resolve(__dirname, "prompts/system.txt"),
  "utf-8"
);

// ── Main ask function ───────────────────────────────────────────────────────

export async function ask(question: string): Promise<AgentResponse> {
  const client = await createMcpClient();

  let chunks: RetrievedChunk[] = [];
  try {
    chunks = await searchKb(client, question);
  } finally {
    await client.close();
  }

  // Abstain if retrieval is too weak
  const topScore = chunks[0]?.score ?? 0;
  if (topScore < ABSTAIN_THRESHOLD || chunks.length === 0) {
    return {
      answer:
        "I don't have that in my sources. The retrieved passages don't contain enough information to answer this question reliably.",
      citations: [],
      retrieval: chunks,
      abstained: true,
    };
  }

  // Build a context block from the top chunks
  const contextBlock = chunks
    .map(
      (c, i) =>
        `[${i + 1}] chunk_id=${c.chunk_id} source_id=${c.source_id} score=${c.score.toFixed(3)}\n${c.text}`
    )
    .join("\n\n---\n\n");

  const userMessage = `Retrieved passages:\n\n${contextBlock}\n\n---\n\nQuestion: ${question}`;

  const rawAnswer = await callLlm(SYSTEM_PROMPT, userMessage);

  // Build citations from chunks that were passed to the LLM
  const citations: Citation[] = chunks.map((c) => ({
    source_id: c.source_id,
    chunk_id: c.chunk_id,
    score: c.score,
    excerpt: c.text.slice(0, 200) + (c.text.length > 200 ? "…" : ""),
  }));

  return {
    answer: rawAnswer,
    citations,
    retrieval: chunks,
    abstained: false,
  };
}
