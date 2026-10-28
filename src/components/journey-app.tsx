"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { BrandMark, OpeningSequence, PracticeApp } from "./practice-app";
import { startAnswerRecording, type AnswerRecorder } from "@/lib/record-answer";
import type { CareerProfile, MemoryProject, Opportunity } from "@/lib/session-schema";
import { emptyMemoryState, type MemoryState } from "../../backend/career-memory";
import { hasDesktopStorage, loadCareerMemory, saveCareerMemory } from "@/lib/career-memory-storage";
import { approvedProjects, approveInterviewFact, approveManualInterviewFact, approveResumeReview,
  confirmOpportunity, newMemoryId, pendingInterviewFacts, removeCareerProject, removeOpportunity, removeResume,
  retainPendingFact, saveInterviewSession, type PendingInterviewFact } from "@/lib/journey-memory";

type Step = 1 | 2 | 3 | 4;
type ResumeProposal = { profile: CareerProfile; projects: MemoryProject[] };
type MemoryProposal = PendingInterviewFact;
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

export function JourneyApp() {
  const [intro, setIntro] = useState(true);
  const closeIntro = useCallback(() => setIntro(false), []);
  const [loaded, setLoaded] = useState(false);
  const [storageFault, setStorageFault] = useState("");
  const memoryRef = useRef<MemoryState>(emptyMemoryState());
  const revisionRef = useRef<number | null>(null);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeSessionRef = useRef<string | null>(null);
  const [opportunityPdfName, setOpportunityPdfName] = useState("");
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
  const [savedNotice, setSavedNotice] = useState(false);
  const hasMemory = approved.some((project) => project.title.trim() && project.facts.some((fact) => fact.text.trim() && fact.source.trim()));
  const canPractice = hasMemory && !!confirmedOpportunity;
  const prompt = interviewQuestion || "Start the interview to get a question based on your approved resume.";

  useEffect(() => {
    let mounted = true;
    void loadCareerMemory().then(({ state, revision }) => {
      if (!mounted) return;
      memoryRef.current = state; revisionRef.current = revision;
      const projects = approvedProjects(state);
      const lastResume = state.career.materials.filter((material) => material.kind === "resume").at(-1);
      const lastOpportunity = state.opportunities.at(-1);
      setApproved(projects);
      setApprovedProfile(state.career.identity ? {
        profession: state.career.identity.profession, seniority: state.career.identity.seniority,
        careerSummary: state.career.identity.careerSummary,
      } : null);
      setResumeApproved(Boolean(state.career.identity && lastResume));
      setResumeName(lastResume?.label ?? "");
      setMemoryProposals(pendingInterviewFacts(state));
      setTalkSaved(state.sessions.some((session) => session.status === "paused" || session.status === "completed"));
      if (lastOpportunity) {
        setConfirmedOpportunity({ company: lastOpportunity.company, role: lastOpportunity.role, confidence: "clear" });
        if (lastOpportunity.description.startsWith("PDF: ")) setOpportunityPdfName(lastOpportunity.description.slice(5));
        else setOpportunityInput(lastOpportunity.description);
      }
      if (lastOpportunity && projects.length) setStep(4);
      else if (projects.length) setStep(2);
    }).catch((cause) => {
      if (mounted) setStorageFault(cause instanceof Error ? cause.message : "Saved Career Memory could not be opened.");
    }).finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, []);

  function commitMemory(transform: (state: MemoryState) => MemoryState): Promise<MemoryState> {
    const operation = writeQueueRef.current.then(async () => {
      const next = transform(memoryRef.current);
      const revision = await saveCareerMemory(next, revisionRef.current);
      memoryRef.current = next; revisionRef.current = revision;
      return next;
    });
    writeQueueRef.current = operation.catch(() => undefined);
    return operation;
  }

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
      activeSessionRef.current = newMemoryId("session");
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
      const result = await post<{ question: string; summary: string; proposals: Array<Pick<MemoryProposal, "title" | "text" | "source">> }>("/interview/turn",
        { profile: approvedProfile, projects: approved, question: interviewQuestion, answer: responseText, summary: interviewSummary }, request.signal);
      if (generation !== generationRef.current) return;
      setConversation((old) => [...old, { question: interviewQuestion, answer: responseText }]); setAnswer("");
      setInterviewQuestion(result.question); setInterviewSummary(result.summary);
      const sessionId = activeSessionRef.current ?? newMemoryId("session");
      activeSessionRef.current = sessionId;
      setMemoryProposals((old) => [...old, ...result.proposals.map((item) => ({ ...item,
        id: newMemoryId("fact"), sessionId, answer: responseText }))]); setInterviewPhase("idle");
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setInterviewError(cause instanceof Error ? cause.message : "Could not continue the conversation."); setInterviewPhase("error");
    } finally { if (requestRef.current === request) requestRef.current = null; }
  }

  function pauseInterview() { cancelActive(); setInterviewPhase("paused"); }
  function stopInterview() {
    cancelActive(); setInterviewPhase("stopped"); setAnswer(""); setPracticeConsent(false);
    setConversation([]); setInterviewSummary(""); setInterviewQuestion("");
    const sessionId = activeSessionRef.current; activeSessionRef.current = null;
    if (sessionId && memoryRef.current.sessions.some((session) => session.id === sessionId)) {
      void commitMemory((state) => saveInterviewSession(state, sessionId, new Date().toISOString(), "cancelled"))
        .catch(() => setError("The interview stopped, but its saved session status could not be updated."));
    }
  }

  function approveMemoryProposal(index: number) {
    const proposal = memoryProposals[index]; if (!proposal?.text.trim()) return;
    void run(async () => {
      const next = await commitMemory((state) => approveInterviewFact(state, proposal, new Date().toISOString()));
      setApproved(approvedProjects(next));
      setMemoryProposals((old) => old.filter((item) => item.id !== proposal.id));
    });
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
      const filename = file.name.length > 120 ? `${file.name.slice(0, 116)}.pdf` : file.name;
      if (kind === "resume") {
        const result = await post<{ proposal: ResumeProposal }>("/extract-resume", { filename, data });
        setResumeName(file.name); setProposal(result.proposal); setResumeApproved(false);
      } else {
        const result = await post<{ opportunity: Opportunity }>("/extract-opportunity", { filename, data });
        setOpportunityDraft(result.opportunity); setOpportunityInput(""); setOpportunityPdfName(file.name); setConfirmedOpportunity(null);
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
    const reviewed = { profile: proposal.profile, projects };
    void run(async () => {
      const next = await commitMemory((state) => approveResumeReview(state, reviewed, resumeName, new Date().toISOString()));
      cancelActive(); activeSessionRef.current = null;
      setInterviewPhase("idle"); setInterviewQuestion(""); setInterviewSummary(""); setConversation([]); setAnswer(""); setPracticeConsent(false);
      setApproved(approvedProjects(next)); setApprovedProfile(reviewed.profile);
      setResumeApproved(true); setStep(2);
    });
  }

  function addInterviewMemory() {
    if (!projectTitle.trim() || !projectFact.trim() || !conversation.length) { setError("Share an example in the conversation, then name and approve it."); return; }
    const supported = conversation.some((turn) => turn.answer.toLowerCase().includes(projectFact.trim().toLowerCase()));
    if (!supported) { setError("Use a short phrase from one of your responses as the supported fact."); return; }
    const matched = conversation.find((turn) => turn.answer.toLowerCase().includes(projectFact.trim().toLowerCase()));
    if (!matched) return;
    const sessionId = activeSessionRef.current ?? newMemoryId("session");
    activeSessionRef.current = sessionId;
    void run(async () => {
      const next = await commitMemory((state) => approveManualInterviewFact(state, projectTitle.trim(), projectFact.trim(), matched.answer, sessionId, new Date().toISOString()));
      setApproved(approvedProjects(next)); setProjectTitle(""); setProjectFact(""); setSavedNotice(true);
    });
  }

  if (!loaded) return <main className="app-shell">{intro && <OpeningSequence onFinish={closeIntro} />}<div className="page-wrap" role="status">Loading Career Memory…</div></main>;
  if (storageFault) return <main className="app-shell"><div className="page-wrap" role="alert">{storageFault}</div></main>;

  if (practice) return <PracticeApp projects={practice === "personal" ? approved : undefined}
    opportunity={practice === "personal" && confirmedOpportunity ? confirmedOpportunity : undefined}
    onBack={() => setPractice(null)} />;

  return <main className="app-shell">
    {intro && <OpeningSequence onFinish={closeIntro} />}
    <div className="page-wrap">
      <header className="topbar"><div className="brand-lockup"><BrandMark small /><span>VantSide</span></div></header>
      <section className="journey-heading"><p className="eyebrow">YOUR PRACTICE ROOM</p><h1>Your story, ready when you are.</h1><p>Four steps. Your experience stays yours.</p></section>
      <nav className="steps-grid" aria-label="Four steps">
        {([1, 2, 3, 4] as Step[]).map((number) => {
          const title = ["Your Resume", "Let's Talk", "The Opportunity", "Your Interview"][number - 1];
          const locked = number === 2 ? !resumeApproved && !hasMemory : number === 3 ? !hasMemory : number === 4 ? !canPractice : false;
          const complete = number === 1 ? resumeApproved : number === 2 ? talkSaved && hasMemory : number === 3 ? !!confirmedOpportunity : false;
          const status = complete ? "Complete" : locked ? number === 2 ? "Approve your resume first" : number === 3 ? "Build Career Memory first" : "Add memory and opportunity first" : number === 1 && proposal ? "Review needed" : number === 4 ? "Ready" : "Available";
          return <button key={number} type="button" className={`step-card${step === number ? " active" : ""}`} disabled={locked}
            onClick={() => { if (step === 2 && number !== 2) pauseInterview(); setStep(number); }} aria-current={step === number ? "step" : undefined}>
            <span className="step-card-number">0{number}</span><strong>{title}</strong><span className="step-card-status">{complete ? `✓ ${status}` : status}</span>
          </button>;
        })}
      </nav>
      <section className="step-detail" aria-live="polite">
        {error && <p className="step-error" role="alert">{error}</p>}
        {step === 1 && <>
          <div className="detail-heading"><span className="eyebrow">01 / YOUR RESUME</span><h2>Start with what you’ve done.</h2></div>
          <div className="resume-upload"><label className="file-button">Choose PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectPdf(event, "resume")} disabled={busy}/></label><span className="detail-note">{busy ? "Reading…" : resumeName ? `${resumeName} · ${resumeApproved ? "✓ Approved" : "Review before approval"}` : "PDF under 4 MB"}</span></div>
          {resumeApproved && <button type="button" className="text-button" onClick={() => {
            if (!window.confirm("Remove this resume and facts supported only by it? Independently supported Career Memory will remain.")) return;
            void run(async () => { const next = await commitMemory(removeResume); cancelActive(); activeSessionRef.current = null;
              setApproved(approvedProjects(next)); setApprovedProfile(null); setResumeApproved(false); setResumeName(""); setProposal(null); setStep(1);
            });
          }}>Remove Resume</button>}
          {proposal && <div className="review-list"><h3>Review Your Career</h3><h4>Career Summary</h4>
            <div className="profile-review"><label className="field-label">Profession<input value={proposal.profile.profession} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, profession: event.target.value } }); }}/></label>
            <label className="field-label">Seniority<input value={proposal.profile.seniority} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, seniority: event.target.value } }); }}/></label>
            <label className="field-label">Career overview<textarea value={proposal.profile.careerSummary} maxLength={500} rows={2} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, careerSummary: event.target.value } }); }}/></label></div>
            {proposal.projects.map((project, pi) => <div className="review-project" key={project.projectId}>
            <label>Project<input value={project.title} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, title: event.target.value } : item) }); }}/></label>
            {project.dates && <p className="project-dates">{project.dates}</p>}
            {project.facts.map((fact, fi) => <div className="review-fact" key={fact.id}><label>Fact<textarea value={fact.text} maxLength={400} onChange={(event) => updateFact(pi, fi, event.target.value)} rows={2}/></label><button type="button" className="text-button" onClick={() => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, facts: item.facts.filter((_, i) => i !== fi) } : item) }); }}>Remove</button></div>)}
          </div>)}<button className="primary-button" type="button" onClick={approveResume} disabled={busy || resumeApproved}>Approve reviewed facts</button></div>}
        </>}
        {step === 2 && <>
          <div className="detail-heading"><span className="eyebrow">02 / LET’S TALK</span><h2>Tell the story behind the work.</h2></div>
          <p className="detail-note">{approvedProfile ? `${approvedProfile.profession} · ${approvedProfile.seniority}` : "Review your resume first."}</p>
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
            {approved.map((project) => <div className="memory-row" key={project.projectId}><strong>{project.title}</strong><span>{project.facts.length} approved fact{project.facts.length === 1 ? "" : "s"}</span><button type="button" className="text-button" onClick={() => void run(async () => {
              const next = await commitMemory((state) => removeCareerProject(state, project.projectId));
              setApproved(approvedProjects(next)); setResumeApproved(Boolean(next.career.identity));
              setResumeName(next.career.materials.filter((material) => material.kind === "resume").at(-1)?.label ?? "");
              if (!next.career.identity) setApprovedProfile(null);
            })}>Remove</button></div>)}
            <label className="field-label">Project or accomplishment<input value={projectTitle} maxLength={100} onChange={(event) => setProjectTitle(event.target.value)}/></label>
            <label className="field-label">Supported fact · copy a short phrase from your response<textarea value={projectFact} maxLength={300} rows={2} onChange={(event) => setProjectFact(event.target.value)}/></label>
            <div className="inline-actions"><button className="secondary-button" type="button" onClick={addInterviewMemory}>Add to Career Memory</button>{savedNotice && <span className="saved-note" role="status">✓ Saved</span>}</div>
          </div>
          <button className="primary-button" type="button" disabled={!hasMemory || busy || interviewPhase === "permission" || interviewPhase === "listening" || interviewPhase === "processing"} onClick={() => {
            pauseInterview();
            const sessionId = activeSessionRef.current ?? newMemoryId("session"); activeSessionRef.current = sessionId;
            void run(async () => {
              await commitMemory((state) => {
                let next = saveInterviewSession(state, sessionId, new Date().toISOString(), "paused");
                for (const pending of memoryProposals) next = retainPendingFact(next, pending, new Date().toISOString());
                return next;
              });
              setTalkSaved(true); setStep(3);
            });
          }}>Save &amp; Continue</button>
          <p className="detail-note">{hasDesktopStorage() ? "Saved on this device. Audio and transcripts are not kept." : "Browser preview is session-only."}</p>
        </>}
        {step === 3 && <>
          <div className="detail-heading"><span className="eyebrow">03 / THE OPPORTUNITY</span><h2>What are you preparing for?</h2></div>
          <label className="field-label">Paste job description<textarea value={opportunityInput} maxLength={15000} rows={6} onChange={(event) => { setOpportunityInput(event.target.value); setOpportunityPdfName(""); setConfirmedOpportunity(null); setOpportunityDraft(null); }} onBlur={() => { if (opportunityInput.trim().length >= 30 && !busy && !opportunityDraft) void run(async () => { const result = await post<{ opportunity: Opportunity }>("/extract-opportunity", { text: opportunityInput, careerFacts: approved.flatMap((project) => project.facts.map((fact) => ({ id: fact.id, text: fact.text }))).slice(0, 20) }); setOpportunityDraft(result.opportunity); }); }}/></label>
          <div className="inline-actions"><label className="file-button">Choose job description PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectPdf(event, "opportunity")} disabled={busy}/></label>{busy && <span role="status">Identifying company and role…</span>}</div>
          {opportunityDraft && <div className="opportunity-review"><p className="detail-note">{opportunityDraft.confidence === "uncertain" ? "Please enter the company and confirm the role." : "Confirm the company and role."}</p>
            <label className="field-label">Company<input value={opportunityDraft.company} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, company: event.target.value, confidence: "uncertain" })}/></label>
            <label className="field-label">Role<input value={opportunityDraft.role} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, role: event.target.value })}/></label>
            <button type="button" className="primary-button" disabled={!opportunityDraft.company.trim() || !opportunityDraft.role.trim() || busy} onClick={() => void run(async () => {
              const description = opportunityInput.trim() || `PDF: ${opportunityPdfName}`;
              await commitMemory((state) => confirmOpportunity(state, opportunityDraft, description, new Date().toISOString()));
              setConfirmedOpportunity(opportunityDraft); setStep(4);
            })}>Confirm opportunity</button>
          </div>}
          {confirmedOpportunity && <button type="button" className="text-button" onClick={() => void run(async () => {
            const current = memoryRef.current.opportunities.at(-1);
            if (!current) return;
            const next = await commitMemory((state) => removeOpportunity(state, current.id));
            const previous = next.opportunities.at(-1);
            setConfirmedOpportunity(previous ? { company: previous.company, role: previous.role, confidence: "clear" } : null);
            setOpportunityInput(previous?.description.startsWith("PDF: ") ? "" : previous?.description ?? "");
            setOpportunityPdfName(previous?.description.startsWith("PDF: ") ? previous.description.slice(5) : "");
          })}>Remove saved opportunity</button>}
          <details className="optional-interviewers"><summary>Known interviewers (optional)</summary><p className="detail-note">Interviewer context is not available yet.</p><label className="field-label">LinkedIn profile URL<input type="url" placeholder="Not available yet" disabled /></label><label className="file-button unavailable-file" aria-disabled="true">Interviewer PDF · unavailable<input type="file" accept="application/pdf,.pdf" disabled /></label></details>
        </>}
        {step === 4 && <>
          <div className="detail-heading"><span className="eyebrow">04 / YOUR INTERVIEW</span><h2>Bring your own experience.</h2></div>
          <p className="detail-note">{canPractice ? `${confirmedOpportunity?.role} · ${confirmedOpportunity?.company} · ${approved.length} approved memory item${approved.length === 1 ? "" : "s"}` : "Add an approved memory and confirmed opportunity to begin."}</p>
          <button type="button" className="primary-button practice-start" disabled={!canPractice} onClick={() => setPractice("personal")}>Start Practice</button>
        </>}
      </section>
      <footer className="page-footer"><span>VantSide</span><span>Practice only · {hasDesktopStorage() ? "Saved on this device" : "Session only"}</span><button type="button" className="text-button" onClick={() => {
        if (!window.confirm("Delete all saved Career Memory, proposals, sessions, and opportunities from this device?")) return;
        cancelActive();
        void run(async () => {
          await commitMemory(() => emptyMemoryState());
          activeSessionRef.current = null; setApproved([]); setApprovedProfile(null); setResumeApproved(false); setResumeName(""); setProposal(null);
          setMemoryProposals([]); setConversation([]); setInterviewQuestion(""); setInterviewSummary(""); setInterviewPhase("stopped");
          setAnswer(""); setPracticeConsent(false); setTalkSaved(false); setConfirmedOpportunity(null); setOpportunityDraft(null);
          setOpportunityInput(""); setOpportunityPdfName(""); setStep(1);
        });
      }}>Delete saved data</button></footer>
    </div>
  </main>;
}
