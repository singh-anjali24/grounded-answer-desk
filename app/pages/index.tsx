import { useState } from "react";
import Head from "next/head";
import AskBox from "../components/AskBox";
import AnswerCard from "../components/AnswerCard";
import RetrievalInspector from "../components/RetrievalInspector";
import { askQuestion, AskResponse } from "../lib/api";


export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");

  const handleAsk = async (question: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setLastQuestion(question);
    try {
      const res = await askQuestion(question);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Grounded Answer Desk</title>
        <meta
          name="description"
          content="RAG-powered Q&A — answers grounded in your knowledge base with citations and retrieval transparency."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </Head>

      <header className="header">
        <div className="container header-inner">
          <div>
            <div className="header-logo">⬡ Grounded Answer Desk</div>
            <div className="header-sub">
              RAG · MCP · Strapi docs corpus · answers with citations
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          <AskBox onAsk={handleAsk} loading={loading} />

          {error && (
            <div
              style={{
                background: "rgba(248,81,73,.12)",
                border: "1px solid var(--bad)",
                borderRadius: "var(--radius)",
                padding: "14px 18px",
                color: "var(--bad)",
                marginBottom: "24px",
              }}
            >
              <strong>Error:</strong> {error}
            </div>
          )}

          {lastQuestion && !loading && result && (
            <p
              style={{
                fontSize: "0.82rem",
                color: "var(--muted)",
                marginBottom: "14px",
              }}
            >
              Question: <em>&ldquo;{lastQuestion}&rdquo;</em>
            </p>
          )}

          {result && (
            <>
              <AnswerCard
                answer={result.answer}
                citations={result.citations}
                abstained={result.abstained}
              />
              <RetrievalInspector chunks={result.retrieval} />
            </>
          )}
        </div>
      </main>
    </>
  );
}
