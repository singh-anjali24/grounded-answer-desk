import type { NextApiRequest, NextApiResponse } from "next";

// We call the MCP server directly from this API route rather than going
// through the full agent-client.ts (which needs an LLM) — this lets the
// app work even when only the MCP/Qdrant layer is running.
//
// For production: swap the body of this route to call `ask()` from
// ../../agent/agent-client.ts once an LLM is configured.


import { ask } from "../../lib/agent-client";

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

  try {
    const result = await ask(question.trim());
    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ask]", message);
    return res.status(500).json({ error: message });
  }
}
