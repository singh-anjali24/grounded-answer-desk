interface AskBoxProps {
  onAsk: (question: string) => void;
  loading: boolean;
}

export default function AskBox({ onAsk, loading }: AskBoxProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("question") as HTMLInputElement;
    const q = input.value.trim();
    if (q) onAsk(q);
  };

  return (
    <form className="ask-form" onSubmit={handleSubmit}>
      <input
        id="question"
        name="question"
        className="ask-input"
        type="text"
        placeholder="Ask a question about your knowledge base…"
        disabled={loading}
        autoComplete="off"
        autoFocus
      />
      <button className="ask-btn" type="submit" disabled={loading}>
        {loading ? <><span className="spinner" />Thinking…</> : "Ask"}
      </button>
    </form>
  );
}
