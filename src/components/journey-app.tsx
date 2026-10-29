"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { BrandMark, OpeningSequence, PracticeApp } from "./practice-app";
import { startAnswerRecording, type AnswerRecorder } from "@/lib/record-answer";
import type { CareerProfile, MemoryProject, Opportunity } from "@/lib/session-schema";
import type { OpportunityAnalysis } from "@/lib/opportunity-analysis";
import { dismissProposal, emptyMemoryState, type MemoryState } from "../../backend/career-memory";
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
  const [guideOpen, setGuideOpen] = useState(false);
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
  const [jobAnalysis, setJobAnalysis] = useState<OpportunityAnalysis | null>(null);
  const [jobAlignment, setJobAlignment] = useState<{ strengths: Array<{ requirementId: string; factId: string }>; needsEvidence: string[] } | null>(null);
  const [jobAnswer, setJobAnswer] = useState("");
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [microphoneStatus, setMicrophoneStatus] = useState("");
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
  const [newProjectId, setNewProjectId] = useState("");
  const [stepTwoActivated, setStepTwoActivated] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [outputName, setOutputName] = useState("System default");
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
      if (!state.career.materials.length && !state.career.facts.length && !state.opportunities.length) {
        try { setGuideOpen(window.localStorage.getItem("vantside-guide-seen") !== "1"); }
        catch { setGuideOpen(true); }
      }
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
        setJobAnalysis(lastOpportunity.requirements ? { company: lastOpportunity.company, role: lastOpportunity.role,
          confidence: "clear", seniority: lastOpportunity.seniority, requirements: lastOpportunity.requirements } : null);
        setJobAlignment(lastOpportunity.alignment ?? null);
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
    if (!approvedProfile || !approved.length) return;
    if (!practiceConsent) {
      if (!window.confirm("Start a practice interview? Only record with everyone’s consent and where recording and AI use are allowed.")) return;
      setPracticeConsent(true);
    }
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
      const recorder = await startAnswerRecording(permission.signal, microphoneId || undefined);
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
        const result = await post<{ analysis: OpportunityAnalysis; alignment: NonNullable<typeof jobAlignment> }>("/analyze-opportunity", { filename, data, careerFacts: approved.flatMap((project) => project.facts.map((fact) => ({ id: fact.id, text: fact.text }))).slice(0, 20) });
        setJobAnalysis(result.analysis); setJobAlignment(result.alignment);
        setOpportunityDraft({ company: result.analysis.company, role: result.analysis.role, confidence: result.analysis.confidence });
        setOpportunityInput(""); setOpportunityPdfName(file.name); setConfirmedOpportunity(null);
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
      setResumeApproved(true); setStep(2); setStepTwoActivated(true);
      window.requestAnimationFrame(() => document.querySelector(".step-detail")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }));
      window.setTimeout(() => setStepTwoActivated(false), 1100);
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
      const projects = approvedProjects(next);
      setNewProjectId(projects.at(-1)?.projectId ?? "");
      setApproved(projects); setProjectTitle(""); setProjectFact(""); setSavedNotice(true);
    });
  }

  function dismissGuide() {
    try { window.localStorage.setItem("vantside-guide-seen", "1"); } catch { /* Session-only browser storage. */ }
    setGuideOpen(false);
  }

  async function testMicrophone() {
    await run(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true });
      const context = new AudioContext();
      let meter: number | undefined;
      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024; source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        meter = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
          setMicrophoneLevel(Math.min(100, Math.round(rms * 400)));
        }, 80);
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicrophones(devices.filter((device) => device.kind === "audioinput"));
        setOutputName(devices.find((device) => device.kind === "audiooutput" && device.deviceId === "default")?.label || "System default");
        setMicrophoneStatus("Microphone test running");
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        setMicrophoneStatus("Microphone ready");
      } finally {
        if (meter !== undefined) window.clearInterval(meter);
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
      }
    });
  }

  function startOver() {
    if (!window.confirm("Delete all saved Career Memory, proposals, sessions, and opportunities from this device?")) return;
    cancelActive();
    void run(async () => {
      await commitMemory(() => emptyMemoryState());
      activeSessionRef.current = null; setApproved([]); setApprovedProfile(null); setResumeApproved(false); setResumeName(""); setProposal(null);
      setMemoryProposals([]); setConversation([]); setInterviewQuestion(""); setInterviewSummary(""); setInterviewPhase("stopped");
      setAnswer(""); setPracticeConsent(false); setTalkSaved(false); setConfirmedOpportunity(null); setOpportunityDraft(null);
      setOpportunityInput(""); setOpportunityPdfName(""); setJobAnalysis(null); setJobAlignment(null); setJobAnswer("");
      setProjectTitle(""); setProjectFact(""); setSavedNotice(false); setKeyboardMode(false); setMicrophones([]); setMicrophoneId(""); setMicrophoneStatus(""); setStep(1);
      setNewProjectId(""); setMicrophoneLevel(0);
    });
  }

  function removeResumeSelection() {
    if (resumeApproved && !window.confirm("Remove this resume and facts supported only by it? Independently supported Career Memory will remain.")) return;
    if (!resumeApproved) {
      const previous = memoryRef.current.career.materials.filter((material) => material.kind === "resume").at(-1);
      setResumeName(previous?.label ?? ""); setResumeApproved(Boolean(previous && memoryRef.current.career.identity)); setProposal(null);
      return;
    }
    void run(async () => {
      const next = await commitMemory(removeResume);
      cancelActive(); activeSessionRef.current = null;
      setApproved(approvedProjects(next)); setJobAlignment(next.opportunities.at(-1)?.alignment ?? null);
      setApprovedProfile(null); setResumeApproved(false); setResumeName(""); setProposal(null); setStep(1);
    });
  }

  if (!loaded) return <main className="app-shell">{intro && <OpeningSequence onFinish={closeIntro} />}<div className="page-wrap" role="status">Loading Career Memory…</div></main>;
  if (storageFault) return <main className="app-shell"><div className="page-wrap" role="alert">{storageFault}</div></main>;

  if (practice) return <PracticeApp projects={practice === "personal" ? approved : undefined}
    opportunity={practice === "personal" && confirmedOpportunity ? { ...confirmedOpportunity,
      requirements: memoryRef.current.opportunities.at(-1)?.requirements,
      preparationQuestions: memoryRef.current.opportunities.at(-1)?.preparationQuestions } : undefined}
    onBack={() => setPractice(null)} />;

  return <main className="app-shell">
    {intro && <OpeningSequence onFinish={closeIntro} />}
    {!intro && guideOpen && <div className="guide-backdrop" role="dialog" aria-modal="true" aria-labelledby="guide-title" onKeyDown={(event) => { if (event.key === "Escape") dismissGuide(); }}>
      <div className="guide-card">
        <div className="brand-lockup"><BrandMark small /><span>VantSide</span></div>
        <h2 id="guide-title">Prepare in four steps.</h2>
        <div className="guide-steps">
          <div><span>01</span><strong>Your Resume</strong><p>Upload your resume to establish your professional background.</p></div>
          <div><span>02</span><strong>Let’s Talk</strong><p>Have a conversation to build a richer Career Memory.</p></div>
          <div><span>03</span><strong>The Opportunity</strong><p>Add a job description to connect its requirements to your experience.</p></div>
          <div><span>04</span><strong>Your Interview</strong><p>Practice with short memory cues based on approved facts.</p></div>
        </div>
        <p className="guide-note">Your Career Memory grows over time. Prepare for another opportunity without starting over.</p>
        <button type="button" className="primary-button" onClick={dismissGuide} autoFocus>Get Started <span aria-hidden="true">→</span></button>
      </div>
    </div>}
    <div className="page-wrap" inert={!intro && guideOpen}>
      <header className="topbar"><div className="brand-lockup"><BrandMark small /><span>VantSide</span></div><div className="topbar-actions"><button type="button" className="topbar-guide" onClick={() => setGuideOpen(true)}>How it works</button><button type="button" className="topbar-delete" onClick={startOver} disabled={busy}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7M10 11v5m4-5v5" /></svg>
        Delete my data
      </button></div></header>
      <section className="journey-heading"><h1>Prepare for your interview.</h1><p>Follow the four steps below.</p></section>
      <nav className="steps-grid" aria-label="Four steps">
        {([1, 2, 3, 4] as Step[]).map((number) => {
          const title = ["Your Resume", "Let's Talk", "The Opportunity", "Your Interview"][number - 1];
          const locked = number === 2 ? !resumeApproved && !hasMemory : number === 3 ? !hasMemory : number === 4 ? !canPractice : false;
          const complete = number === 1 ? resumeApproved : number === 2 ? talkSaved && hasMemory : number === 3 ? !!confirmedOpportunity : false;
          const status = complete ? "Complete" : locked ? number === 2 ? "Approve your resume first" : number === 3 ? "Build Career Memory first" : "Add memory and opportunity first" : number === 1 && proposal ? "Review needed" : number === 4 ? "Ready" : "Available";
          return <button key={number} type="button" className={`step-card${step === number ? " active" : ""}${number === 2 && stepTwoActivated ? " step-activated" : ""}`} disabled={locked}
            onClick={() => { if (step === 2 && number !== 2) pauseInterview(); setStep(number); }} aria-current={step === number ? "step" : undefined}>
            <span className="step-card-number">0{number}</span><strong>{title}</strong><span className="step-card-status">{complete ? `✓ ${status}` : status}</span>
          </button>;
        })}
      </nav>
      <section className="step-detail" aria-live="polite">
        {error && <p className="step-error" role="alert">{error}</p>}
        {step === 1 && <>
          <div className="detail-heading"><span className="eyebrow">01 / YOUR RESUME</span><h2>Start with what you’ve done.</h2></div>
          <div className="resume-upload">{!resumeName && <label className="file-button primary-upload">Choose PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectPdf(event, "resume")} disabled={busy}/></label>}{resumeName ? <div className="resume-file"><span aria-hidden="true" className="pdf-icon">PDF</span><strong>{resumeName}</strong><span className="detail-note">{resumeApproved ? "✓ Approved" : "Review before approval"}</span><button type="button" aria-label="Remove resume PDF" title="Remove resume PDF" disabled={busy} onClick={removeResumeSelection}>×</button></div> : <span className="detail-note">PDF under 4 MB</span>}</div>
          {resumeApproved && !proposal && <div className="approved-resume"><p>{approvedProfile?.profession} · {approvedProfile?.seniority}</p>{approved.filter((project) => project.dates).map((project) => <p key={project.projectId}>{project.title} · {project.dates}</p>)}</div>}
          {proposal && <div className="review-list"><h3>Career Summary</h3>
            <div className="profile-review"><label className="field-label">Profession<input value={proposal.profile.profession} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, profession: event.target.value } }); }}/></label>
            <label className="field-label">Seniority<input value={proposal.profile.seniority} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, seniority: event.target.value, senioritySource: undefined } }); }}/></label>
            <label className="field-label">Career overview<textarea value={proposal.profile.careerSummary} maxLength={500} rows={2} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, careerSummary: event.target.value } }); }}/></label></div>
            {proposal.projects.map((project, pi) => <div className="review-project" key={project.projectId}>
            <label>Project<input value={project.title} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, title: event.target.value } : item) }); }}/></label>
            {project.dates && <p className="project-dates"><strong>Dates</strong> {project.dates}</p>}
            {project.facts.map((fact, fi) => <div className="review-fact" key={fact.id}><label>Fact<textarea value={fact.text} maxLength={400} onChange={(event) => updateFact(pi, fi, event.target.value)} rows={2}/></label><button type="button" className="text-button" onClick={() => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, facts: item.facts.filter((_, i) => i !== fi) } : item) }); }}>Remove</button></div>)}
          </div>)}<button className="primary-button" type="button" onClick={approveResume} disabled={busy || resumeApproved}>Approve reviewed facts</button></div>}
        </>}
        {step === 2 && <>
          <div className="detail-heading"><span className="eyebrow">02 / LET’S TALK</span><h2>Tell the story behind the work.</h2></div>
          <details className="audio-devices"><summary>Audio devices</summary><div className="audio-device-grid"><label>Microphone input<select value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)}><option value="">System default</option>{microphones.map((device) => <option value={device.deviceId} key={device.deviceId}>{device.label || "Microphone"}</option>)}</select></label><div><strong>Speaker / headphones</strong><p>{outputName} · Questions are shown as text</p></div></div><div className="audio-test"><button type="button" className="text-button" disabled={busy} onClick={() => void testMicrophone()}>Test microphone</button><meter min="0" max="100" value={microphoneLevel} aria-label="Microphone level" />{microphoneStatus && <span role="status">{microphoneStatus}</span>}</div></details>
          {interviewError && <p className="step-error" role="alert">{interviewError}</p>}
          <div className="interview-controls" aria-live="polite">
            {!interviewQuestion && <button className="primary-button" type="button" disabled={!approvedProfile || interviewPhase === "processing"} onClick={() => void beginInterview()}>{interviewPhase === "stopped" ? "Start new interview" : "Start interview"}</button>}
            <span className={`interview-state ${interviewPhase}`} role="status">{interviewPhase === "permission" ? "Microphone permission" : interviewPhase === "listening" ? "● Recording" : interviewPhase === "processing" ? "Processing" : interviewPhase === "review" ? "Review transcript" : interviewPhase === "paused" ? "Paused" : interviewPhase === "stopped" ? "Stopped" : interviewPhase === "error" ? "Needs attention" : interviewQuestion ? "Ready" : "Not started"}</span>
            {interviewQuestion && !["stopped", "listening", "permission", "processing", "review"].includes(interviewPhase) && <button className="primary-button" type="button" disabled={!practiceConsent} onClick={() => void recordAnswer()}>Record answer</button>}
            {interviewPhase === "review" && <button className="text-button" type="button" onClick={() => { setAnswer(""); setInterviewPhase("idle"); }}>Discard transcript</button>}
            {interviewPhase === "listening" && <button className="primary-button" type="button" onClick={() => void finishAnswer()}>Finish answer</button>}
            {["listening", "permission", "processing"].includes(interviewPhase) && <button className="secondary-button" type="button" onClick={pauseInterview}>Pause</button>}
            {(interviewQuestion || ["permission", "listening", "processing"].includes(interviewPhase)) && interviewPhase !== "stopped" && <button className="text-button" type="button" onClick={stopInterview}>Stop interview</button>}
          </div>
          <div className="conversation"><p className="conversation-prompt">{prompt}</p>{conversation.map((turn, index) => <div key={index} className="conversation-turn"><strong>VantSide:</strong> {turn.question}<br/><strong>You:</strong> {turn.answer}</div>)}</div>
          {interviewQuestion && interviewPhase !== "stopped" && <><button type="button" className="text-button" onClick={() => setKeyboardMode((current) => !current)}>{keyboardMode ? "Use microphone" : "Use keyboard instead"}</button>{(keyboardMode || interviewPhase === "review") && <label className="field-label">{interviewPhase === "review" ? "Review and correct your transcript" : "Type your answer"}<textarea value={answer} maxLength={3000} rows={3} disabled={interviewPhase === "listening" || interviewPhase === "processing" || interviewPhase === "permission"} onChange={(event) => setAnswer(event.target.value)}/></label>}
          <button className="secondary-button" type="button" disabled={!practiceConsent || answer.trim().length < 10 || interviewPhase === "processing" || interviewPhase === "listening" || interviewPhase === "permission"} onClick={() => void submitInterviewAnswer()}>Continue conversation</button></>}
          <div className="memory-editor"><h3>Career Memory</h3>
            {memoryProposals.map((item, index) => <div className="review-fact" key={`${index}-${item.source}`}><p className="eyebrow">PROPOSED · NOT APPROVED</p><strong>{item.title}</strong><label className="field-label">Review fact<textarea rows={2} maxLength={300} value={item.text} onChange={(event) => setMemoryProposals((old) => old.map((proposal, i) => i === index ? { ...proposal, text: event.target.value } : proposal))}/></label><p>From your answer: “{item.source}”</p><div className="inline-actions"><button className="secondary-button" type="button" disabled={item.text.trim().length < 5} onClick={() => approveMemoryProposal(index)}>Approve</button><button className="text-button" type="button" onClick={() => void run(async () => { await commitMemory((state) => dismissProposal(state, item.id)); setMemoryProposals((old) => old.filter((proposal) => proposal.id !== item.id)); })}>Dismiss</button></div></div>)}
            {approved.map((project) => <div className={`memory-row${newProjectId === project.projectId ? " memory-new" : ""}`} key={project.projectId}><strong>{project.title}</strong><span>{project.facts.length} approved fact{project.facts.length === 1 ? "" : "s"}</span><button type="button" className="text-button" onClick={() => void run(async () => {
              const next = await commitMemory((state) => removeCareerProject(state, project.projectId));
              setApproved(approvedProjects(next)); setJobAlignment(next.opportunities.at(-1)?.alignment ?? null);
              setMemoryProposals(pendingInterviewFacts(next)); setResumeApproved(Boolean(next.career.identity));
              setResumeName(next.career.materials.filter((material) => material.kind === "resume").at(-1)?.label ?? "");
              if (!next.career.identity) setApprovedProfile(null);
            })}>Remove</button></div>)}
            <div className="manual-memory"><label className="field-label">Project or accomplishment<input value={projectTitle} maxLength={100} onChange={(event) => { setProjectTitle(event.target.value); setSavedNotice(false); }}/></label>
            <label className="field-label">Supported fact · copy a short phrase from your response<textarea value={projectFact} maxLength={300} rows={2} onChange={(event) => { setProjectFact(event.target.value); setSavedNotice(false); }}/></label>
            <div className="inline-actions"><button className="secondary-button" type="button" onClick={addInterviewMemory}>Add to Career Memory</button>{savedNotice && <span className="saved-note" role="status">✓ Saved</span>}</div></div>
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
          <details className="privacy-details"><summary>Privacy</summary><p>{hasDesktopStorage() ? "Approved Career Memory is saved on this device. Raw audio and full transcripts are not retained." : "This browser preview keeps Career Memory for this session only."}</p></details>
        </>}
        {step === 3 && <>
          <div className="detail-heading"><span className="eyebrow">03 / THE OPPORTUNITY</span><h2>What are you preparing for?</h2></div>
          <label className="field-label">Paste job description<textarea value={opportunityInput} maxLength={15000} rows={6} onChange={(event) => { setOpportunityInput(event.target.value); setOpportunityPdfName(""); setConfirmedOpportunity(null); setOpportunityDraft(null); setJobAnalysis(null); setJobAlignment(null); }}/></label>
          <div className="inline-actions"><button type="button" className="primary-button" disabled={busy || opportunityInput.trim().length < 30} onClick={() => void run(async () => {
            const result = await post<{ analysis: OpportunityAnalysis; alignment: NonNullable<typeof jobAlignment> }>("/analyze-opportunity", { text: opportunityInput,
              careerFacts: approved.flatMap((project) => project.facts.map((fact) => ({ id: fact.id, text: fact.text }))).slice(0, 20) });
            setJobAnalysis(result.analysis); setJobAlignment(result.alignment);
            setOpportunityDraft({ company: result.analysis.company, role: result.analysis.role, confidence: result.analysis.confidence });
          })}>Analyze description</button><label className="file-button">Choose job description PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectPdf(event, "opportunity")} disabled={busy}/></label>{busy && <span role="status">Reading job description…</span>}</div>
          {opportunityDraft && <div className="opportunity-review"><p className="detail-note">{opportunityDraft.confidence === "uncertain" ? "Please enter the company and confirm the role." : "Confirm the company and role."}</p>
            <label className="field-label">Company<input value={opportunityDraft.company} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, company: event.target.value, confidence: "uncertain" })}/></label>
            <label className="field-label">Role<input value={opportunityDraft.role} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, role: event.target.value })}/></label>
            <button type="button" className="primary-button" disabled={!opportunityDraft.company.trim() || !opportunityDraft.role.trim() || busy} onClick={() => void run(async () => {
              const description = opportunityInput.trim() || `PDF: ${opportunityPdfName}`;
              await commitMemory((state) => confirmOpportunity(state, opportunityDraft, description, new Date().toISOString(), jobAnalysis ?? undefined, jobAlignment ?? undefined, opportunityPdfName || "Pasted job description"));
              setConfirmedOpportunity(opportunityDraft);
            })}>Confirm opportunity</button>
          </div>}
          {jobAnalysis && <div className="job-analysis"><h3>Role requirements</h3>{jobAnalysis.seniority && <p>{jobAnalysis.seniority}</p>}
            {jobAnalysis.requirements.map((item) => <div key={item.id} className="job-requirement"><strong>{item.kind === "required" ? "Required" : item.kind === "preferred" ? "Preferred" : item.kind === "domain" ? "Domain" : "Responsibility"}</strong> · {item.text}<details><summary>Source</summary>{item.sourceExcerpt}</details><button type="button" className="text-button" onClick={() => { setJobAnalysis((current) => current && { ...current, requirements: current.requirements.filter((requirement) => requirement.id !== item.id) }); setJobAlignment((current) => current && { strengths: current.strengths.filter((match) => match.requirementId !== item.id), needsEvidence: current.needsEvidence.filter((id) => id !== item.id) }); }}>Remove</button></div>)}
            <h3>Career Memory alignment</h3><p>{jobAlignment?.strengths.length ?? 0} possible strengths linked to approved facts. {jobAlignment?.needsEvidence.length ?? 0} areas need more evidence; these are not assumed gaps.</p>
            {jobAlignment?.strengths.map((item) => <p key={item.requirementId}>✓ {jobAnalysis.requirements.find((requirement) => requirement.id === item.requirementId)?.text} · {approved.flatMap((project) => project.facts).find((fact) => fact.id === item.factId)?.text}</p>)}
            {jobAnalysis.requirements.filter((item) => jobAlignment?.needsEvidence.includes(item.id)).slice(0, 3).map((item) => <p key={item.id}>Explore: What past work can you share that relates to {item.text.toLowerCase()}?</p>)}
            {!!confirmedOpportunity && !!jobAlignment?.needsEvidence.length && <div className="job-follow-up"><h3>Share a relevant example</h3><p>What past work can you share that relates to {jobAnalysis.requirements.find((item) => item.id === jobAlignment.needsEvidence[0])?.text.toLowerCase()}?</p>
              <label className="field-label">Your answer<textarea value={jobAnswer} maxLength={300} rows={3} onChange={(event) => setJobAnswer(event.target.value)}/></label>
              <button type="button" className="secondary-button" disabled={jobAnswer.trim().length < 10 || busy} onClick={() => void run(async () => {
                const sessionId = activeSessionRef.current ?? newMemoryId("session"); activeSessionRef.current = sessionId;
                const quote = jobAnswer.trim();
                const pending: MemoryProposal = { id: newMemoryId("fact"), title: projectTitle.trim() || "Opportunity example", text: quote, source: quote, answer: quote, sessionId,
                  opportunityId: memoryRef.current.opportunities.at(-1)?.id };
                await commitMemory((state) => retainPendingFact(state, pending, new Date().toISOString()));
                setMemoryProposals((items) => [...items, pending]); setJobAnswer(""); setStep(2);
              })}>Review for Career Memory</button></div>}
          </div>}
          {confirmedOpportunity && <button type="button" className="primary-button" onClick={() => setStep(4)}>Continue to Practice</button>}
          {confirmedOpportunity && <button type="button" className="text-button" onClick={() => void run(async () => {
            const current = memoryRef.current.opportunities.at(-1);
            if (!current) return;
            const next = await commitMemory((state) => removeOpportunity(state, current.id));
            const previous = next.opportunities.at(-1);
            setMemoryProposals(pendingInterviewFacts(next));
            setConfirmedOpportunity(previous ? { company: previous.company, role: previous.role, confidence: "clear" } : null);
            setJobAnalysis(previous?.requirements ? { company: previous.company, role: previous.role, seniority: previous.seniority, confidence: "clear", requirements: previous.requirements } : null);
            setJobAlignment(previous?.alignment ?? null); setJobAnswer(""); setOpportunityDraft(null);
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
      <footer className="page-footer"><span>VantSide</span><span>Practice only · {hasDesktopStorage() ? "Saved on this device" : "Session only"}</span></footer>
    </div>
  </main>;
}
