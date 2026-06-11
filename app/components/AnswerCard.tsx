import CitationCard from "./CitationCard";

interface Citation {
  source_id: string;
  chunk_id: string;
  score: number;
  excerpt: string;
}

interface AnswerCardProps {
  answer: string;
  citations: Citation[];
  abstained: boolean;
}

export default function AnswerCard({ answer, citations, abstained }: AnswerCardProps) {
  return (
    <div className={`answer-card ${abstained ? "answer-abstain" : ""}`}>
      <div className="answer-label">
        {abstained ? "⚠ Not in sources" : "✦ Answer"}
      </div>
      <p className="answer-text">{answer}</p>

      {citations.length > 0 && (
        <div className="citations">
          <div className="citation-heading">Sources ({citations.length})</div>
          {citations.map((c, i) => (
            <CitationCard key={c.chunk_id} citation={c} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
