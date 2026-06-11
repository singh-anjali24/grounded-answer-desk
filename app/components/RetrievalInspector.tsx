import { useState } from "react";

interface Chunk {
  source_id: string;
  chunk_id: string;
  text: string;
  score: number;
}

interface RetrievalInspectorProps {
  chunks: Chunk[];
}

export default function RetrievalInspector({ chunks }: RetrievalInspectorProps) {
  const [open, setOpen] = useState(false);

  if (chunks.length === 0) return null;

  return (
    <div className="inspector">
      <button
        className="inspector-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "▲ Hide" : "▼ Show"} Retrieval Inspector ({chunks.length} chunks)
      </button>

      {open && (
        <div className="inspector-panel" role="region" aria-label="Retrieval inspector">
          {chunks.map((chunk, i) => {
            const scorePercent = Math.max(0, Math.min(100, chunk.score * 100));
            return (
              <div className="inspector-chunk" key={chunk.chunk_id}>
                <div className="inspector-chunk-meta">
                  <span className="inspector-badge">#{i + 1}</span>
                  <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    <strong style={{ color: "var(--text)" }}>{chunk.source_id}</strong>
                    {" · "}
                    {chunk.chunk_id}
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "var(--good)", fontWeight: 600 }}>
                    {chunk.score.toFixed(4)}
                  </span>
                  <div className="inspector-score-bar" title={`Similarity: ${scorePercent.toFixed(1)}%`}>
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
