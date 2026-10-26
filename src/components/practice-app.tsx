"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { careerExamples } from "@/lib/career-examples";
import type { VisualCue } from "@/lib/cue-schema";

const suggestedQuestions = [
  "Tell me about a time you improved an onboarding experience.",
  "How do you turn research into a product decision?",
  "Describe a complex workflow you made easier to understand.",
];

const openerDots = Array.from({ length: 14 * 36 }, (_, index) => {
  const row = Math.floor(index / 36);
  const column = index % 36;
  const x = 24 + column * 40;
  const y = 42 + row * 34;
  const centerDistance = Math.abs(column - 17.5) / 17.5;
  const radius = 0.7 + centerDistance * 1.5 + (row % 2) * 0.08;
  return <circle key={`${row}-${column}`} cx={x} cy={y} r={radius} style={{ animationDelay: `${((row * 7 + column * 3) % 24) * 55}ms` }} />;
});

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span aria-hidden="true" className={`brand-mark${small ? " brand-mark-small" : ""}`}>
      <svg viewBox="0 0 36 36" fill="none">
        <path d="M4 6h8l6 10 6-10h8L18 30 4 6Z" fill="currentColor" />
        <path d="M18 18 25 30h8L22 11l-4 7Z" fill="#252525" />
      </svg>
    </span>
  );
}

function OpeningSequence({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onFinish();
      return;
    }
    const timer = window.setTimeout(onFinish, 1650);
    return () => window.clearTimeout(timer);
  }, [onFinish]);

  return (
    <div className="opening-sequence" aria-label="VantSide practice room loading">
      <span className="sr-only" role="status">Starting VantSide practice room</span>
      <svg className="opening-ribbon" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <clipPath id="ribbon-shape">
            <path d="M0 62 C310 62 420 189 720 189 C1020 189 1130 62 1440 62 L1440 458 C1130 458 1020 331 720 331 C420 331 310 458 0 458Z" />
          </clipPath>
        </defs>
        <path className="ribbon-fill" d="M0 62 C310 62 420 189 720 189 C1020 189 1130 62 1440 62 L1440 458 C1130 458 1020 331 720 331 C420 331 310 458 0 458Z" />
        <g clipPath="url(#ribbon-shape)" className="ribbon-dots">{openerDots}</g>
      </svg>
      <div className="opening-brand">
        <BrandMark />
        <span className="opening-wordmark">VantSide</span>
        <span className="opening-caption">Practice room</span>
      </div>
      <button className="opening-skip" onClick={onFinish}>Skip intro</button>
    </div>
  );
}

export function PracticeApp() {
  const [introVisible, setIntroVisible] = useState(true);
  const [question, setQuestion] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("");
  const [cue, setCue] = useState<VisualCue | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const closeIntro = useCallback(() => setIntroVisible(false), []);

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || isLoading) return;

    setActiveQuestion(nextQuestion);
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/cue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion }),
      });
      const result: { cue?: VisualCue; error?: string } = await response.json();
      if (!response.ok || !result.cue) throw new Error(result.error ?? "Could not find a cue. Try again.");
      setCue(result.cue);
      setQuestion("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reach Meta. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const activeExample = cue?.projectId
    ? careerExamples.find((example) => example.projectId === cue.projectId)
    : undefined;

  return (
    <main className="app-shell">
      {introVisible && <OpeningSequence onFinish={closeIntro} />}

      <div className="page-wrap">
        <header className="topbar">
          <a className="brand-lockup" href="#top" aria-label="VantSide practice room home">
            <BrandMark small />
            <span>VantSide</span>
            <span className="brand-divider" />
            <span className="brand-subtitle">Meta practice</span>
          </a>
          <div className="session-pill"><span className="session-dot" /> MOCK INTERVIEW</div>
        </header>

        <section className="intro-copy" id="top">
          <p className="eyebrow">YOUR PRACTICE ROOM</p>
          <h1>Stay in the conversation.<br /><em>Find your next example.</em></h1>
          <p className="intro-description">Try an interview question. VantSide will surface a concise cue from a small set of synthetic career examples.</p>
        </section>

        <section className="workbench" aria-label="Practice interview demo">
          <div className="question-panel">
            <div className="panel-heading">
              <div><span className="step-number">01</span><span className="eyebrow">SIMULATED INTERVIEWER</span></div>
              <span className="demo-label">TEXT DEMO</span>
            </div>
            <h2>What would you like to practice?</h2>
            <form onSubmit={submitQuestion}>
              <label className="sr-only" htmlFor="practice-question">Type a simulated interviewer question</label>
              <textarea
                id="practice-question"
                value={question}
                maxLength={500}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="e.g. Tell me about a time you changed a product direction…"
                rows={3}
                required
              />
              <div className="form-footer">
                <span>{question.length}/500</span>
                <button className="primary-button" type="submit" disabled={isLoading || question.trim().length < 4}>
                  {isLoading ? "Finding a cue" : "Find a cue"}
                  {!isLoading && <span aria-hidden="true">↗</span>}
                </button>
              </div>
            </form>
            <div className="suggestions">
              <span className="suggestion-label">TRY ONE</span>
              {suggestedQuestions.map((suggestion) => (
                <button key={suggestion} onClick={() => setQuestion(suggestion)} type="button">{suggestion}</button>
              ))}
            </div>
            <p className="privacy-note"><span aria-hidden="true">◌</span> Synthetic examples only. Don’t enter personal or confidential information.</p>
          </div>

          <aside className="cue-panel" aria-live="polite" aria-busy={isLoading}>
            <div className="cue-panel-top">
              <div><span className="eyebrow">LIVE VISUAL CUE</span><span className="cue-state-dot" /></div>
              <span className="cue-status">{isLoading ? "FINDING A MATCH" : cue ? "READY" : "WAITING"}</span>
            </div>

            {activeQuestion && <p className="current-question">“{activeQuestion}”</p>}

            {isLoading ? (
              <div className="cue-loading" role="status"><span className="loading-orbit" /><span>Looking for a relevant example…</span></div>
            ) : error ? (
              <div className="cue-error" role="alert"><span className="error-mark">!</span><p>{error}</p><button type="button" onClick={() => setQuestion(activeQuestion)}>Try again</button></div>
            ) : cue ? (
              <div key={`${cue.projectId}-${cue.headline}-${activeQuestion}`} className="cue-content cue-enter">
                <p className="cue-project">{activeExample?.title ?? "NO MATCH FOUND"}</p>
                <h2>{cue.headline}</h2>
                {cue.match === "verified" ? (
                  <ul className="cue-phrases">{cue.cuePhrases.map((phrase) => <li key={phrase}>{phrase}</li>)}</ul>
                ) : <p className="no-match-copy">Try a different question to find a relevant example.</p>}
                {activeExample && cue.sourceFactIds.length > 0 && (
                  <details className="evidence-details">
                    <summary>View synthetic source notes <span>{cue.sourceFactIds.length}</span></summary>
                    <ul>{activeExample.facts.filter((fact) => cue.sourceFactIds.includes(fact.id)).map((fact) => <li key={fact.id}>{fact.text}</li>)}</ul>
                  </details>
                )}
                <div className="cue-card-footer"><span className="verified-dot" />{cue.match === "verified" ? "Grounded in synthetic examples" : "No verified memory match"}</div>
              </div>
            ) : (
              <div className="cue-empty">
                <div className="empty-orbit" aria-hidden="true"><span /><span /><span /></div>
                <h2>Your cue will appear here.</h2>
                <p>Each suggestion is grounded in a source note. No invented outcomes or metrics.</p>
              </div>
            )}
          </aside>
        </section>

        <section className="memory-strip" aria-label="Synthetic demo memory">
          <div className="memory-heading"><span className="eyebrow">DEMO MEMORY</span><span>SYNTHETIC EXAMPLES</span></div>
          <div className="memory-list">
            {careerExamples.map((example, index) => (
              <div className="memory-item" key={example.projectId}>
                <span className="memory-index">0{index + 1}</span>
                <div><h3>{example.title}</h3><p>{example.facts.length} source notes · fictional demo material</p></div>
                <span className="memory-arrow" aria-hidden="true">↗</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="page-footer"><span>VantSide Meta</span><span>Practice only · No audio is captured in this demo</span></footer>
      </div>
    </main>
  );
}
