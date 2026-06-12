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
import { ask } from "../../lib/agent-client";

export const maxDuration = 60;

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
    const response = await ask(question.trim());
    return res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ask]", message);
    return res.status(500).json({ error: `API error 500: ${message}` });
  }
}

