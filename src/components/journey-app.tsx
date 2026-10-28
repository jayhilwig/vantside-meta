"use client";

import { ChangeEvent, useCallback, useState } from "react";
import { BrandMark, OpeningSequence, PracticeApp } from "./practice-app";
import type { MemoryProject, Opportunity } from "@/lib/session-schema";

type Step = 1 | 2 | 3 | 4;
type ResumeProposal = { projects: MemoryProject[] };
const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

async function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the PDF."));
    reader.readAsDataURL(file);
  });
}

async function post<T>(route: string, body: object): Promise<T> {
  const response = await fetch(`${api}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Please try again.");
  return result as T;
}

const slug = () => `interview-${Date.now().toString(36)}`;

export function JourneyApp() {
  const [intro, setIntro] = useState(true);
  const closeIntro = useCallback(() => setIntro(false), []);
  const [step, setStep] = useState<Step>(1);
  const [practice, setPractice] = useState<"personal" | "synthetic" | null>(null);
  const [resumeName, setResumeName] = useState("");
  const [proposal, setProposal] = useState<ResumeProposal | null>(null);
  const [approved, setApproved] = useState<MemoryProject[]>([]);
  const [resumeApproved, setResumeApproved] = useState(false);
  const [opportunityInput, setOpportunityInput] = useState("");
  const [opportunityDraft, setOpportunityDraft] = useState<Opportunity | null>(null);
  const [confirmedOpportunity, setConfirmedOpportunity] = useState<Opportunity | null>(null);
  const [answer, setAnswer] = useState("");
  const [conversation, setConversation] = useState<string[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectFact, setProjectFact] = useState("");
  const [talkSaved, setTalkSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasMemory = approved.some((project) => project.title.trim() && project.facts.some((fact) => fact.text.trim() && fact.source.trim()));
  const canPractice = hasMemory && !!confirmedOpportunity;
  const prompt = conversation.length === 0
    ? `Tell me about ${approved[0]?.title ?? "a project you are proud of"}. What was your role?`
    : conversation.length === 1
      ? "What decision did you make, and what evidence guided it?"
      : "What changed as a result? Only include outcomes you can support.";

  async function run(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }

  function selectPdf(event: ChangeEvent<HTMLInputElement>, kind: "resume" | "opportunity") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 4_000_000) { setError("Choose a PDF under 4 MB."); return; }
    void run(async () => {
      const data = await fileData(file);
      if (kind === "resume") {
        const result = await post<{ proposal: ResumeProposal }>("/extract-resume", { filename: file.name, data });
        setResumeName(file.name); setProposal(result.proposal); setResumeApproved(false);
      } else {
        const result = await post<{ opportunity: Opportunity }>("/extract-opportunity", { filename: file.name, data });
        setOpportunityDraft(result.opportunity); setConfirmedOpportunity(null);
      }
    });
  }

  function updateFact(projectIndex: number, factIndex: number, text: string) {
    setResumeApproved(false);
    setProposal((old) => old && { projects: old.projects.map((project, pi) => pi === projectIndex
      ? { ...project, facts: project.facts.map((fact, fi) => fi === factIndex ? { ...fact, text } : fact) } : project) });
  }

  function approveResume() {
    const projects = proposal?.projects.map((project) => ({ ...project,
      facts: project.facts.filter((fact) => fact.text.trim().length >= 4 && fact.source.trim().length >= 3) }))
      .filter((project) => project.facts.length && project.title.trim().length >= 2) ?? [];
    if (!projects.length) { setError("Keep at least one source-backed fact to approve."); return; }
    setApproved((old) => [...old.filter((project) => project.projectId.startsWith("interview-")), ...projects]);
    setResumeApproved(true); setError(""); setStep(2);
  }

  function addInterviewMemory() {
    if (!projectTitle.trim() || !projectFact.trim() || !conversation.length) { setError("Share an example in the conversation, then name and approve it."); return; }
    const supported = conversation.some((turn) => turn.toLowerCase().includes(projectFact.trim().toLowerCase()));
    if (!supported) { setError("Use a short phrase from one of your responses as the supported fact."); return; }
    const id = slug();
    setApproved((old) => [...old, { projectId: id, title: projectTitle.trim(), facts: [{ id: `${id}-fact`, text: projectFact.trim(), source: projectFact.trim() }] }]);
    setProjectTitle(""); setProjectFact(""); setError("");
  }

  if (practice) return <PracticeApp projects={practice === "personal" ? approved : undefined}
    opportunity={practice === "personal" && confirmedOpportunity ? confirmedOpportunity : undefined}
    onBack={() => setPractice(null)} />;

  return <main className="app-shell">
    {intro && <OpeningSequence onFinish={closeIntro} />}
    <div className="page-wrap">
      <header className="topbar"><div className="brand-lockup"><BrandMark small /><span>VantSide</span><span className="brand-divider"/><span className="brand-subtitle">Meta practice</span></div><span className="session-pill">PRACTICE ONLY</span></header>
      <section className="journey-heading"><p className="eyebrow">YOUR PRACTICE ROOM</p><h1>Your story, ready when you are.</h1><p>Four steps. Your experience stays yours.</p></section>
      <nav className="steps-grid" aria-label="Four steps">
        {([1, 2, 3, 4] as Step[]).map((number) => {
          const title = ["Your Resume", "Let's Talk", "The Opportunity", "Practice"][number - 1];
          const locked = number === 2 ? !resumeApproved && !hasMemory : number === 3 ? !hasMemory : number === 4 ? !canPractice : false;
          const complete = number === 1 ? resumeApproved : number === 2 ? talkSaved && hasMemory : number === 3 ? !!confirmedOpportunity : false;
          const status = complete ? "Complete" : locked ? number === 2 ? "Approve your resume first" : number === 3 ? "Build Career Memory first" : "Add memory and opportunity first" : number === 1 && proposal ? "Review needed" : number === 4 ? "Ready" : "Available";
          return <button key={number} type="button" className={`step-card${step === number ? " active" : ""}`} disabled={locked}
            onClick={() => setStep(number)} aria-current={step === number ? "step" : undefined}>
            <span className="step-card-number">0{number}</span><strong>{title}</strong><span className="step-card-status">{status}</span>
          </button>;
        })}
      </nav>
      <section className="step-detail" aria-live="polite">
        {error && <p className="step-error" role="alert">{error}</p>}
        {step === 1 && <>
          <div className="detail-heading"><span className="eyebrow">01 / YOUR RESUME</span><h2>Start with what you’ve done.</h2></div>
          <label className="file-button">Choose PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectPdf(event, "resume")} disabled={busy}/></label>
          <p className="detail-note">{busy ? "Extracting with Muse Spark…" : resumeName ? `${resumeName} · ${resumeApproved ? "Approved" : "Review before approval"}` : "PDF under 4 MB · sent to Meta for extraction · kept only this session"}</p>
          {proposal && <div className="review-list"><h3>Review proposed facts</h3>{proposal.projects.map((project, pi) => <div className="review-project" key={project.projectId}>
            <label>Project<input value={project.title} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { projects: old.projects.map((item, index) => index === pi ? { ...item, title: event.target.value } : item) }); }}/></label>
            {project.facts.map((fact, fi) => <div className="review-fact" key={fact.id}><label>Fact<textarea value={fact.text} maxLength={400} onChange={(event) => updateFact(pi, fi, event.target.value)} rows={2}/></label><p>Source excerpt: “{fact.source}”</p><button type="button" className="text-button" onClick={() => { setResumeApproved(false); setProposal((old) => old && { projects: old.projects.map((item, index) => index === pi ? { ...item, facts: item.facts.filter((_, i) => i !== fi) } : item) }); }}>Remove</button></div>)}
          </div>)}<button className="primary-button" type="button" onClick={approveResume} disabled={busy || resumeApproved}>Approve reviewed facts</button></div>}
        </>}
        {step === 2 && <>
          <div className="detail-heading"><span className="eyebrow">02 / LET’S TALK</span><h2>Tell the story behind the work.</h2></div>
          <p className="detail-note">Voice is not active yet. Use text for this foundational practice conversation.</p>
          <div className="conversation"><p className="conversation-prompt">{prompt}</p>{conversation.map((turn, index) => <p key={index} className="conversation-turn">You: {turn}</p>)}</div>
          <label className="field-label">Your response<textarea value={answer} maxLength={1500} rows={3} onChange={(event) => setAnswer(event.target.value)}/></label>
          <button className="secondary-button" type="button" disabled={answer.trim().length < 10} onClick={() => { setConversation((old) => [...old, answer.trim()]); setAnswer(""); }}>Add response</button>
          <div className="memory-editor"><h3>Career Memory</h3><p className="detail-note">Approve at least one project or accomplishment. Interview entries are based on what you said here.</p>
            {approved.map((project) => <div className="memory-row" key={project.projectId}><strong>{project.title}</strong><span>{project.facts.length} approved fact{project.facts.length === 1 ? "" : "s"}</span><button type="button" className="text-button" onClick={() => { if (!project.projectId.startsWith("interview-")) setResumeApproved(false); setApproved((old) => old.filter((item) => item.projectId !== project.projectId)); }}>Remove</button></div>)}
            <label className="field-label">Project or accomplishment<input value={projectTitle} maxLength={100} onChange={(event) => setProjectTitle(event.target.value)}/></label>
            <label className="field-label">Supported fact · copy a short phrase from your response<textarea value={projectFact} maxLength={300} rows={2} onChange={(event) => setProjectFact(event.target.value)}/></label>
            <button className="secondary-button" type="button" onClick={addInterviewMemory}>Approve this example</button>
          </div>
          <button className="primary-button" type="button" disabled={!hasMemory} onClick={() => { setTalkSaved(true); setStep(3); }}>Save &amp; Continue</button>
          <p className="detail-note">Saved for this session only. Return anytime during this session to add more.</p>
        </>}
        {step === 3 && <>
          <div className="detail-heading"><span className="eyebrow">03 / THE OPPORTUNITY</span><h2>What are you preparing for?</h2></div>
          <label className="field-label">Paste job description<textarea value={opportunityInput} maxLength={15000} rows={6} onChange={(event) => { setOpportunityInput(event.target.value); setConfirmedOpportunity(null); }}/></label>
          <div className="inline-actions"><button type="button" className="primary-button" disabled={busy || opportunityInput.trim().length < 30} onClick={() => void run(async () => { const result = await post<{ opportunity: Opportunity }>("/extract-opportunity", { text: opportunityInput }); setOpportunityDraft(result.opportunity); setConfirmedOpportunity(null); })}>{busy ? "Reading…" : "Identify role"}</button><label className="file-button">Or choose PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectPdf(event, "opportunity")} disabled={busy}/></label></div>
          {opportunityDraft && <div className="opportunity-review"><p className="detail-note">{opportunityDraft.confidence === "uncertain" ? "Company uncertain — confirm or correct it." : "Review and confirm the match."}</p>
            <label className="field-label">Company<input value={opportunityDraft.company} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, company: event.target.value, confidence: "uncertain" })}/></label>
            <label className="field-label">Role<input value={opportunityDraft.role} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, role: event.target.value })}/></label>
            <button type="button" className="primary-button" disabled={!opportunityDraft.company.trim() || !opportunityDraft.role.trim()} onClick={() => { setConfirmedOpportunity(opportunityDraft); setStep(4); }}>Confirm opportunity</button>
          </div>}
          <p className="detail-note">Company research and interviewer discovery are future features.</p>
        </>}
        {step === 4 && <>
          <div className="detail-heading"><span className="eyebrow">04 / PRACTICE</span><h2>Bring your own experience.</h2></div>
          <p className="detail-note">{canPractice ? `${confirmedOpportunity?.role} · ${confirmedOpportunity?.company} · ${approved.length} approved memory item${approved.length === 1 ? "" : "s"}` : "Add an approved memory and confirmed opportunity to begin."}</p>
          <button type="button" className="primary-button" disabled={!canPractice} onClick={() => setPractice("personal")}>Start text practice</button>
          <p className="detail-note">Voice transcription is not connected yet.</p>
        </>}
      </section>
      <div className="synthetic-entry"><span>Synthetic test mode</span><button className="text-button" type="button" onClick={() => setPractice("synthetic")}>Open text demo ↗</button></div>
      <footer className="page-footer"><span>VantSide Meta</span><span>Practice only · Session data is cleared on restart</span></footer>
    </div>
  </main>;
}
