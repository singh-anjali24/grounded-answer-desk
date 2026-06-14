import { useState } from "react";

interface Chunk {
  source_id: string;
  chunk_id: string;
  text: string;
  score: number;
}

interface AgentToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  result_preview: string;
}

interface RetrievalInspectorProps {
  chunks: Chunk[];
  agentToolCalls?: AgentToolCall[];
}

export default function RetrievalInspector({
  chunks,
  agentToolCalls,
}: RetrievalInspectorProps) {
  const [open, setOpen] = useState(false);

  if (chunks.length === 0 && (!agentToolCalls || agentToolCalls.length === 0))
    return null;

  return (
    <div className="inspector">
      <button
        className="inspector-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        id="inspector-toggle"
      >
        {open ? "▲ Hide" : "▼ Show"} Retrieval Inspector ({chunks.length}{" "}
        chunks)
      </button>

      {open && (
        <div
          className="inspector-panel"
          role="region"
          aria-label="Retrieval inspector"
        >
          {/* Agent Tool Calls — proves the agent used MCP tools */}
          {agentToolCalls && agentToolCalls.length > 0 && (
            <div className="inspector-agent-calls">
              <div className="inspector-section-title">
                ⚡ Agent MCP Tool Calls
              </div>
              <p className="inspector-note">
                These are the MCP tools the agent autonomously called during its
                reasoning loop — the LLM decided to use these tools, not the
                application code.
              </p>
              {agentToolCalls.map((tc, i) => (
                <div className="inspector-tool-call" key={i}>
                  <span className="inspector-tool-badge">{tc.tool_name}</span>
                  <code className="inspector-tool-args">
                    {JSON.stringify(tc.arguments)}
                  </code>
                </div>
              ))}
            </div>
          )}

          {/* Retrieved Chunks — raw retrieval data */}
          <div className="inspector-section-title" style={{ marginTop: 16 }}>
            📊 Retrieved Chunks (Independent Inspector Query)
          </div>
          <p className="inspector-note">
            Separate MCP call showing raw vector similarity results for
            transparency.
          </p>

          {chunks.map((chunk, i) => {
            const scorePercent = Math.max(
              0,
              Math.min(100, chunk.score * 100)
            );
            return (
              <div className="inspector-chunk" key={chunk.chunk_id}>
                <div className="inspector-chunk-meta">
                  <span className="inspector-badge">#{i + 1}</span>
                  <span
                    style={{ fontSize: "0.78rem", color: "var(--muted)" }}
                  >
                    <strong style={{ color: "var(--text)" }}>
                      {chunk.source_id}
                    </strong>
                    {" · "}
                    {chunk.chunk_id}
                  </span>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--good)",
                      fontWeight: 600,
                    }}
                  >
                    {chunk.score.toFixed(4)}
                  </span>
                  <div
                    className="inspector-score-bar"
                    title={`Similarity: ${scorePercent.toFixed(1)}%`}
                  >
                    <div
                      className="inspector-score-fill"
                      style={{ width: `${scorePercent}%` }}
                    />
                  </div>
                </div>
                <pre className="inspector-chunk-text">{chunk.text}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
