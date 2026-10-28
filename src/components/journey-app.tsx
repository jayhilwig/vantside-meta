"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { BrandMark, OpeningSequence, PracticeApp } from "./practice-app";
import { startAnswerRecording, type AnswerRecorder } from "@/lib/record-answer";
import type { CareerProfile, MemoryProject, Opportunity } from "@/lib/session-schema";

type Step = 1 | 2 | 3 | 4;
type ResumeProposal = { profile: CareerProfile; projects: MemoryProject[] };
type MemoryProposal = { title: string; text: string; source: string };
type InterviewPhase = "idle" | "permission" | "listening" | "processing" | "review" | "paused" | "stopped" | "error";
const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

async function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the PDF."));
    reader.readAsDataURL(file);
  });
}

async function post<T>(route: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${api}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
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
  const [approvedProfile, setApprovedProfile] = useState<CareerProfile | null>(null);
  const [resumeApproved, setResumeApproved] = useState(false);
  const [opportunityInput, setOpportunityInput] = useState("");
  const [opportunityDraft, setOpportunityDraft] = useState<Opportunity | null>(null);
  const [confirmedOpportunity, setConfirmedOpportunity] = useState<Opportunity | null>(null);
  const [answer, setAnswer] = useState("");
  const [conversation, setConversation] = useState<Array<{ question: string; answer: string }>>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectFact, setProjectFact] = useState("");
  const [talkSaved, setTalkSaved] = useState(false);
  const [interviewQuestion, setInterviewQuestion] = useState("");
  const [interviewSummary, setInterviewSummary] = useState("");
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  const [interviewPhase, setInterviewPhase] = useState<InterviewPhase>("idle");
  const [interviewError, setInterviewError] = useState("");
  const [practiceConsent, setPracticeConsent] = useState(false);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const micRequestRef = useRef<AbortController | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const recordTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasMemory = approved.some((project) => project.title.trim() && project.facts.some((fact) => fact.text.trim() && fact.source.trim()));
  const canPractice = hasMemory && !!confirmedOpportunity;
  const prompt = interviewQuestion || "Start the interview to get a question based on your approved resume.";

  function cancelActive() {
    generationRef.current++;
    micRequestRef.current?.abort(); micRequestRef.current = null;
    recorderRef.current?.discard(); recorderRef.current = null;
    requestRef.current?.abort(); requestRef.current = null;
    if (recordTimerRef.current !== null) window.clearTimeout(recordTimerRef.current);
    recordTimerRef.current = null;
  }

  useEffect(() => () => {
    micRequestRef.current?.abort(); recorderRef.current?.discard(); requestRef.current?.abort();
    if (recordTimerRef.current !== null) window.clearTimeout(recordTimerRef.current);
  }, []);

  useEffect(() => {
    const stopHiddenCapture = () => {
      if (document.visibilityState !== "hidden") return;
      micRequestRef.current?.abort(); recorderRef.current?.discard(); requestRef.current?.abort();
      micRequestRef.current = null; recorderRef.current = null; requestRef.current = null;
      generationRef.current++;
      if (recordTimerRef.current !== null) window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
      setInterviewPhase((phase) => ["permission", "listening", "processing"].includes(phase) ? "paused" : phase);
    };
    document.addEventListener("visibilitychange", stopHiddenCapture);
    return () => document.removeEventListener("visibilitychange", stopHiddenCapture);
  }, []);

  async function beginInterview() {
    if (!approvedProfile || !approved.length || !practiceConsent) return;
    if (interviewQuestion) { setInterviewPhase("idle"); return; }
    const request = new AbortController(); requestRef.current = request;
    const generation = ++generationRef.current;
    setInterviewPhase("processing"); setInterviewError("");
    try {
      const result = await post<{ question: string }>("/interview/start", { profile: approvedProfile, projects: approved }, request.signal);
      if (generation !== generationRef.current) return;
      setInterviewQuestion(result.question); setInterviewPhase("idle");
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setInterviewError(cause instanceof Error ? cause.message : "Could not start the interview."); setInterviewPhase("error");
    } finally { if (requestRef.current === request) requestRef.current = null; }
  }

  async function recordAnswer() {
    const permission = new AbortController(); micRequestRef.current = permission;
    const generation = ++generationRef.current;
    setInterviewPhase("permission"); setInterviewError("");
    try {
      const recorder = await startAnswerRecording(permission.signal);
      if (generation !== generationRef.current) { recorder.discard(); return; }
      recorderRef.current = recorder; setInterviewPhase("listening");
      recordTimerRef.current = window.setTimeout(() => { void finishAnswer(); }, 60_000);
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setInterviewError(cause instanceof Error ? cause.message : "Microphone permission was denied."); setInterviewPhase("error");
    }
  }

  async function finishAnswer() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    if (recordTimerRef.current !== null) window.clearTimeout(recordTimerRef.current);
    recordTimerRef.current = null;
    let audio: string;
    try { audio = recorder.finish(); micRequestRef.current = null; } catch (cause) {
      micRequestRef.current = null;
      setInterviewError(cause instanceof Error ? cause.message : "Record a longer answer."); setInterviewPhase("error"); return;
    }
    const request = new AbortController(); requestRef.current = request;
    const generation = ++generationRef.current;
    setInterviewPhase("processing"); setInterviewError("");
    try {
      const result = await post<{ transcript: string }>("/interview/transcribe", { audio }, request.signal);
      if (generation !== generationRef.current) return;
      setAnswer(result.transcript); setInterviewPhase("review");
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setInterviewError(cause instanceof Error ? cause.message : "Transcription failed."); setInterviewPhase("error");
    } finally { if (requestRef.current === request) requestRef.current = null; }
  }

  async function submitInterviewAnswer() {
    if (!approvedProfile || !interviewQuestion || answer.trim().length < 10) return;
    const responseText = answer.trim();
    const request = new AbortController(); requestRef.current = request;
    const generation = ++generationRef.current;
    setInterviewPhase("processing"); setInterviewError("");
    try {
      const result = await post<{ question: string; summary: string; proposals: MemoryProposal[] }>("/interview/turn",
        { profile: approvedProfile, projects: approved, question: interviewQuestion, answer: responseText, summary: interviewSummary }, request.signal);
      if (generation !== generationRef.current) return;
      setConversation((old) => [...old, { question: interviewQuestion, answer: responseText }]); setAnswer("");
      setInterviewQuestion(result.question); setInterviewSummary(result.summary);
      setMemoryProposals((old) => [...old, ...result.proposals]); setInterviewPhase("idle");
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setInterviewError(cause instanceof Error ? cause.message : "Could not continue the conversation."); setInterviewPhase("error");
    } finally { if (requestRef.current === request) requestRef.current = null; }
  }

  function pauseInterview() { cancelActive(); setInterviewPhase("paused"); }
  function stopInterview() {
    cancelActive(); setInterviewPhase("stopped"); setAnswer(""); setPracticeConsent(false);
    setConversation([]); setInterviewSummary(""); setInterviewQuestion("");
  }

  function approveMemoryProposal(index: number) {
    const proposal = memoryProposals[index]; if (!proposal?.text.trim()) return;
    const id = slug();
    setApproved((old) => [...old, { projectId: id, title: proposal.title, facts: [{ id: `${id}-fact`, text: proposal.text.trim(), source: proposal.source }] }]);
    setMemoryProposals((old) => old.filter((_, i) => i !== index));
  }

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
    setProposal((old) => old && { ...old, projects: old.projects.map((project, pi) => pi === projectIndex
      ? { ...project, facts: project.facts.map((fact, fi) => fi === factIndex ? { ...fact, text } : fact) } : project) });
  }

  function approveResume() {
    const projects = proposal?.projects.map((project) => ({ ...project,
      facts: project.facts.filter((fact) => fact.text.trim().length >= 4 && fact.source.trim().length >= 3) }))
      .filter((project) => project.facts.length && project.title.trim().length >= 2) ?? [];
    if (!projects.length) { setError("Keep at least one source-backed fact to approve."); return; }
    if (!proposal || proposal.profile.profession.trim().length < 2 || proposal.profile.seniority.trim().length < 2 || proposal.profile.careerSummary.trim().length < 10) {
      setError("Review the profession, seniority, and career overview before approving."); return;
    }
    cancelActive(); setInterviewPhase("idle"); setInterviewQuestion(""); setInterviewSummary(""); setConversation([]); setAnswer(""); setMemoryProposals([]); setPracticeConsent(false);
    setApproved((old) => [...old.filter((project) => project.projectId.startsWith("interview-")), ...projects]);
    setApprovedProfile({ profession: proposal.profile.profession.trim(), seniority: proposal.profile.seniority.trim(), careerSummary: proposal.profile.careerSummary.trim() });
    setResumeApproved(true); setError(""); setStep(2);
  }

  function addInterviewMemory() {
    if (!projectTitle.trim() || !projectFact.trim() || !conversation.length) { setError("Share an example in the conversation, then name and approve it."); return; }
    const supported = conversation.some((turn) => turn.answer.toLowerCase().includes(projectFact.trim().toLowerCase()));
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
          const title = ["Your Resume", "Let's Talk", "The Opportunity", "Your Interview"][number - 1];
          const locked = number === 2 ? !resumeApproved && !hasMemory : number === 3 ? !hasMemory : number === 4 ? !canPractice : false;
          const complete = number === 1 ? resumeApproved : number === 2 ? talkSaved && hasMemory : number === 3 ? !!confirmedOpportunity : false;
          const status = complete ? "Complete" : locked ? number === 2 ? "Approve your resume first" : number === 3 ? "Build Career Memory first" : "Add memory and opportunity first" : number === 1 && proposal ? "Review needed" : number === 4 ? "Ready" : "Available";
          return <button key={number} type="button" className={`step-card${step === number ? " active" : ""}`} disabled={locked}
            onClick={() => { if (step === 2 && number !== 2) pauseInterview(); setStep(number); }} aria-current={step === number ? "step" : undefined}>
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
          {proposal && <div className="review-list"><h3>Review proposed facts</h3>
            <div className="profile-review"><label className="field-label">Profession<input value={proposal.profile.profession} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, profession: event.target.value } }); }}/></label>
            <label className="field-label">Seniority<input value={proposal.profile.seniority} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, seniority: event.target.value } }); }}/></label>
            <label className="field-label">Career overview<textarea value={proposal.profile.careerSummary} maxLength={500} rows={2} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, careerSummary: event.target.value } }); }}/></label></div>
            {proposal.projects.map((project, pi) => <div className="review-project" key={project.projectId}>
            <label>Project<input value={project.title} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, title: event.target.value } : item) }); }}/></label>
            {project.facts.map((fact, fi) => <div className="review-fact" key={fact.id}><label>Fact<textarea value={fact.text} maxLength={400} onChange={(event) => updateFact(pi, fi, event.target.value)} rows={2}/></label><p>Source excerpt: “{fact.source}”</p><button type="button" className="text-button" onClick={() => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, facts: item.facts.filter((_, i) => i !== fi) } : item) }); }}>Remove</button></div>)}
          </div>)}<button className="primary-button" type="button" onClick={approveResume} disabled={busy || resumeApproved}>Approve reviewed facts</button></div>}
        </>}
        {step === 2 && <>
          <div className="detail-heading"><span className="eyebrow">02 / LET’S TALK</span><h2>Tell the story behind the work.</h2></div>
          <p className="detail-note">{approvedProfile ? `${approvedProfile.profession} · ${approvedProfile.seniority}` : "Review your resume profile first."} Questions display as text. Microphone audio is sent to Meta only after you finish an answer.</p>
          <label className="consent-check"><input type="checkbox" checked={practiceConsent} onChange={(event) => { if (event.target.checked) setPracticeConsent(true); else stopInterview(); }}/> This is a consensual practice session. No employer or participant rule prohibits recording or AI use.</label>
          {interviewError && <p className="step-error" role="alert">{interviewError}</p>}
          <div className="interview-controls" aria-live="polite">
            <span className={`interview-state ${interviewPhase}`}>{interviewPhase === "permission" ? "Microphone permission" : interviewPhase === "listening" ? "● Recording" : interviewPhase === "processing" ? "Processing" : interviewPhase === "review" ? "Review transcript" : interviewPhase === "paused" ? "Paused" : interviewPhase === "stopped" ? "Stopped" : interviewPhase === "error" ? "Needs attention" : interviewQuestion ? "Ready" : "Not started"}</span>
            {!interviewQuestion && <button className="primary-button" type="button" disabled={!approvedProfile || !practiceConsent || interviewPhase === "processing"} onClick={() => void beginInterview()}>{interviewPhase === "stopped" ? "Start new interview" : "Start interview"}</button>}
            {interviewQuestion && !["stopped", "listening", "permission", "processing", "review"].includes(interviewPhase) && <button className="primary-button" type="button" disabled={!practiceConsent} onClick={() => void recordAnswer()}>Record answer</button>}
            {interviewPhase === "review" && <button className="text-button" type="button" onClick={() => { setAnswer(""); setInterviewPhase("idle"); }}>Discard transcript</button>}
            {interviewPhase === "listening" && <button className="primary-button" type="button" onClick={() => void finishAnswer()}>Finish answer</button>}
            {["listening", "permission", "processing"].includes(interviewPhase) && <button className="secondary-button" type="button" onClick={pauseInterview}>Pause</button>}
            {(interviewQuestion || ["permission", "listening", "processing"].includes(interviewPhase)) && interviewPhase !== "stopped" && <button className="text-button" type="button" onClick={stopInterview}>Stop interview</button>}
          </div>
          <div className="conversation"><p className="conversation-prompt">{prompt}</p>{conversation.map((turn, index) => <div key={index} className="conversation-turn"><strong>VantSide:</strong> {turn.question}<br/><strong>You:</strong> {turn.answer}</div>)}</div>
          {interviewQuestion && interviewPhase !== "stopped" && <><label className="field-label">{interviewPhase === "review" ? "Review and correct your transcript" : "Type instead · accessible text fallback"}<textarea value={answer} maxLength={3000} rows={3} disabled={interviewPhase === "listening" || interviewPhase === "processing" || interviewPhase === "permission"} onChange={(event) => setAnswer(event.target.value)}/></label>
          <button className="secondary-button" type="button" disabled={!practiceConsent || answer.trim().length < 10 || interviewPhase === "processing" || interviewPhase === "listening" || interviewPhase === "permission"} onClick={() => void submitInterviewAnswer()}>Continue conversation</button></>}
          <div className="memory-editor"><h3>Career Memory</h3><p className="detail-note">Approve at least one project or accomplishment. Interview entries are based on what you said here.</p>
            {memoryProposals.map((item, index) => <div className="review-fact" key={`${index}-${item.source}`}><p className="eyebrow">PROPOSED · NOT APPROVED</p><strong>{item.title}</strong><label className="field-label">Review fact<textarea rows={2} maxLength={300} value={item.text} onChange={(event) => setMemoryProposals((old) => old.map((proposal, i) => i === index ? { ...proposal, text: event.target.value } : proposal))}/></label><p>From your answer: “{item.source}”</p><div className="inline-actions"><button className="secondary-button" type="button" disabled={item.text.trim().length < 5} onClick={() => approveMemoryProposal(index)}>Approve</button><button className="text-button" type="button" onClick={() => setMemoryProposals((old) => old.filter((_, i) => i !== index))}>Dismiss</button></div></div>)}
            {approved.map((project) => <div className="memory-row" key={project.projectId}><strong>{project.title}</strong><span>{project.facts.length} approved fact{project.facts.length === 1 ? "" : "s"}</span><button type="button" className="text-button" onClick={() => { if (!project.projectId.startsWith("interview-")) setResumeApproved(false); setApproved((old) => old.filter((item) => item.projectId !== project.projectId)); }}>Remove</button></div>)}
            <label className="field-label">Project or accomplishment<input value={projectTitle} maxLength={100} onChange={(event) => setProjectTitle(event.target.value)}/></label>
            <label className="field-label">Supported fact · copy a short phrase from your response<textarea value={projectFact} maxLength={300} rows={2} onChange={(event) => setProjectFact(event.target.value)}/></label>
            <button className="secondary-button" type="button" onClick={addInterviewMemory}>Approve this example</button>
          </div>
          <button className="primary-button" type="button" disabled={!hasMemory || interviewPhase === "permission" || interviewPhase === "listening" || interviewPhase === "processing"} onClick={() => { pauseInterview(); setTalkSaved(true); setStep(3); }}>Save &amp; Continue</button>
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
          <div className="detail-heading"><span className="eyebrow">04 / YOUR INTERVIEW</span><h2>Bring your own experience.</h2></div>
          <p className="detail-note">{canPractice ? `${confirmedOpportunity?.role} · ${confirmedOpportunity?.company} · ${approved.length} approved memory item${approved.length === 1 ? "" : "s"}` : "Add an approved memory and confirmed opportunity to begin."}</p>
          <button type="button" className="primary-button" disabled={!canPractice} onClick={() => setPractice("personal")}>Start text practice</button>
          <p className="detail-note">This job-specific practice view remains text only. Voice answers are available in Let’s Talk.</p>
        </>}
      </section>
      <div className="synthetic-entry"><span>Synthetic test mode</span><button className="text-button" type="button" onClick={() => setPractice("synthetic")}>Open text demo ↗</button></div>
      <footer className="page-footer"><span>VantSide Meta</span><span>Practice only · Session data is cleared on restart</span></footer>
    </div>
  </main>;
}
