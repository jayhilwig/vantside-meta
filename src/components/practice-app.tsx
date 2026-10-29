"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { careerExamples } from "@/lib/career-examples";
import type { VisualCue } from "@/lib/cue-schema";
import type { OpportunityRequirement } from "@/lib/opportunity-analysis";
import type { MemoryProject } from "@/lib/session-schema";

const suggestedQuestions = [
  "Tell me about a time you improved an onboarding experience.",
  "How do you turn research into a product decision?",
  "Describe a complex workflow you made easier to understand.",
];

const cueApiBaseUrl = process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787";

const ribbonPath = "M0 100 Q1024 220 2048 100 L2048 380 Q1024 260 0 380Z";
const openerDots = Array.from({ length: 19 }, (_, column) => {
  const distance = 120 + column * 49;
  const progress = distance / 1002;
  const radius = 1.25 + 8.75 * progress * progress;
  const rowOffset = 18 + 106 * progress * progress;

  return [-1, 1].flatMap((side) =>
    [-1, 0, 1].map((row) => {
      const y = 240 + row * rowOffset;
      return (
        <circle key={`${side}-${column}-${row}`} cx={1024 + side * distance} cy={y} r={radius}>
          {row !== 0 && (
            <animate attributeName="cy" from={240 + row * rowOffset * 0.55} to={y}
              begin="0.16s" dur="1.42s" fill="freeze" calcMode="spline"
              keyTimes="0;1" keySplines="0.33 0 0.2 1" />
          )}
        </circle>
      );
    }),
  );
}).flat();

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span aria-hidden="true" className={`brand-mark${small ? " brand-mark-small" : ""}`}>
      <svg viewBox="0 0 72 38" fill="none">
        <path d="m33.55 2.44-11.97 33.28h-7.61L1.87 2.44h7.75l8.25 24.77 8.19-24.77zM70 2v6H35V2zm-17 14v6H35v-6zm-9 14v6h-9v-6z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function OpeningSequence({ onFinish, ready = true }: { onFinish: () => void; ready?: boolean }) {
  const [minimumElapsed, setMinimumElapsed] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onFinish();
      return;
    }
    const timer = window.setTimeout(() => setMinimumElapsed(true), 2050);
    return () => window.clearTimeout(timer);
  }, [onFinish]);

  return (
    <div className={`opening-sequence${minimumElapsed && ready ? " is-exiting" : ""}`}
      aria-label="VantSide practice room loading"
      onAnimationEnd={(event) => { if (event.target === event.currentTarget) onFinish(); }}>
      <span className="sr-only" role="status">Starting VantSide practice room</span>
      <svg className="opening-ribbon" viewBox="0 0 2048 480" aria-hidden="true">
        <defs>
          <clipPath id="ribbon-shape">
            <path d={ribbonPath} />
          </clipPath>
          <clipPath id="dot-reveal">
            <rect x="1024" y="0" width="0" height="480">
              <animate attributeName="x" from="1024" to="0" begin="0.16s" dur="1.42s"
                fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.33 0 0.2 1" />
              <animate attributeName="width" from="0" to="2048" begin="0.16s" dur="1.42s"
                fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.33 0 0.2 1" />
            </rect>
          </clipPath>
        </defs>
        <path className="ribbon-fill" d={ribbonPath} />
        <g clipPath="url(#ribbon-shape)">
          <g clipPath="url(#dot-reveal)" className="ribbon-dots">{openerDots}</g>
        </g>
      </svg>
      <div className="opening-brand">
        <div className="opening-brand-line">
          <svg className="opening-vf" viewBox="0 0 72 38" aria-hidden="true">
            <path d="m33.55 2.44-11.97 33.28h-7.61L1.87 2.44h7.75l8.25 24.77 8.19-24.77zM70 2v6H35V2zm-17 14v6H35v-6zm-9 14v6h-9v-6z" fill="currentColor" />
          </svg>
          <span className="opening-wordmark">VantSide</span>
        </div>
        <span className="opening-caption">Starting...</span>
      </div>
      <button className="opening-skip" onClick={onFinish}>Skip intro</button>
    </div>
  );
}

export function PracticeApp({ projects, opportunity, onBack }: { projects?: MemoryProject[]; opportunity?: { company: string; role: string; requirements?: OpportunityRequirement[]; preparationQuestions?: string[] }; onBack?: () => void }) {
  const [introVisible, setIntroVisible] = useState(!onBack);
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
      const response = await fetch(`${cueApiBaseUrl.replace(/\/$/, "")}/cue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projects && opportunity ? { question: nextQuestion, projects, opportunity } : { question: nextQuestion }),
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
    ? (projects ?? careerExamples).find((example) => example.projectId === cue.projectId)
    : undefined;

  return (
    <main className="app-shell">
      {introVisible && <OpeningSequence onFinish={closeIntro} />}

      <div className="page-wrap">
        <header className="topbar">
          {onBack && <button className="text-button" type="button" onClick={onBack}>← Four steps</button>}
          <a className="brand-lockup" href="#top" aria-label="VantSide practice room home">
            <BrandMark small />
            <span>VantSide</span>
            <span className="brand-divider" />
            <span className="brand-subtitle">Practice</span>
          </a>
          <div className="session-pill"><span className="session-dot" /> {projects ? "PERSONALIZED PRACTICE" : "SYNTHETIC TEST MODE"}</div>
        </header>

        <section className="intro-copy" id="top">
          <p className="eyebrow">YOUR PRACTICE ROOM</p>
          <h1>Stay in the conversation.<br /><em>Find your next example.</em></h1>
          <p className="intro-description">{projects ? `${opportunity?.role} · ${opportunity?.company}` : "Synthetic test mode"}</p>
        </section>

        <section className="workbench" aria-label="Practice interview demo">
          <div className="question-panel">
            <div className="panel-heading">
              <div><span className="step-number">01</span><span className="eyebrow">SIMULATED INTERVIEWER</span></div>
              <span className="demo-label">PRACTICE</span>
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
            <p className="privacy-note"><span aria-hidden="true">◌</span> {projects ? "Text practice only. No microphone is active. Session data is not saved across restarts." : "Synthetic examples only. Don’t enter personal or confidential information."}</p>
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
                    <summary>View {projects ? "approved" : "synthetic"} source notes <span>{cue.sourceFactIds.length}</span></summary>
                    <ul>{activeExample.facts.filter((fact) => cue.sourceFactIds.includes(fact.id)).map((fact) => <li key={fact.id}>{fact.text}</li>)}</ul>
                  </details>
                )}
                <div className="cue-card-footer"><span className="verified-dot" />{cue.match === "verified" ? `Grounded in ${projects ? "approved memory" : "synthetic examples"}` : "No verified memory match"}</div>
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

        <section className="memory-strip" aria-label={projects ? "Approved career memory" : "Synthetic demo memory"}>
          <div className="memory-heading"><span className="eyebrow">{projects ? "APPROVED MEMORY" : "DEMO MEMORY"}</span><span>{projects ? "SESSION ONLY" : "SYNTHETIC EXAMPLES"}</span></div>
          <div className="memory-list">
            {(projects ?? careerExamples).map((example, index) => (
              <div className="memory-item" key={example.projectId}>
                <span className="memory-index">0{index + 1}</span>
                <div><h3>{example.title}</h3><p>{example.facts.length} source notes · {projects ? "user approved" : "fictional demo material"}</p></div>
                <span className="memory-arrow" aria-hidden="true">↗</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="page-footer"><span>VantSide Meta</span><span>Practice only · No audio is captured</span></footer>
      </div>
    </main>
  );
}
