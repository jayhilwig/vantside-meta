"use client";

import { ChangeEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BrandMark, OpeningSequence, PracticeApp } from "./practice-app";
import { startLiveInterview, type LiveInterview, type LiveStatus } from "@/lib/live-interview";
import { advanceInterviewClock, emptyInterviewClock, interviewClockSeconds, interviewEncouragement, interviewTime } from "@/lib/interview-timing";
import type { CareerProfile, MemoryProject, Opportunity } from "@/lib/session-schema";
import type { OpportunityAnalysis } from "@/lib/opportunity-analysis";
import { emptyMemoryState, type MemoryState } from "../../backend/career-memory";
import { hasDesktopStorage, loadCareerMemory, saveCareerMemory } from "@/lib/career-memory-storage";
import { approvedProjects, approveInterviewBatch, approveManualCareerFact, approveResumeReview, currentReviewBatch, dismissInterviewBatch,
  confirmOpportunity, newMemoryId, pendingInterviewFacts, removeCareerProject, removeOpportunity, removeResume,
  retainPendingFact, saveInterviewSession, type PendingInterviewFact } from "@/lib/journey-memory";

type Step = 1 | 2 | 3 | 4;
type ResumeProposal = { profile: CareerProfile; projects: MemoryProject[] };
type MemoryProposal = PendingInterviewFact;
const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const seniorityChoices = ["Not specified", "Entry Level", "Junior", "Mid-Level", "Senior", "Staff", "Principal", "Executive"];
const suggestedSpeakingSeconds = 120;
const normalizeFact = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the PDF."));
    reader.readAsDataURL(file);
  });
}

async function post<T>(route: string, body: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(`${api}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
  catch (cause) { throw new Error(cause instanceof Error && cause.name === "AbortError" ? "Request cancelled." : "Local practice backend is unreachable. Start the backend and try again."); }
  let result: { error?: string } & T;
  try { result = await response.json(); }
  catch { throw new Error("Local practice backend returned unreadable data. Restart it and try again."); }
  if (!response.ok) throw new Error(result.error ?? "Please try again.");
  return result as T;
}

export function JourneyApp() {
  const [intro, setIntro] = useState(true);
  const closeIntro = useCallback(() => setIntro(false), []);
  const hudDialogRef = useRef<HTMLDialogElement | null>(null);
  const hudTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hudDragRef = useRef<{ x: number; y: number } | null>(null);
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
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneListAuthorized, setMicrophoneListAuthorized] = useState(false);
  const [microphoneId, setMicrophoneId] = useState("");
  const [microphoneStatus, setMicrophoneStatus] = useState("");
  const [confirmedOpportunity, setConfirmedOpportunity] = useState<Opportunity | null>(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectFact, setProjectFact] = useState("");
  const [talkSaved, setTalkSaved] = useState(false);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | "ready">("ready");
  const liveRef = useRef<LiveInterview | null>(null);
  const endLiveRef = useRef<() => Promise<void>>(async () => {});
  const liveStartRef = useRef<AbortController | null>(null);
  const [liveLevel, setLiveLevel] = useState(0);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [liveSpeakingSeconds, setLiveSpeakingSeconds] = useState(0);
  const liveClockRef = useRef(emptyInterviewClock());
  const [interviewError, setInterviewError] = useState("");
  const pendingLiveTranscriptRef = useRef("");
  const liveProposalRequestRef = useRef<AbortController | null>(null);
  const [canRetryLiveProposals, setCanRetryLiveProposals] = useState(false);
  const [reviewingLiveProposals, setReviewingLiveProposals] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [manualError, setManualError] = useState("");
  const stepTwoHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [newProjectId, setNewProjectId] = useState("");
  const [stepTwoActivated, setStepTwoActivated] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [outputName, setOutputName] = useState("System default");
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputId, setOutputId] = useState("");
  const [speakerStatus, setSpeakerStatus] = useState("");
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const speakerTestRef = useRef<{ audio: HTMLAudioElement; cancel: () => void } | null>(null);
  const hasMemory = approved.some((project) => project.title.trim() && project.facts.some((fact) => fact.text.trim() && fact.source.trim()));
  const canPractice = hasMemory && !!confirmedOpportunity;

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

  useEffect(() => {
    if (step !== 2) return;
    void refreshDevices();
  }, [step]);

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === "audioinput"));
      setOutputs(devices.filter((device) => device.kind === "audiooutput"));
      setOutputName(devices.find((device) => device.kind === "audiooutput" && device.deviceId === "default")?.label || "System default");
    } catch { /* Permission errors remain visible when the user runs a device test. */ }
  }

  async function revealMicrophones() {
    if (microphoneListAuthorized) { await refreshDevices(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophoneListAuthorized(true);
      await refreshDevices();
    } catch (cause) {
      setMicrophoneStatus(cause instanceof Error ? cause.message : "Microphone access is unavailable.");
    }
  }

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
    liveProposalRequestRef.current?.abort(); liveProposalRequestRef.current = null;
    liveStartRef.current?.abort(); liveStartRef.current = null;
    const live = liveRef.current; liveRef.current = null; live?.close();
  }

  useEffect(() => () => {
    liveStartRef.current?.abort(); liveRef.current?.close();
    liveProposalRequestRef.current?.abort();
  }, []);

  useEffect(() => { endLiveRef.current = endLiveInterview; });

  useEffect(() => {
    const active = ["listening", "user-speaking", "speaking"].includes(liveStatus);
    liveClockRef.current = advanceInterviewClock(liveClockRef.current, liveStatus, Date.now());
    if (!active) return;
    const tick = window.setInterval(() => {
      const { elapsed, speaking } = interviewClockSeconds(liveClockRef.current, Date.now());
      setLiveElapsed(elapsed); setLiveSpeakingSeconds(speaking);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [liveStatus]);

  useEffect(() => {
    const stopHiddenCapture = () => {
      if (document.visibilityState !== "hidden") return;
      if (liveRef.current || liveStartRef.current) void endLiveRef.current();
    };
    document.addEventListener("visibilitychange", stopHiddenCapture);
    return () => document.removeEventListener("visibilitychange", stopHiddenCapture);
  }, []);

  async function beginLiveInterview() {
    if (!approvedProfile || !approved.length || liveRef.current || liveStartRef.current) return;
    pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false);
    liveClockRef.current = emptyInterviewClock(); setLiveElapsed(0); setLiveSpeakingSeconds(0);
    const controller = new AbortController(); liveStartRef.current = controller;
    setLiveStatus("connecting"); setInterviewError("");
    try {
      const live = await startLiveInterview({ microphoneId, outputId, signal: controller.signal,
        createSession: async (sdp) => post<{ sdp: string }>("/interview/live/session", { sdp, profile: approvedProfile, projects: approved }, controller.signal),
        onStatus: (status) => { setLiveStatus(status); if (status === "ended" && liveRef.current) void endLiveInterview(); }, onLevel: setLiveLevel,
        onError: (message) => { liveRef.current = null; setInterviewError(message); setLiveStatus("error"); },
      });
      if (controller.signal.aborted) { live.close(); return; }
      liveRef.current = live;
      activeSessionRef.current = newMemoryId("session");
    } catch (cause) {
      if (!controller.signal.aborted) {
        const name = cause instanceof Error ? cause.name : "";
        setInterviewError(name === "NotAllowedError" ? "Microphone access was denied. Allow access and try again."
          : name === "NotFoundError" ? "The selected microphone is unavailable. Choose another device."
          : cause instanceof Error ? cause.message : "Voice could not start. Check your microphone and connection.");
        setLiveStatus("error");
      }
    } finally { if (liveStartRef.current === controller) liveStartRef.current = null; }
  }

  async function endLiveInterview() {
    const live = liveRef.current;
    liveStartRef.current?.abort(); liveStartRef.current = null;
    liveRef.current = null;
    const transcript = live?.userSpeech().trim() ?? "";
    live?.close(); setLiveStatus("ended"); setLiveLevel(0);
    if (transcript.length < 10) { setInterviewError("The session ended, but no reviewable answer was captured."); return; }
    pendingLiveTranscriptRef.current = transcript;
    await prepareLiveProposals();
  }

  async function prepareLiveProposals() {
    const transcript = pendingLiveTranscriptRef.current;
    if (!transcript) return;
    const request = new AbortController(); liveProposalRequestRef.current = request;
    setCanRetryLiveProposals(false); setReviewingLiveProposals(true); setInterviewError("");
    try {
      const result = await post<{ proposals: Array<Pick<MemoryProposal, "title" | "text" | "source">> }>("/interview/live/proposals", { transcript }, request.signal);
      if (request.signal.aborted) return;
      const sessionId = activeSessionRef.current ?? newMemoryId("session"); activeSessionRef.current = sessionId;
      const existing = new Set([...memoryRef.current.career.facts.map((fact) => normalizeFact(fact.text)), ...memoryRef.current.proposals.map((fact) => normalizeFact(fact.text))]);
      const candidates = result.proposals.filter((item) => { const key = normalizeFact(item.text); if (existing.has(key)) return false; existing.add(key); return true; })
        .map((item) => ({ ...item, id: newMemoryId("fact"), sessionId, answer: item.source }));
      if (candidates.length) {
        setMemoryProposals((old) => [...old, ...candidates]);
        const next = await commitMemory((state) => candidates.reduce((current, item) => retainPendingFact(current, item, new Date().toISOString()), state));
        setMemoryProposals(pendingInterviewFacts(next));
      }
      pendingLiveTranscriptRef.current = "";
    } catch (cause) {
      if (request.signal.aborted) return;
      setInterviewError(cause instanceof Error ? cause.message : "Could not prepare memory proposals.");
      setCanRetryLiveProposals(true);
    } finally { if (liveProposalRequestRef.current === request) liveProposalRequestRef.current = null; setReviewingLiveProposals(false); }
  }

  function pauseInterview() { if (liveRef.current) { liveRef.current.pause(); setLiveStatus("paused"); } }
  function stopInterview() {
    if (liveRef.current || liveStartRef.current) void endLiveInterview();
  }

  function acceptReviewBatch() {
    const batch = currentReviewBatch(memoryProposals);
    if (!batch.length) return;
    void run(async () => {
      const next = await commitMemory((state) => approveInterviewBatch(state, batch, new Date().toISOString()));
      setApproved(approvedProjects(next)); setMemoryProposals(pendingInterviewFacts(next));
      pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false);
    });
  }

  function discardReviewBatch() {
    const batch = currentReviewBatch(memoryProposals);
    if (!batch.length) return;
    void run(async () => {
      const next = await commitMemory((state) => dismissInterviewBatch(state, batch));
      setMemoryProposals(pendingInterviewFacts(next));
      pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false);
    });
  }

  function removeApprovedProject(projectId: string) {
    void run(async () => {
      const next = await commitMemory((state) => removeCareerProject(state, projectId));
      setApproved(approvedProjects(next)); setJobAlignment(next.opportunities.at(-1)?.alignment ?? null);
      setMemoryProposals(pendingInterviewFacts(next)); setResumeApproved(Boolean(next.career.identity));
      setResumeName(next.career.materials.filter((material) => material.kind === "resume").at(-1)?.label ?? "");
      if (!next.career.identity) setApprovedProfile(null);
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
      setApproved(approvedProjects(next)); setApprovedProfile(reviewed.profile);
      setResumeApproved(true); setStep(2); setStepTwoActivated(true);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.scrollingElement?.scrollTo(0, 0);
        stepTwoHeadingRef.current?.focus({ preventScroll: true });
      }));
      window.setTimeout(() => setStepTwoActivated(false), 1100);
    });
  }

  function addInterviewMemory() {
    setManualError("");
    const title = projectTitle.trim();
    const fact = projectFact.trim();
    if (title.length < 2) { setManualError("Enter a role or accomplishment."); return; }
    if (fact.length < 5) { setManualError("Enter a supporting fact of at least five characters."); return; }
    setBusy(true);
    void (async () => {
      try {
        const next = await commitMemory((state) => approveManualCareerFact(state, title, fact, new Date().toISOString()));
        setApproved(approvedProjects(next));
        setNewProjectId(next.career.projects.find((project) => project.title.toLowerCase() === title.toLowerCase())?.id ?? "");
        setProjectTitle(""); setProjectFact(""); setSavedNotice(true);
      } catch (cause) {
        setManualError(cause instanceof Error ? cause.message : "Could not save this Career Memory entry.");
      } finally { setBusy(false); }
    })();
  }

  function openHudPreview() {
    const dialog = hudDialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.style.left = "50%"; dialog.style.top = "50%"; dialog.style.transform = "translate(-50%, -50%)";
    dialog.showModal();
  }

  function beginHudDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("button")) return;
    const dialog = hudDialogRef.current;
    if (!dialog) return;
    const bounds = dialog.getBoundingClientRect();
    hudDragRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    dialog.style.left = `${bounds.left}px`; dialog.style.top = `${bounds.top}px`; dialog.style.transform = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveHudDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = hudDragRef.current;
    const dialog = hudDialogRef.current;
    if (!drag || !dialog) return;
    dialog.style.left = `${Math.max(0, Math.min(window.innerWidth - dialog.offsetWidth, event.clientX - drag.x))}px`;
    dialog.style.top = `${Math.max(0, Math.min(window.innerHeight - dialog.offsetHeight, event.clientY - drag.y))}px`;
  }

  function stopSpeakerTest() {
    const test = speakerTestRef.current;
    if (!test) return;
    speakerTestRef.current = null;
    test.audio.pause();
    test.audio.removeAttribute("src");
    test.audio.onended = null;
    test.audio.onerror = null;
    test.cancel();
  }

  useEffect(() => () => { stopSpeakerTest(); setSpeakerTesting(false); setSpeakerStatus(""); }, [step]);

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
        setOutputs(devices.filter((device) => device.kind === "audiooutput"));
        setOutputName(devices.find((device) => device.kind === "audiooutput" && device.deviceId === "default")?.label || "System default");
        setMicrophoneStatus("Microphone test running");
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        setMicrophoneStatus("");
      } finally {
        if (meter !== undefined) window.clearInterval(meter);
        setMicrophoneLevel(0);
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
      }
    });
  }

  async function testSpeaker() {
    if (speakerTestRef.current) return;
    setSpeakerStatus("");
    const audio = new Audio("/speaker-test.mp3");
    let settle = () => {};
    const finished = new Promise<"ended" | "cancelled">((resolve, reject) => {
      settle = () => resolve("cancelled");
      audio.onended = () => resolve("ended");
      audio.onerror = () => reject(new Error("Speaker test audio could not play."));
    });
    speakerTestRef.current = { audio, cancel: settle };
    setSpeakerTesting(true);
    try {
      if (outputId) {
        if (typeof audio.setSinkId !== "function") throw new Error("Output selection is unavailable in this desktop WebView. Use the Windows default output.");
        await audio.setSinkId(outputId);
      }
      if (speakerTestRef.current?.audio !== audio) return;
      await audio.play();
      if (speakerTestRef.current?.audio !== audio) return;
      setSpeakerStatus("Playing speaker test");
      if (await finished === "ended" && speakerTestRef.current?.audio === audio) setSpeakerStatus("");
    } catch (cause) {
      if (speakerTestRef.current?.audio === audio) setSpeakerStatus(cause instanceof Error ? cause.message : "Speaker test unavailable.");
    } finally {
      if (speakerTestRef.current?.audio === audio) {
        speakerTestRef.current = null;
        setSpeakerTesting(false);
      }
      audio.pause(); audio.removeAttribute("src");
      audio.onended = null; audio.onerror = null;
    }
  }

  function startOver() {
    if (!window.confirm("Delete all saved Career Memory, proposals, sessions, and opportunities from this device?")) return;
    cancelActive();
    pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false);
    void run(async () => {
      await commitMemory(() => emptyMemoryState());
      activeSessionRef.current = null; setApproved([]); setApprovedProfile(null); setResumeApproved(false); setResumeName(""); setProposal(null);
      setMemoryProposals([]); setTalkSaved(false); setConfirmedOpportunity(null); setOpportunityDraft(null);
      setOpportunityInput(""); setOpportunityPdfName(""); setJobAnalysis(null); setJobAlignment(null); setJobAnswer("");
      setProjectTitle(""); setProjectFact(""); setSavedNotice(false); setMicrophones([]); setMicrophoneId(""); setMicrophoneStatus(""); setStep(1);
      setNewProjectId(""); setMicrophoneLevel(0); setManualError("");
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

  const liveRunning = ["connecting", "listening", "user-speaking", "speaking", "paused"].includes(liveStatus);
  const reviewBatch = currentReviewBatch(memoryProposals);

  return <main className="app-shell">
    {intro && <OpeningSequence onFinish={closeIntro} />}
    <dialog ref={hudDialogRef} className="hud-preview" aria-labelledby="hud-preview-title" aria-describedby="hud-preview-description" onClose={() => { hudDragRef.current = null; hudTriggerRef.current?.focus(); }}>
      <div className="hud-preview-heading" onPointerDown={beginHudDrag} onPointerMove={moveHudDrag} onPointerUp={() => { hudDragRef.current = null; }} onLostPointerCapture={() => { hudDragRef.current = null; }}><h2 id="hud-preview-title">VantSide HUD</h2><button type="button" className="hud-preview-close" onClick={() => hudDialogRef.current?.close()} aria-label="Close HUD preview">×</button></div>
      <p id="hud-preview-description">Mockup: brief cues from approved Career Memory during interview practice.</p>
      <Image src="/hud_overlay.webp" alt="Illustrative simulated interview with VantSide memory cues shown across the top" width={1672} height={941} unoptimized />
    </dialog>
    <div className="page-wrap">
      <header className="topbar"><div className="brand-lockup"><BrandMark small /><span>VantSide</span></div><div className="topbar-actions"><button type="button" className="topbar-delete" onClick={startOver} disabled={busy}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7M10 11v5m4-5v5" /></svg>
        Delete my data
      </button></div></header>
      <section className="journey-heading"><h1>Your experience, when you need it.</h1><p>Build a Career Memory from your resume and conversations. Then use VantSide&apos;s <button ref={hudTriggerRef} type="button" className="hud-preview-trigger" onClick={openHudPreview} aria-haspopup="dialog">HUD<span className="hud-preview-spark" aria-hidden="true">↗</span></button> during an interview.</p></section>
      <nav className="steps-grid" aria-label="Four steps">
        {([1, 2, 3, 4] as Step[]).map((number) => {
          const title = ["Your Resume", "Let's Talk", "The Opportunity", "Your Interview"][number - 1];
          const locked = number === 2 ? !resumeApproved && !hasMemory : number === 3 ? !hasMemory : number === 4 ? !canPractice : false;
          const complete = number === 1 ? resumeApproved : number === 2 ? talkSaved && hasMemory : number === 3 ? !!confirmedOpportunity : false;
          const description = ["Establish your professional background.", "Share deeper experiences to build your Career Memory.", "Explore how your experience connects to a specific job.", "Practice for the role and identify supported strengths and areas to explore."][number - 1];
          return <button key={number} type="button" className={`step-card${step === number ? " active" : ""}${number === 2 && stepTwoActivated ? " step-activated" : ""}`} disabled={locked}
            onClick={() => { if (step === 2 && number > 2 && (reviewBatch.length || liveRunning || reviewingLiveProposals || canRetryLiveProposals)) { setError(liveRunning ? "End the interview and review new facts before continuing." : reviewBatch.length ? "Accept or discard the new facts before continuing." : "Finish or discard the memory review before continuing."); return; } if (step === 2 && number !== 2 && (liveRef.current || liveStartRef.current)) void endLiveInterview(); setStep(number); }} aria-current={step === number ? "step" : undefined}>
            <span className="step-card-top"><span className="step-card-number">0{number}</span>{complete && <span className="step-card-check" aria-label="Complete">✓</span>}{locked && <span className="step-card-lock" aria-label="Locked"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor"/></svg></span>}</span><strong>{title}</strong><span className="step-card-description">{description}</span>
          </button>;
        })}
      </nav>
      <section key={step} className="step-detail" aria-live="polite">
        {error && <p className="step-error" role="alert">{error}</p>}
        {step === 1 && <>
          <div className="detail-heading"><span className="eyebrow">01 / YOUR RESUME</span><h2>Start with what you’ve done.</h2></div>
          <div className="resume-upload">{!resumeName && <label className="file-button primary-upload">Choose PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => selectPdf(event, "resume")} disabled={busy}/></label>}{busy && !resumeName && <span className="resume-processing" role="status"><span className="resume-processing-dots" aria-hidden="true"><i/><i/><i/><i/></span>Analyzing your PDF…</span>}{resumeName && <div className="resume-file"><span aria-hidden="true" className="pdf-icon">PDF</span><strong>{resumeName}</strong><button type="button" className="resume-file-delete" aria-label="Remove resume PDF" title="Remove resume PDF" disabled={busy} onClick={removeResumeSelection}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7M10 11v5m4-5v5"/></svg></button></div>}</div>
          {resumeApproved && !proposal && <div className="approved-resume"><p>{approvedProfile?.profession} · {approvedProfile?.seniority}</p>{approved.filter((project) => project.dates).map((project) => <p key={project.projectId}>{project.title} · {project.dates}</p>)}</div>}
          {proposal && <div className="review-list"><div className="career-summary"><h3>Career Summary</h3>
            <div className="profile-review"><label className="field-label">Profession<input value={proposal.profile.profession} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, profession: event.target.value } }); }}/></label>
            <label className="field-label">Seniority<select value={seniorityChoices.includes(proposal.profile.seniority) ? proposal.profile.seniority : "Other"} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, seniority: event.target.value, senioritySource: undefined } }); }}>{seniorityChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}<option value="Other">Other</option></select>{!seniorityChoices.includes(proposal.profile.seniority) && <input aria-label="Other seniority" value={proposal.profile.seniority === "Other" ? "" : proposal.profile.seniority} maxLength={100} placeholder="Enter seniority" onChange={(event) => setProposal((old) => old && { ...old, profile: { ...old.profile, seniority: event.target.value, senioritySource: undefined } })}/>}</label>
            <label className="field-label career-overview">Career overview<textarea value={proposal.profile.careerSummary} maxLength={500} rows={2} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, profile: { ...old.profile, careerSummary: event.target.value } }); }}/></label></div></div>
            {proposal.projects.map((project, pi) => <div className="review-project" key={project.projectId}>
            <div className="review-project-heading"><label>Role or project<input value={project.title} maxLength={100} onChange={(event) => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, title: event.target.value } : item) }); }}/></label>
            {project.dates && <p className="project-dates"><strong>Dates</strong><span>{project.dates}</span></p>}</div>
            {project.facts.map((fact, fi) => <div className="review-fact" key={fact.id}><label>Fact<textarea value={fact.text} maxLength={400} onChange={(event) => updateFact(pi, fi, event.target.value)} rows={2}/></label><button type="button" className="text-button" onClick={() => { setResumeApproved(false); setProposal((old) => old && { ...old, projects: old.projects.map((item, index) => index === pi ? { ...item, facts: item.facts.filter((_, i) => i !== fi) } : item) }); }}>Remove</button></div>)}
          </div>)}<button className="primary-button" type="button" onClick={approveResume} disabled={busy || resumeApproved}>Approve reviewed facts</button></div>}
        </>}
        {step === 2 && <>
          <div className="detail-heading"><span className="eyebrow">02 / LET’S TALK</span><h2 ref={stepTwoHeadingRef} tabIndex={-1}>Tell the story behind the work.</h2></div>
          <details className="audio-devices" open><summary>Audio setup</summary><div className="audio-device-grid">
            <section className="device-card" aria-label="Microphone setup"><h3>Microphone</h3><label>Input<select value={microphoneId} onPointerDown={() => void revealMicrophones()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void revealMicrophones(); }} onFocus={() => void refreshDevices()} onChange={(event) => setMicrophoneId(event.target.value)}><option value="">System default</option>{microphones.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void testMicrophone()}>Test microphone</button><meter min="0" max="100" value={Math.max(microphoneLevel, liveLevel)} aria-label="Microphone level" /></div>{microphoneStatus && <span className="device-status" role="status">{microphoneStatus}</span>}</section>
            <section className="device-card" aria-label="Speaker setup"><h3>Speaker</h3><label>Output{typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && outputs.length > 0 ? <select value={outputId} onChange={(event) => setOutputId(event.target.value)}><option value="">{outputName}</option>{outputs.filter((device) => device.deviceId !== "default").map((device) => <option value={device.deviceId} key={device.deviceId}>{device.label || "Audio output"}</option>)}</select> : <span className="device-default">{outputName} · System output</span>}</label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={speakerTesting} onClick={() => void testSpeaker()}>Test speaker</button></div>{speakerStatus && <span className="device-status" role="status">{speakerStatus}</span>}</section>
          </div></details>
          <span className="sr-only" id="interview-consent-note">Practice interview. Voice input is processed by external AI services. Start only with everyone&apos;s consent and where recording and AI use are allowed.</span>
          {interviewError && <p className="step-error" role="alert">{interviewError}</p>}
          {canRetryLiveProposals && <div className="inline-actions"><button className="secondary-button" type="button" onClick={() => void prepareLiveProposals()}>Retry memory review</button><button className="text-button" type="button" onClick={() => { pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false); setInterviewError(""); }}>Discard captured answer</button></div>}
          <div className="live-status" role="status" aria-live="polite"><span className={`live-status-dot ${liveStatus}`} aria-hidden="true" /><span>Interview status</span><strong>{({ ready: "Ready", connecting: "Connecting", listening: "Listening", "user-speaking": "You’re speaking", speaking: "Interviewer speaking", paused: "Paused", ended: "Ended", error: "Error" } as const)[liveStatus]}</strong></div>
          <div className="interview-controls">
            {!liveRunning && <button className="primary-button" type="button" disabled={!approvedProfile || canRetryLiveProposals || reviewingLiveProposals} aria-describedby="interview-consent-note" title="Practice only. Voice uses external AI services; start with everyone’s consent." onClick={() => void beginLiveInterview()}>Start Interview</button>}
            {liveStatus === "paused" && <button className="primary-button" type="button" onClick={() => liveRef.current?.resume()}>Resume</button>}
            {["listening", "user-speaking", "speaking"].includes(liveStatus) && <button className="secondary-button" type="button" onClick={pauseInterview}>Pause</button>}
            {liveRunning && <button className="end-interview-button" type="button" onClick={stopInterview} aria-label={`End interview, ${interviewTime(liveElapsed)} elapsed, approximately ${interviewTime(liveSpeakingSeconds)} speaking`} title="Progress reflects approximate speaking time. End Interview is always available."><span>End Interview</span><span className="end-interview-progress" style={{ width: `${Math.min(100, liveSpeakingSeconds / suggestedSpeakingSeconds * 100)}%` }} aria-hidden="true" /></button>}
          </div>
          {liveRunning && <div className="interview-timing"><time aria-label="Elapsed interview time">{interviewTime(liveElapsed)}</time>{interviewEncouragement(liveElapsed) && <span>{interviewEncouragement(liveElapsed)}</span>}</div>}
          <section className="memory-section" aria-labelledby="new-memory-heading">
            <h3 id="new-memory-heading">New from Your Interview</h3>
            {reviewBatch.length ? <>{reviewBatch.map((item) => <div className="review-fact" key={item.id}><p className="eyebrow">PROPOSED · NOT APPROVED</p><strong>{item.title}</strong><label className="field-label">Fact<textarea rows={2} maxLength={300} value={item.text} onChange={(event) => setMemoryProposals((old) => old.map((proposal) => proposal.id === item.id ? { ...proposal, text: event.target.value } : proposal))}/></label></div>)}
              <div className="inline-actions"><button className="primary-button" type="button" disabled={busy || reviewingLiveProposals || canRetryLiveProposals} onClick={acceptReviewBatch}>Accept Facts</button><button className="secondary-button dismiss-button" type="button" disabled={busy || reviewingLiveProposals} onClick={discardReviewBatch}>Discard</button></div></> : <p className="detail-note">No new facts to review.</p>}
          </section>
          <section className="memory-section" aria-labelledby="career-memory-heading">
            <h3 id="career-memory-heading">Career Memory <span className="memory-approved-label">Approved · Saved</span></h3>
            {approved.map((project) => <div className={`memory-project${newProjectId === project.projectId ? " memory-new" : ""}`} key={project.projectId}><div className="memory-row"><strong>{project.title}</strong><button type="button" className="text-button" onClick={() => removeApprovedProject(project.projectId)}>Remove</button></div>{project.facts.map((fact) => <p className="memory-fact" key={fact.id}>{fact.text}</p>)}</div>)}
          </section>
          <section className="memory-section" aria-labelledby="add-memory-heading">
            <h3 id="add-memory-heading">Add Your Own</h3>
            <div className="manual-memory"><label className="field-label">Role or accomplishment<input value={projectTitle} maxLength={100} onChange={(event) => { setProjectTitle(event.target.value); setSavedNotice(false); setManualError(""); }}/></label>
            <label className="field-label">Supporting fact from your own experience<textarea value={projectFact} maxLength={300} rows={2} onChange={(event) => { setProjectFact(event.target.value); setSavedNotice(false); setManualError(""); }}/></label>
            <div className="inline-actions"><button className="secondary-button" type="button" disabled={busy} onClick={addInterviewMemory}>Add to Career Memory</button>{savedNotice && <span className="saved-note" role="status">✓ Saved</span>}</div>{manualError && <p className="step-error" role="alert">{manualError}</p>}</div>
          </section>
          <div className="save-continue"><button className="primary-button" type="button" disabled={!hasMemory || busy || liveRunning || reviewingLiveProposals || canRetryLiveProposals || !!reviewBatch.length} onClick={() => {
            pauseInterview();
            const sessionId = activeSessionRef.current ?? newMemoryId("session"); activeSessionRef.current = sessionId;
            void run(async () => {
              await commitMemory((state) => saveInterviewSession(state, sessionId, new Date().toISOString(), "paused"));
              setTalkSaved(true); setStep(3);
            });
          }}>Save &amp; Continue</button>{!!reviewBatch.length && <span className="detail-note">Accept or discard new facts first.</span>}</div>
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
