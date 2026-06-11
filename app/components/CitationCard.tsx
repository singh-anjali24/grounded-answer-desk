interface Citation {
  source_id: string;
  chunk_id: string;
  score: number;
  excerpt: string;
}

interface CitationCardProps {
  citation: Citation;
  index: number;
}

export default function CitationCard({ citation, index }: CitationCardProps) {
  const scorePercent = Math.round(citation.score * 100);
  const scoreColor =
    citation.score >= 0.7 ? "var(--good)" :
    citation.score >= 0.5 ? "var(--accent)" :
    "var(--warn)";

  return (
    <div className="citation-card">
      <div className="citation-meta">
        <span style={{ fontWeight: 700, color: "var(--text)" }}>
          [{index + 1}]
        </span>
        <span>
          <strong>source:</strong> {citation.source_id}
        </span>
        <span>
          <strong>chunk:</strong> {citation.chunk_id}
        </span>
        <span className="citation-score" style={{ color: scoreColor }}>
          score: {citation.score.toFixed(3)} ({scorePercent}%)
        </span>
      </div>
      <p className="citation-excerpt">&ldquo;{citation.excerpt}&rdquo;</p>
    </div>
  );
}
