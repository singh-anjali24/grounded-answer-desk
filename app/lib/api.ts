const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface AgentToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  result_preview: string;
}

export interface AskResponse {
  answer: string;
  citations: Array<{
    source_id: string;
    chunk_id: string;
    score: number;
    excerpt: string;
  }>;
  retrieval: Array<{
    source_id: string;
    chunk_id: string;
    text: string;
    score: number;
  }>;
  abstained: boolean;
  agent_tool_calls: AgentToolCall[];
}

export async function askQuestion(question: string): Promise<AskResponse> {
  const res = await fetch(`${API_URL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<AskResponse>;
}
