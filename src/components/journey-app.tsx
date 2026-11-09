"use client";

import { ChangeEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BrandMark, OpeningSequence, PracticeApp } from "./practice-app";
import { InterviewPracticeApp } from "./interview-practice-app";
import { ConversationalPracticeApp } from "./conversational-practice-app";
import { startLiveInterview, type LiveInterview, type LiveStatus } from "@/lib/live-interview";
import { deduplicateLiveProposals, extractLiveEvidenceProposals, liveEvidenceChunks } from "@/lib/live-evidence";
import { advanceInterviewClock, crossedInterviewMilestone, emptyInterviewClock, interviewClockSeconds, interviewTime, MAX_INTERVIEW_SECONDS } from "@/lib/interview-timing";
import { microphonePassed, microphoneSample, speakerPlaybackCompleted } from "@/lib/audio-test-feedback";
import { startSpeakerTest, type SpeakerTest } from "@/lib/speaker-test";
import { localApiHeaders } from "@/lib/local-api-auth";
import { readJobPdfText } from "@/lib/job-pdf-text";
import { completeGoLiveRound, deleteRound, roundStatusLabels, saveGoLiveSummary, savePracticeReview, saveRound, updateRoundStatus } from "@/lib/interview-rounds";
import { isCurrentOperation, visibleStepError } from "@/lib/step-workflow";
import type { CareerProfile, MemoryProject, Opportunity } from "@/lib/session-schema";
import type { OpportunityAnalysis } from "@/lib/opportunity-analysis";
import { alignCareerFacts, careerMemoryCoverage } from "@/lib/opportunity-analysis";
import { emptyMemoryState, type MemoryState } from "../../backend/career-memory";
import { hasDesktopStorage, loadCareerMemory, saveCareerMemory } from "@/lib/career-memory-storage";
import { approvedProjects, approveInterviewBatch, approveManualCareerFact, approveResumeReview, currentReviewBatch, dismissInterviewBatch,
  confirmOpportunity, newMemoryId, opportunityById, pendingInterviewFacts, removeCareerProject, removeOpportunity, removeResume,
  retainPendingFact, saveInterviewSession, type PendingInterviewFact } from "@/lib/journey-memory";

type Step = 1 | 2 | 3 | 4;
type ResumeProposal = { profile: CareerProfile; projects: MemoryProject[] };
type MemoryProposal = PendingInterviewFact;
type Confirmation = { title: string; description: string; actionLabel: string; onConfirm: () => void };

export function CompanyIcon({ logo }: { logo?: string }) {
  return logo ? <span className="company-icon"><Image src={logo} alt="" width={32} height={32} unoptimized /></span> : null;
}

export function RoundCard({ round, selected, onEdit, onDelete, onStatusChange }: { round: MemoryState["rounds"][number]; selected: boolean; onEdit(): void; onDelete(): void; onStatusChange(status: MemoryState["rounds"][number]["status"]): void }) {
  return <div className={`round-card${selected ? " selected" : ""}`} role="presentation" onClick={(event) => {
    if (!(event.target as Element).closest("button, select, label, a, details")) onEdit();
  }}><button type="button" className="round-item" aria-pressed={selected} onClick={onEdit}>
    <strong>{round.label}</strong>
  </button><div className="round-card-meta"><span className={`round-date${round.interviewDate ? "" : " empty"}`} aria-label={round.interviewDate ? `Interview date ${round.interviewDate}` : "No interview date set"}>{round.interviewDate || "--/--/----"}</span><label className="round-status-control"><span className="sr-only">Status for {round.label}</span><span className="round-status-check" aria-hidden="true">{round.status === "completed" ? "✓" : ""}</span><select value={round.status} onChange={(event) => onStatusChange(event.target.value as MemoryState["rounds"][number]["status"])}>{(Object.entries(roundStatusLabels) as Array<[MemoryState["rounds"][number]["status"], string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{selected && <button type="button" className="selected-card-delete" aria-label={`Delete ${round.label} round`} onClick={onDelete}>×</button>}{(round.interviewerLinkedInUrl || round.interviewerPdf) && <div className="round-card-references">
    {round.interviewerLinkedInUrl && /^https:\/\/(?:www\.)?linkedin\.com\/in\//i.test(round.interviewerLinkedInUrl) && <a href={round.interviewerLinkedInUrl} target="_blank" rel="noopener noreferrer">LinkedIn profile ↗</a>}
    {round.interviewerPdf && <details><summary>View text from {round.interviewerPdf.name}</summary><p>{round.interviewerPdf.text}</p></details>}
  </div>}</div>;
}

function ConfirmationDialog({ confirmation, onClose }: { confirmation: Confirmation | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!confirmation) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    cancel.current?.focus();
  }, [confirmation]);
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-description"
    onClose={() => { onClose(); previousFocus.current?.focus(); }}>
    <h2 id="confirm-title">{confirmation?.title}</h2>
    <p id="confirm-description">{confirmation?.description}</p>
    <div className="confirm-actions"><button ref={cancel} type="button" className="secondary-button" onClick={() => dialog.current?.close()}>Cancel</button>
      <button type="button" className="confirm-delete" onClick={() => { const action = confirmation?.onConfirm; dialog.current?.close(); action?.(); }}>{confirmation?.actionLabel}</button></div>
  </dialog>;
}
const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const seniorityChoices = ["Not specified", "Entry Level", "Junior", "Mid-Level", "Senior", "Staff", "Principal", "Executive"];
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
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    const headers = await localApiHeaders(attempt === 1);
    try { response = await fetch(`${api}${route}`, { method: "POST", headers, body: JSON.stringify(body), signal }); }
    catch (cause) { throw new Error(cause instanceof Error && cause.name === "AbortError" ? "Request cancelled." : "Local practice backend is unreachable. Start the backend and try again."); }
    let result: { error?: string } & T;
    try { result = await response.json(); }
    catch { throw new Error("Local practice backend returned unreadable data. Restart it and try again."); }
    if (response.ok) return result as T;
    if (attempt === 0 && response.status === 403 && result.error === "This practice API only accepts the local VantSide app.") continue;
    if (response.status === 403 && result.error === "This practice API only accepts the local VantSide app.")
      throw new Error("The local app session could not be authorized. Restart VantSide and its backend.");
    throw new Error(result.error ?? "Please try again.");
  }
  throw new Error("The local app session could not be authorized. Restart VantSide and its backend.");
}

export function JourneyApp() {
  const [intro, setIntro] = useState(true);
  const closeIntro = useCallback(() => setIntro(false), []);
  const hudDialogRef = useRef<HTMLDialogElement | null>(null);
  const hudTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hudDragRef = useRef<{ x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageFault, setStorageFault] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const memoryRef = useRef<MemoryState>(emptyMemoryState());
  const revisionRef = useRef<number | null>(null);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeSessionRef = useRef<string | null>(null);
  const [opportunityPdfName, setOpportunityPdfName] = useState("");
  const opportunityPdfRef = useRef<File | null>(null);
  const [opportunitySource, setOpportunitySource] = useState<"text" | "url" | "pdf" | null>(null);
  const [opportunityMethod, setOpportunityMethod] = useState<"text" | "url" | "pdf">("url");
  const [opportunityUrl, setOpportunityUrl] = useState("");
  const [opportunityUrlText, setOpportunityUrlText] = useState("");
  const opportunityRequestRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const [activeOpportunityId, setActiveOpportunityId] = useState<string | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [roundName, setRoundName] = useState("");
  const [roundCustom, setRoundCustom] = useState("");
  const [roundDate, setRoundDate] = useState("");
  const [roundLinkedInUrl, setRoundLinkedInUrl] = useState("");
  const [roundPdf, setRoundPdf] = useState<{ name: string; text: string } | undefined>();
  const [roundNotice, setRoundNotice] = useState("");
  const [roundError, setRoundError] = useState("");
  const [roundSaving, setRoundSaving] = useState(false);
  const roundWriteRef = useRef(false);
  const [rounds, setRounds] = useState<MemoryState["rounds"]>([]);
  const [, refreshBrand] = useState(0);
  const [step, setStep] = useState<Step>(1);
  const [practice, setPractice] = useState<"personal" | "synthetic" | "voice" | null>(null);
  const [resumeName, setResumeName] = useState("");
  const [proposal, setProposal] = useState<ResumeProposal | null>(null);
  const [approved, setApproved] = useState<MemoryProject[]>([]);
  const [approvedProfile, setApprovedProfile] = useState<CareerProfile | null>(null);
  const [resumeApproved, setResumeApproved] = useState(false);
  const [opportunityInput, setOpportunityInput] = useState("");
  const [opportunityDraft, setOpportunityDraft] = useState<Opportunity | null>(null);
  const [jobAnalysis, setJobAnalysis] = useState<OpportunityAnalysis | null>(null);
  const [jobAlignment, setJobAlignment] = useState<{ strengths: Array<{ requirementId: string; factId: string }>; needsEvidence: string[] } | null>(null);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneListAuthorized, setMicrophoneListAuthorized] = useState(false);
  const [microphoneId, setMicrophoneId] = useState("");
  const [microphoneStatus, setMicrophoneStatus] = useState("");
  const [microphoneOutcome, setMicrophoneOutcome] = useState<"pass" | "quiet" | null>(null);
  const [confirmedOpportunity, setConfirmedOpportunity] = useState<Opportunity | null>(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectFact, setProjectFact] = useState("");
  const [talkSaved, setTalkSaved] = useState(false);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | "ready">("ready");
  const liveRef = useRef<LiveInterview | null>(null);
  const liveWallStartedRef = useRef<number | null>(null);
  const endLiveRef = useRef<() => Promise<void>>(async () => {});
  const liveStartRef = useRef<AbortController | null>(null);
  const endingLiveRef = useRef(false);
  const [liveLevel, setLiveLevel] = useState(0);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const liveClockRef = useRef(emptyInterviewClock());
  const lastMilestoneElapsedRef = useRef(0);
  const milestoneDismissRef = useRef<number | null>(null);
  const [milestoneToast, setMilestoneToast] = useState<string | null>(null);
  const [interviewError, setInterviewError] = useState("");
  const pendingLiveTranscriptRef = useRef("");
  const liveProposalRequestRef = useRef<AbortController | null>(null);
  const [canRetryLiveProposals, setCanRetryLiveProposals] = useState(false);
  const [reviewingLiveProposals, setReviewingLiveProposals] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorOwner, setErrorOwner] = useState<Step>(1);
  const [processing, setProcessing] = useState("");
  const [liveProposalResult, setLiveProposalResult] = useState<"idle" | "none" | "ready">("idle");
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
  const [speakerOutcome, setSpeakerOutcome] = useState(false);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const speakerTestRef = useRef<SpeakerTest | null>(null);
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
      setRounds(state.rounds);
      setTalkSaved(state.sessions.some((session) => session.status === "paused" || session.status === "completed"));
      if (lastOpportunity) {
        setActiveOpportunityId(lastOpportunity.id);
        setJobAnalysis(lastOpportunity.requirements ? { company: lastOpportunity.company, role: lastOpportunity.role,
          confidence: "clear", seniority: lastOpportunity.seniority, requirements: lastOpportunity.requirements } : null);
        setJobAlignment(lastOpportunity.alignment ?? null);
        setConfirmedOpportunity({ company: lastOpportunity.company, role: lastOpportunity.role, confidence: "clear" });
        // A saved opportunity is separate from a new intake draft.
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
      memoryRef.current = next; revisionRef.current = revision; setRounds(next.rounds);
      return next;
    });
    writeQueueRef.current = operation.catch(() => undefined);
    return operation;
  }

  function cancelActive() {
    liveProposalRequestRef.current?.abort(); liveProposalRequestRef.current = null;
    liveStartRef.current?.abort(); liveStartRef.current = null;
    const live = liveRef.current; liveRef.current = null; live?.close();
    liveWallStartedRef.current = null;
  }

  useEffect(() => () => {
    liveStartRef.current?.abort(); liveRef.current?.close();
    liveProposalRequestRef.current?.abort();
    if (milestoneDismissRef.current !== null) window.clearTimeout(milestoneDismissRef.current);
  }, []);

  useEffect(() => { endLiveRef.current = endLiveInterview; });

  useEffect(() => {
    const active = ["listening", "user-speaking", "speaking"].includes(liveStatus);
    liveClockRef.current = advanceInterviewClock(liveClockRef.current, liveStatus, Date.now());
    if (!active) return;
    const tick = window.setInterval(() => {
      const { elapsed } = interviewClockSeconds(liveClockRef.current, Date.now());
      const capped = Math.min(elapsed, MAX_INTERVIEW_SECONDS);
      setLiveElapsed(capped);
      const milestone = crossedInterviewMilestone(lastMilestoneElapsedRef.current, capped);
      lastMilestoneElapsedRef.current = capped;
      if (milestone) {
        setMilestoneToast(milestone.message);
        if (milestoneDismissRef.current !== null) window.clearTimeout(milestoneDismissRef.current);
        milestoneDismissRef.current = window.setTimeout(() => {
          setMilestoneToast(null);
          milestoneDismissRef.current = null;
        }, 4000);
      }
      if (elapsed >= MAX_INTERVIEW_SECONDS) void endLiveRef.current();
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
    setLiveProposalResult("idle");
    pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false);
    liveClockRef.current = emptyInterviewClock(); setLiveElapsed(0);
    lastMilestoneElapsedRef.current = 0; setMilestoneToast(null);
    if (milestoneDismissRef.current !== null) {
      window.clearTimeout(milestoneDismissRef.current);
      milestoneDismissRef.current = null;
    }
    liveWallStartedRef.current = null;
    const controller = new AbortController(); liveStartRef.current = controller;
    setLiveStatus("connecting"); setInterviewError("");
    try {
      const live = await startLiveInterview({ microphoneId, outputId, signal: controller.signal,
        openingPrompt: "Begin the Career Memory conversation with one grounded question about the approved career map. Continue naturally until the candidate chooses to stop or the 30-minute session limit is reached.",
        createSession: async (sdp) => post<{ sdp: string }>("/interview/live/session", { sdp, profile: approvedProfile, projects: approved }, controller.signal),
        onStatus: (status) => { setLiveStatus(status); if (status === "ended" && liveRef.current) void endLiveInterview(); }, onLevel: setLiveLevel,
        onError: (message) => {
          if (liveRef.current) void endLiveInterview().then(() => setInterviewError((current) => current || `${message} Captured speech was kept for review.`));
          else { setInterviewError(message); setLiveStatus("error"); }
        },
        onEvidenceLimit: () => { void endLiveRef.current().then(() => setInterviewError((current) => current ||
          "This session reached its in-memory evidence limit. Review the captured facts, then start another interview.")); },
      });
      if (controller.signal.aborted) { live.close(); return; }
      liveRef.current = live;
      liveWallStartedRef.current = Date.now();
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
    if (endingLiveRef.current) return;
    const live = liveRef.current;
    if (!live && !liveStartRef.current) return;
    endingLiveRef.current = true;
    if (milestoneDismissRef.current !== null) {
      window.clearTimeout(milestoneDismissRef.current);
      milestoneDismissRef.current = null;
    }
    setMilestoneToast(null);
    if (!live) liveStartRef.current?.abort();
    liveStartRef.current = null;
    liveRef.current = null;
    setReviewingLiveProposals(true);
    try {
      const transcript = (live ? await live.finish().catch(() => { live.close(); return live.userSpeech(); }) : "").trim();
      setLiveStatus("ended"); setLiveLevel(0);
      const finalTime = interviewClockSeconds(advanceInterviewClock(liveClockRef.current, "ended", Date.now()), Date.now());
      setLiveElapsed(Math.min(finalTime.elapsed, MAX_INTERVIEW_SECONDS));
      console.info("Career Memory extraction", { stage: "capture", durationSeconds: liveWallStartedRef.current === null ? 0 :
        Math.round((Date.now() - liveWallStartedRef.current) / 1000), activeSeconds: finalTime.elapsed,
        ...(live?.evidenceStats() ?? { characters: 0, transcriptEvents: 0, estimatedSpeechSegments: 0 }) });
      liveWallStartedRef.current = null;
      if (transcript.length < 10) { setInterviewError("The session ended, but no reviewable answer was captured."); return; }
      pendingLiveTranscriptRef.current = transcript;
      await prepareLiveProposals();
    } finally { endingLiveRef.current = false; setReviewingLiveProposals(false); }
  }

  async function prepareLiveProposals() {
    const transcript = pendingLiveTranscriptRef.current;
    if (!transcript || liveProposalRequestRef.current) return;
    const request = new AbortController(); liveProposalRequestRef.current = request;
    setCanRetryLiveProposals(false); setReviewingLiveProposals(true); setInterviewError(""); setLiveProposalResult("idle");
    const chunkCount = liveEvidenceChunks(transcript).length;
    let chunkIndex = 0;
    let completedChunks = 0;
    let stage = "provider";
    console.info("Career Memory extraction", { stage: "chunking", characters: transcript.length, chunks: chunkCount });
    try {
      const extracted = await extractLiveEvidenceProposals(transcript, async (chunk) => {
        const index = ++chunkIndex;
        const result = await post<{ proposals: Array<Pick<MemoryProposal, "title" | "text" | "source">>;
          diagnostics?: { modelCandidates: number; schemaRejected: number; sourceRejected: number;
            numberRejected: number; duplicateRejected: number; accepted: number } }>("/interview/live/proposals", { transcript: chunk }, request.signal);
        const counts = result.diagnostics;
        console.info("Career Memory extraction", { stage: "provider-result", chunk: index, chunks: chunkCount,
          characters: chunk.length, modelCandidates: counts?.modelCandidates, schemaRejected: counts?.schemaRejected,
          sourceRejected: counts?.sourceRejected, numberRejected: counts?.numberRejected,
          duplicateRejected: counts?.duplicateRejected, accepted: counts?.accepted, returned: result.proposals.length });
        completedChunks++;
        return result.proposals;
      });
      if (request.signal.aborted) return;
      const sessionId = activeSessionRef.current ?? newMemoryId("session"); activeSessionRef.current = sessionId;
      const deduplicated = deduplicateLiveProposals(extracted, memoryRef.current.career.facts.map((fact) => fact.text),
        memoryRef.current.proposals.map((fact) => fact.text));
      console.info("Career Memory extraction", { stage: "deduplication", providerAccepted: extracted.length,
        alreadyApproved: deduplicated.alreadyApproved, alreadyPending: deduplicated.alreadyPending,
        repeatedInExtraction: deduplicated.repeatedInExtraction, retained: deduplicated.candidates.length });
      const candidates = deduplicated.candidates
        .map((item) => ({ ...item, id: newMemoryId("fact"), sessionId, answer: item.source }));
      stage = "persistence";
      if (candidates.length) {
        setMemoryProposals((old) => [...old, ...candidates]);
        const next = await commitMemory((state) => candidates.reduce((current, item) => retainPendingFact(current, item, new Date().toISOString()), state));
        setMemoryProposals(pendingInterviewFacts(next));
      }
      console.info("Career Memory extraction", { stage: "review-ready", newlyProposed: candidates.length,
        pendingInSession: memoryRef.current.proposals.filter((item) => item.originSessionId === sessionId).length });
      setLiveProposalResult(candidates.length ? "ready" : "none");
      pendingLiveTranscriptRef.current = "";
    } catch (cause) {
      if (request.signal.aborted) return;
      console.warn("Career Memory extraction", { stage, reason: "failed", completedChunks, chunks: chunkCount });
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

  function discardReviewFact(id: string) {
    void run(async () => {
      const item = memoryProposals.find((proposal) => proposal.id === id);
      if (!item) return;
      const next = await commitMemory((state) => dismissInterviewBatch(state, [item]));
      setMemoryProposals(pendingInterviewFacts(next));
    });
  }

  function removeApprovedProject(projectId: string) {
    void run(async () => {
      const next = await commitMemory((state) => removeCareerProject(state, projectId));
      setApproved(approvedProjects(next)); setJobAlignment(opportunityById(next, activeOpportunityId)?.alignment ?? null);
      setMemoryProposals(pendingInterviewFacts(next)); setResumeApproved(Boolean(next.career.identity));
      setResumeName(next.career.materials.filter((material) => material.kind === "resume").at(-1)?.label ?? "");
      if (!next.career.identity) setApprovedProfile(null);
    });
  }

  async function run(task: () => Promise<void>, owner: Step = step, label = "") {
    const operation = ++operationRef.current;
    setBusy(true); setProcessing(label); setErrorOwner(owner); setError("");
    try { await task(); }
    catch (cause) { if (isCurrentOperation(operation, operationRef.current)) setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { if (isCurrentOperation(operation, operationRef.current)) { setBusy(false); setProcessing(""); } }
  }

  function resetRoundEditor() {
    setSelectedRoundId(null); setRoundName(""); setRoundCustom(""); setRoundDate("");
    setRoundLinkedInUrl(""); setRoundPdf(undefined);
  }

  function editRound(round: MemoryState["rounds"][number]) {
    setSelectedRoundId(round.id);
    const choice = ["Recruiter / HR", "Hiring Manager", "Team Member", "Panel Interview", "Executive / Leadership", "Portfolio / Technical Interview"].includes(round.label);
    setRoundName(choice ? round.label : "Other"); setRoundCustom(choice ? "" : round.label);
    setRoundDate(round.interviewDate ?? ""); setRoundLinkedInUrl(round.interviewerLinkedInUrl ?? "");
    setRoundPdf(round.interviewerPdf); setRoundNotice(""); setRoundError("");
  }

  function confirmDeleteRound(round: MemoryState["rounds"][number]) {
    const opportunity = opportunityById(memoryRef.current, round.opportunityId);
    setConfirmation({ title: "Delete interview round?", description: `Delete ${round.label} for ${opportunity?.role ?? "this role"} at ${opportunity?.company ?? "this company"}?`,
      actionLabel: "Delete round", onConfirm: () => void run(async () => {
        await commitMemory((state) => deleteRound(state, round.opportunityId, round.id)); resetRoundEditor(); setRoundNotice("Round deleted.");
      }, 4) });
  }

  function confirmDeleteOpportunity(id: string) {
    const opportunity = opportunityById(memoryRef.current, id);
    if (!opportunity) return;
    setConfirmation({ title: "Delete saved opportunity?", description: `Delete ${opportunity.role} at ${opportunity.company} and its interview rounds? Career Memory stays saved.`,
      actionLabel: "Delete opportunity", onConfirm: () => void run(async () => {
        const next = await commitMemory((state) => removeOpportunity(state, id)); const previous = next.opportunities.at(-1);
        setActiveOpportunityId(previous?.id ?? null); setConfirmedOpportunity(previous ? { company: previous.company, role: previous.role, confidence: "clear" } : null);
        setJobAnalysis(previous?.requirements ? { company: previous.company, role: previous.role, seniority: previous.seniority, confidence: "clear", requirements: previous.requirements } : null);
        resetRoundEditor(); setMemoryProposals(pendingInterviewFacts(next));
      }, 4) });
  }

  async function submitRound() {
    if (roundWriteRef.current || !activeOpportunityId) return;
    roundWriteRef.current = true; setRoundSaving(true); setRoundError(""); setRoundNotice("");
    try {
      const existing = rounds.find((round) => round.id === selectedRoundId && round.opportunityId === activeOpportunityId);
      const label = roundName === "Other" ? roundCustom.trim() : roundName;
      await commitMemory((state) => saveRound(state, activeOpportunityId, label, existing?.interviewer ?? "",
        existing?.status ?? "planned", existing?.id, { interviewDate: roundDate || undefined,
          interviewerLinkedInUrl: roundLinkedInUrl.trim() || undefined, interviewerPdf: roundPdf }));
      resetRoundEditor(); setRoundNotice(existing ? "Changes saved." : "Round added.");
    } catch (cause) { setRoundError(cause instanceof Error ? cause.message : "Could not save this round."); }
    finally { roundWriteRef.current = false; setRoundSaving(false); }
  }

  async function changeRoundStatus(round: MemoryState["rounds"][number], status: MemoryState["rounds"][number]["status"]) {
    setRoundError("");
    try { await commitMemory((state) => updateRoundStatus(state, round.opportunityId, round.id, status, new Date().toISOString())); }
    catch (cause) { setRoundError(cause instanceof Error ? cause.message : "Round status could not be saved."); }
  }

  async function readRoundPdf(file: File | undefined) {
    if (!file) return;
    setRoundError("");
    try {
      if (file.size > 4_000_000 || !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Choose a PDF under 4 MB.");
      const text = await readJobPdfText(file);
      setRoundPdf({ name: file.name.slice(0, 120), text: text.slice(0, 12000) });
    } catch (cause) { setRoundError(cause instanceof Error && cause.message.startsWith("We couldn't read enough")
      ? "We couldn't read enough text from this profile PDF." : cause instanceof Error ? cause.message : "Could not read the PDF."); }
  }

  function resetOpportunityInput(method?: "text" | "url" | "pdf") {
    opportunityRequestRef.current?.abort(); opportunityRequestRef.current = null;
    operationRef.current++; setBusy(false); setProcessing("");
    setErrorOwner(3); setError(""); setOpportunityDraft(null); setJobAnalysis(null); setJobAlignment(null); setOpportunitySource(null); setOpportunityUrlText("");
    if (!method || method === "text") setOpportunityInput("");
    if (!method || method === "url") setOpportunityUrl("");
    if (!method || method === "pdf") { opportunityPdfRef.current = null; setOpportunityPdfName(""); }
    if (!method) setOpportunityMethod("url");
  }

  function selectSavedOpportunity(id: string) {
    const selected = opportunityById(memoryRef.current, id);
    if (!selected) return;
    setActiveOpportunityId(id);
    setConfirmedOpportunity({ company: selected.company, role: selected.role, confidence: "clear" });
    setJobAnalysis(selected.requirements ? { company: selected.company, role: selected.role, seniority: selected.seniority,
      confidence: "clear", requirements: selected.requirements } : null);
    setJobAlignment(selected.alignment ?? null);
    setSelectedRoundId(null); setRoundName(""); setRoundCustom(""); setRoundDate(""); setRoundLinkedInUrl(""); setRoundPdf(undefined); setRoundNotice("");
  }

  function chooseOpportunityMethod(method: "text" | "url" | "pdf") {
    opportunityRequestRef.current?.abort(); opportunityRequestRef.current = null;
    operationRef.current++; setBusy(false); setProcessing("");
    setErrorOwner(3); setError(""); setOpportunityMethod(method);
    setOpportunityDraft(null); setJobAnalysis(null); setJobAlignment(null); setOpportunitySource(null); setOpportunityUrlText("");
  }

  function selectPdf(event: ChangeEvent<HTMLInputElement>, kind: "resume" | "opportunity") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 4_000_000) {
      setErrorOwner(kind === "resume" ? 1 : 3);
      setError("Choose a PDF under 4 MB."); return;
    }
    if (kind === "opportunity") {
      chooseOpportunityMethod("pdf"); opportunityPdfRef.current = file; setOpportunityPdfName(file.name);
      setOpportunityDraft(null); setJobAnalysis(null); setJobAlignment(null);
      return;
    }
    void run(async () => {
      const data = await fileData(file);
      const filename = file.name.length > 120 ? `${file.name.slice(0, 116)}.pdf` : file.name;
      const result = await post<{ proposal: ResumeProposal }>("/extract-resume", { filename, data });
      setResumeName(file.name); setProposal(result.proposal); setResumeApproved(false);
    });
  }

  async function analyzeDescription() {
    const controller = new AbortController(); opportunityRequestRef.current = controller;
    try {
    const careerFacts = approved.flatMap((project) => project.facts.map((fact) => ({ id: fact.id, text: fact.text }))).slice(0, 20);
    let input: object;
    let sourceText = "";
    if (opportunityMethod === "pdf") {
      const file = opportunityPdfRef.current;
      if (!file) throw new Error("Choose a job description PDF to analyze.");
      const text = await readJobPdfText(file);
      if (controller.signal.aborted) return;
      sourceText = text;
      input = { text, careerFacts };
    } else if (opportunityMethod === "url") {
      const extracted = await post<{ text: string; url: string }>("/extract-job-url", { url: opportunityUrl.trim() }, controller.signal);
      if (controller.signal.aborted) return;
      sourceText = extracted.text;
      input = { text: sourceText, careerFacts };
    }
    else input = { text: opportunityInput, careerFacts };
    if ("text" in input) {
      const submitted = String(input.text);
      console.info("Opportunity analysis submitted", { mode: opportunityMethod, characters: submitted.length,
        words: submitted.trim().split(/\s+/).filter(Boolean).length });
    }
    const result = await post<{ analysis: OpportunityAnalysis; alignment: NonNullable<typeof jobAlignment> }>("/analyze-opportunity", input, controller.signal);
    if (controller.signal.aborted) return;
    setJobAnalysis(result.analysis); setJobAlignment(result.alignment);
    setOpportunityDraft({ company: result.analysis.company, role: result.analysis.role, confidence: result.analysis.confidence });
    setOpportunitySource(opportunityMethod);
    setOpportunityUrlText(sourceText);
    } finally { if (opportunityRequestRef.current === controller) opportunityRequestRef.current = null; }
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
    if (!projects.length) { setErrorOwner(1); setError("Keep at least one source-backed fact to approve."); return; }
    if (!proposal || proposal.profile.profession.trim().length < 2 || proposal.profile.seniority.trim().length < 2 || proposal.profile.careerSummary.trim().length < 10) {
      setErrorOwner(1); setError("Review the profession, seniority, and career overview before approving."); return;
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
    test.stop();
  }

  useEffect(() => () => { stopSpeakerTest(); setSpeakerTesting(false); setSpeakerStatus(""); }, [step]);

  async function testMicrophone() {
    setMicrophoneOutcome(null); setMicrophoneStatus("");
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true });
      let context: AudioContext | null = null;
      let meter: number | undefined;
      let streak = 0; let passed = false;
      try {
        context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024; source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        meter = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
          const level = Math.min(100, Math.round(rms * 400));
          setMicrophoneLevel(level);
          streak = microphoneSample(level, streak);
          if (microphonePassed(streak)) passed = true;
        }, 80);
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicrophones(devices.filter((device) => device.kind === "audioinput"));
        setOutputs(devices.filter((device) => device.kind === "audiooutput"));
        setOutputName(devices.find((device) => device.kind === "audiooutput" && device.deviceId === "default")?.label || "System default");
        setMicrophoneStatus("Speak to test your microphone…");
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        setMicrophoneOutcome(passed ? "pass" : "quiet");
        setMicrophoneStatus(passed ? "Input detected" : "Input was too quiet. Check your microphone and try again.");
      } finally {
        if (meter !== undefined) window.clearInterval(meter);
        setMicrophoneLevel(0);
        stream.getTracks().forEach((track) => track.stop());
        if (context) await context.close();
      }
    } catch (cause) { setMicrophoneStatus(cause instanceof Error ? cause.message : "Microphone test failed."); }
    finally { setBusy(false); }
  }

  async function testSpeaker() {
    if (speakerTestRef.current) return;
    setSpeakerStatus(""); setSpeakerOutcome(false);
    const test = startSpeakerTest(outputId);
    speakerTestRef.current = test;
    setSpeakerTesting(true);
    try {
      setSpeakerStatus("Playing speaker test");
      if (speakerPlaybackCompleted(await test.finished) && speakerTestRef.current === test) { setSpeakerStatus("Playback completed"); setSpeakerOutcome(true); }
    } catch (cause) {
      if (speakerTestRef.current === test) setSpeakerStatus(cause instanceof Error ? cause.message : "Speaker test unavailable.");
    } finally {
      if (speakerTestRef.current === test) {
        speakerTestRef.current = null;
        setSpeakerTesting(false);
      }
    }
  }

  function startOver() {
    setConfirmation({ title: "Delete all saved data?", description: "This removes Career Memory, proposals, sessions, and opportunities from this device.", actionLabel: "Delete my data", onConfirm: deleteAllData });
  }

  function deleteAllData() {
    cancelActive();
    pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false);
    void run(async () => {
      await commitMemory(() => emptyMemoryState());
      activeSessionRef.current = null; setApproved([]); setApprovedProfile(null); setResumeApproved(false); setResumeName(""); setProposal(null);
      setMemoryProposals([]); setTalkSaved(false); setConfirmedOpportunity(null); setActiveOpportunityId(null); setSelectedRoundId(null); setOpportunityDraft(null);
      opportunityPdfRef.current = null; setOpportunitySource(null); setOpportunityMethod("url");
      setOpportunityInput(""); setOpportunityUrl(""); setOpportunityUrlText(""); setOpportunityPdfName(""); setJobAnalysis(null); setJobAlignment(null);
      setProjectTitle(""); setProjectFact(""); setSavedNotice(false); setMicrophones([]); setMicrophoneId(""); setMicrophoneStatus(""); setStep(1);
      setNewProjectId(""); setMicrophoneLevel(0); setManualError("");
    });
  }

  function removeResumeSelection() {
    if (resumeApproved) {
      setConfirmation({ title: "Remove this resume?", description: "Facts supported only by this resume will be removed. Independently supported Career Memory remains.", actionLabel: "Remove resume", onConfirm: removeApprovedResume });
      return;
    }
    if (!resumeApproved) {
      const previous = memoryRef.current.career.materials.filter((material) => material.kind === "resume").at(-1);
      setResumeName(previous?.label ?? ""); setResumeApproved(Boolean(previous && memoryRef.current.career.identity)); setProposal(null);
      return;
    }
  }

  function removeApprovedResume() {
    void run(async () => {
      const next = await commitMemory(removeResume);
      cancelActive(); activeSessionRef.current = null;
      setApproved(approvedProjects(next)); setJobAlignment(opportunityById(next, activeOpportunityId)?.alignment ?? null);
      setApprovedProfile(null); setResumeApproved(false); setResumeName(""); setProposal(null); setStep(1);
    });
  }

  const approvedFacts = approved.flatMap((project) => project.facts);
  const editingRound = rounds.find((round) => round.id === selectedRoundId && round.opportunityId === activeOpportunityId);
  const roundDirty = !!editingRound && (editingRound.label !== (roundName === "Other" ? roundCustom.trim() : roundName)
    || (editingRound.interviewDate ?? "") !== roundDate || (editingRound.interviewerLinkedInUrl ?? "") !== roundLinkedInUrl.trim()
    || (editingRound.interviewerPdf?.text ?? "") !== (roundPdf?.text ?? "")
    || (editingRound.interviewerPdf?.name ?? "") !== (roundPdf?.name ?? ""));
  const interviewActionHint = !activeOpportunityId && !selectedRoundId ? "Select an opportunity and interview round."
    : !activeOpportunityId ? "Select an opportunity." : !selectedRoundId ? "Select an interview round." : undefined;
  const coverage = jobAnalysis ? careerMemoryCoverage(jobAnalysis, approvedFacts,
    jobAlignment ? alignCareerFacts(jobAnalysis, approvedFacts) : null) : null;
  if (!loaded) return <main className="app-shell">{intro && <OpeningSequence onFinish={closeIntro} />}<div className="page-wrap" role="status">Loading Career Memory…</div></main>;
  if (storageFault) return <main className="app-shell"><div className="page-wrap" role="alert">{storageFault}</div></main>;

  if (practice === "personal") {
    const selected = opportunityById(memoryRef.current, activeOpportunityId);
    const selectedRound = rounds.find((round) => round.id === selectedRoundId && round.opportunityId === activeOpportunityId);
    if (!selected) return <main className="app-shell"><div className="page-wrap" role="alert">The selected opportunity is no longer available. <button type="button" className="text-button" onClick={() => setPractice(null)}>Return to your steps</button></div></main>;
    return <InterviewPracticeApp projects={approved} opportunity={{ company: selected.company, role: selected.role,
      roundLabel: selectedRound?.label, interviewer: selectedRound?.interviewer,
      requirements: selected.requirements, preparationQuestions: selected.preparationQuestions }} onBack={() => setPractice(null)}
      summaryStorage={selectedRound ? { saved: selectedRound.goLiveSummary, write: async (summary) => {
        await commitMemory((state) => saveGoLiveSummary(state, selected.id, selectedRound.id, summary));
      } } : undefined}
      onCompleted={async () => { if (!selectedRound) return;
        await commitMemory((state) => completeGoLiveRound(state, selected.id, selectedRound.id, true, new Date().toISOString())); }} />;
  }
  if (practice === "voice") {
    const selected = opportunityById(memoryRef.current, activeOpportunityId);
    if (!selected) return <main className="app-shell"><div className="page-wrap" role="alert">Select a saved opportunity. <button type="button" onClick={() => setPractice(null)}>Back</button></div></main>;
    const round = rounds.find((item) => item.id === selectedRoundId && item.opportunityId === selected.id);
    const facts = new Set(memoryRef.current.career.facts.map((item) => item.id));
    return <ConversationalPracticeApp profile={approvedProfile} projects={approved} context={{ company: selected.company, role: selected.role,
      round: round?.label ?? "General interview", description: selected.description, requirements: selected.requirements?.map((item) => item.text) ?? [],
      hudRequirements: selected.requirements, preparationQuestions: selected.preparationQuestions,
      strengths: selected.alignment?.strengths.filter((item) => facts.has(item.factId)).map((item) => selected.requirements?.find((requirement) => requirement.id === item.requirementId)?.text).filter((item): item is string => !!item) ?? [],
      areas: selected.alignment?.needsEvidence.map((id) => selected.requirements?.find((item) => item.id === id)?.text).filter((item): item is string => !!item) ?? [] }}
      savedReview={round?.practiceReview ?? null} savedPending={pendingInterviewFacts(memoryRef.current).filter((item) => item.roundId === round?.id)}
      onSaveReview={async (review) => { if (!round) throw new Error("Select an interview round to save this review.");
        await commitMemory((state) => savePracticeReview(state, selected.id, round.id, review)); }}
      onCompleted={async () => { if (!round) return;
        await commitMemory((state) => updateRoundStatus(state, selected.id, round.id, "completed", new Date().toISOString())); }}
      onBack={() => setPractice(null)} onProposals={async (items) => {
        const sessionId = newMemoryId("session");
        const existing = new Set([...memoryRef.current.career.facts.map((item) => normalizeFact(item.text)),
          ...memoryRef.current.proposals.map((item) => normalizeFact(item.text))]);
        const proposals = items.filter((item) => { const key = normalizeFact(item.text); if (existing.has(key)) return false; existing.add(key); return true; })
          .map((item) => ({ ...item, id: newMemoryId("fact"), sessionId, answer: item.source, opportunityId: selected.id, roundId: round?.id }));
        if (!proposals.length) throw new Error("These experiences are already in Career Memory.");
        const next = await commitMemory((state) => proposals.reduce((current, item) => retainPendingFact(current, item, new Date().toISOString()), state));
        setMemoryProposals(pendingInterviewFacts(next));
        return pendingInterviewFacts(next).filter((item) => item.sessionId === sessionId);
      }} onApprove={async (items) => {
        const next = await commitMemory((state) => approveInterviewBatch(state, items, new Date().toISOString()));
        setApproved(approvedProjects(next)); setMemoryProposals(pendingInterviewFacts(next));
      }} onDiscard={async (items) => {
        const next = await commitMemory((state) => dismissInterviewBatch(state, items));
        setMemoryProposals(pendingInterviewFacts(next));
      }} />;
  }
  if (practice) return <PracticeApp onBack={() => setPractice(null)} />;

  const liveRunning = ["connecting", "listening", "user-speaking", "speaking", "paused"].includes(liveStatus);
  const reviewBatch = currentReviewBatch(memoryProposals);

  return <main className="app-shell">
    {intro && <OpeningSequence onFinish={closeIntro} />}
    <ConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    <dialog ref={hudDialogRef} className="hud-preview" aria-labelledby="hud-preview-title" aria-describedby="hud-preview-description" onClose={() => { hudDragRef.current = null; hudTriggerRef.current?.focus(); }}>
      <div className="hud-preview-heading" onPointerDown={beginHudDrag} onPointerMove={moveHudDrag} onPointerUp={() => { hudDragRef.current = null; }} onLostPointerCapture={() => { hudDragRef.current = null; }}><h2 id="hud-preview-title">VantSide HUD</h2><button type="button" className="hud-preview-close" onClick={() => hudDialogRef.current?.close()} aria-label="Close HUD preview">×</button></div>
       <p id="hud-preview-description" className="sr-only">Illustrative interview preview showing Career Memory cues.</p>
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
          const locked = number === 2 ? !resumeApproved && !hasMemory : number === 3 ? !hasMemory : number === 4 ? !hasMemory : false;
          const complete = number === 1 ? resumeApproved : number === 2 ? talkSaved && hasMemory : number === 3 ? !!confirmedOpportunity : false;
          const description = ["Establish your professional background.", "Share deeper experiences to build your Career Memory.", "Explore how your experience connects to a specific job.", "Practice for the role and identify supported strengths and areas to explore."][number - 1];
          return <button key={number} type="button" className={`step-card${step === number ? " active" : ""}${number === 2 && stepTwoActivated ? " step-activated" : ""}`} disabled={locked}
             onClick={() => { if (step === 2 && number > 2 && (reviewBatch.length || liveRunning || reviewingLiveProposals || canRetryLiveProposals)) { setErrorOwner(2); setError(liveRunning ? "End the interview and review new facts before continuing." : reviewBatch.length ? "Accept or discard the new facts before continuing." : "Finish or discard the memory review before continuing."); return; } if (step === 3 && number !== 3 && opportunityRequestRef.current) { opportunityRequestRef.current.abort(); opportunityRequestRef.current = null; operationRef.current++; setBusy(false); setProcessing(""); } if (step === 2 && number !== 2 && (liveRef.current || liveStartRef.current)) void endLiveInterview(); setStep(number); }} aria-current={step === number ? "step" : undefined}>
            <span className="step-card-top"><span className="step-card-number">0{number}</span>{complete && <span className="step-card-check" aria-label="Complete">✓</span>}{locked && <span className="step-card-lock" aria-label="Locked"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor"/></svg></span>}</span><strong>{title}</strong><span className="step-card-description">{description}</span>
          </button>;
        })}
      </nav>
      <section key={step} className="step-detail" aria-live="polite">
        {visibleStepError(error, errorOwner, step) && <p className="step-error" role="alert">{error}</p>}
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
             <section className="device-card" aria-label="Microphone setup"><h3>Microphone</h3><label>Input<select value={microphoneId} onPointerDown={() => void revealMicrophones()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void revealMicrophones(); }} onFocus={() => void refreshDevices()} onChange={(event) => { setMicrophoneId(event.target.value); setMicrophoneOutcome(null); setMicrophoneStatus(""); }}><option value="">System default</option>{microphones.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void testMicrophone()}>Test microphone</button><meter min="0" max="100" value={Math.max(microphoneLevel, liveLevel)} aria-label="Microphone level" /></div>{microphoneStatus && <span className="device-status" role="status"><span className={microphoneOutcome === "pass" ? "test-check" : microphoneOutcome === "quiet" ? "test-fail" : ""} aria-hidden="true">{microphoneOutcome === "pass" ? "✓" : microphoneOutcome === "quiet" ? "×" : ""}</span>{microphoneStatus}</span>}</section>
             <section className="device-card" aria-label="Speaker setup"><h3>Speaker</h3><label>Output{typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && outputs.length > 0 ? <select value={outputId} onChange={(event) => { setOutputId(event.target.value); setSpeakerOutcome(false); setSpeakerStatus(""); }}><option value="">{outputName}</option>{outputs.filter((device) => device.deviceId !== "default").map((device) => <option value={device.deviceId} key={device.deviceId}>{device.label || "Audio output"}</option>)}</select> : <span className="device-default">{outputName} · System output</span>}</label><div className="device-card-actions"><button type="button" className="secondary-button" onClick={() => { if (speakerTesting) { stopSpeakerTest(); setSpeakerTesting(false); setSpeakerStatus(""); setSpeakerOutcome(false); } else void testSpeaker(); }}>{speakerTesting ? "Stop" : "Test speaker"}</button></div>{speakerStatus && <span className="device-status" role="status">{speakerOutcome && <span className="test-check" aria-hidden="true">✓</span>}{speakerStatus}</span>}</section>
          </div></details>
          <span className="sr-only" id="interview-consent-note">Practice interview. Voice input is processed by external AI services. Start only with everyone&apos;s consent and where recording and AI use are allowed.</span>
          {interviewError && <p className="step-error" role="alert">{interviewError}</p>}
          {canRetryLiveProposals && <div className="inline-actions"><button className="secondary-button" type="button" onClick={() => void prepareLiveProposals()}>Retry memory review</button><button className="text-button" type="button" onClick={() => { pendingLiveTranscriptRef.current = ""; setCanRetryLiveProposals(false); setInterviewError(""); }}>Discard captured answer</button></div>}
          {!reviewingLiveProposals && liveProposalResult === "none" && <p className="detail-note" role="status">No new facts were found in this conversation. Your approved Career Memory is unchanged.</p>}
          <div className="live-status" role="status" aria-live="polite"><span className={`live-status-dot ${liveStatus}`} aria-hidden="true" /><span>Interview status</span><strong>{({ ready: "Ready", connecting: "Connecting", listening: "Listening", "user-speaking": "You’re speaking", speaking: "Interviewer speaking", paused: "Paused", ended: "Ended", error: "Error" } as const)[liveStatus]}</strong></div>
          <div className="interview-controls">
             {!liveRunning && <button className="primary-button" type="button" disabled={!approvedProfile || canRetryLiveProposals || reviewingLiveProposals} aria-describedby="interview-consent-note" title="Practice only. Voice uses external AI services; start with everyone’s consent." onClick={() => void beginLiveInterview()}>{liveStatus === "ended" ? "Start Another Interview" : "Start Interview"}</button>}
            {liveStatus === "paused" && <button className="primary-button" type="button" onClick={() => liveRef.current?.resume()}>Resume</button>}
            {["listening", "user-speaking", "speaking"].includes(liveStatus) && <button className="secondary-button" type="button" onClick={pauseInterview}>Pause</button>}
             {liveRunning && <button className="end-interview-button" type="button" onClick={stopInterview} aria-label={`End interview, ${interviewTime(liveElapsed)} elapsed`}><span>End Interview</span></button>}
          </div>
           {(liveRunning || liveStatus === "ended") && <div className="interview-timing"><time aria-label="Elapsed interview time">{interviewTime(liveElapsed)}</time><div className="interview-timeline" role="img" aria-label="Interview progress toward the 30-minute maximum, with milestones at 3 and 10 minutes"><span className="interview-timeline-fill" style={{ width: `${Math.min(100, liveElapsed / MAX_INTERVIEW_SECONDS * 100)}%` }}/><i style={{ left: "10%" }}/><i style={{ left: "33.33%" }}/><i style={{ left: "100%" }}/></div><span className="interview-milestones">30 min (max)</span>{milestoneToast && <span className="interview-encouragement" role="status" aria-live="polite">{milestoneToast}</span>}</div>}
          {reviewingLiveProposals && <div className="resume-processing interview-processing" role="status" aria-live="polite"><span className="resume-processing-dots" aria-hidden="true"><i/><i/><i/><i/></span><span><strong>Analyzing your interview…</strong><br/>Building your Career Memory.</span></div>}
          <section className="memory-section" aria-labelledby="new-memory-heading">
            <h3 id="new-memory-heading">New from Your Interview</h3>
             {reviewBatch.length ? <><p className="detail-note">Proposed from your conversation. Expand an item to review or edit the fact and its original evidence before accepting.</p>{reviewBatch.map((item) => <div className="review-fact review-pending-fact" key={item.id}><div className="review-pending-heading"><strong>{item.title}</strong><button type="button" className="pending-delete" aria-label={`Discard proposed fact: ${item.title}`} title="Discard this fact" disabled={busy} onClick={() => discardReviewFact(item.id)}>×</button></div><details className="review-pending-details"><summary>Show fact and supporting quote</summary><label className="field-label">Proposed Career Memory fact<textarea rows={2} maxLength={300} value={item.text} onChange={(event) => setMemoryProposals((old) => old.map((proposal) => proposal.id === item.id ? { ...proposal, text: event.target.value } : proposal))}/></label><p className="review-evidence-label">Original spoken evidence</p><blockquote>{item.source}</blockquote></details></div>)}
               <div className="inline-actions"><button className="primary-button" type="button" disabled={busy || reviewingLiveProposals || canRetryLiveProposals} onClick={acceptReviewBatch}>Accept Facts</button><button className="secondary-button dismiss-button" type="button" disabled={busy || reviewingLiveProposals} onClick={discardReviewBatch}>Discard All Facts</button></div></> : <p className="detail-note">No new facts to review.</p>}
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
           <div className="opportunity-inputs" role="radiogroup" aria-label="Job description source">
             <label className={`opportunity-input-choice${opportunityMethod === "url" ? " selected" : ""}`}><input type="radio" name="job-source" checked={opportunityMethod === "url"} onChange={() => chooseOpportunityMethod("url")}/><span>Job posting URL</span></label>
             {opportunityMethod === "url" && <label className="field-label opportunity-url-field">Job posting URL<input type="url" value={opportunityUrl} maxLength={2000} placeholder="https://…" disabled={busy} onChange={(event) => { setOpportunityUrl(event.target.value); setOpportunityDraft(null); setJobAnalysis(null); setJobAlignment(null); setError(""); }}/></label>}
             <label className={`opportunity-input-choice${opportunityMethod === "text" ? " selected" : ""}`}><input type="radio" name="job-source" checked={opportunityMethod === "text"} onChange={() => chooseOpportunityMethod("text")}/><span>Paste a job description</span></label>
             {opportunityMethod === "text" && <><textarea aria-label="Job description text" value={opportunityInput} maxLength={15000} rows={6} disabled={busy} onChange={(event) => { setOpportunityInput(event.target.value); setOpportunityDraft(null); setJobAnalysis(null); setError(""); }}/>{!!opportunityInput && <button type="button" className="text-button input-clear" onClick={() => resetOpportunityInput("text")}>Clear description</button>}</>}
             <label className={`opportunity-input-choice${opportunityMethod === "pdf" ? " selected" : ""}`}><input type="radio" name="job-source" checked={opportunityMethod === "pdf"} onChange={() => chooseOpportunityMethod("pdf")}/><span>Upload a job-description PDF</span></label>
             {opportunityMethod === "pdf" && <div className="opportunity-pdf"><label className="file-button">Upload Job Description PDF<input type="file" accept="application/pdf,.pdf" disabled={!!opportunityPdfRef.current} onChange={(event) => selectPdf(event, "opportunity")}/></label>{opportunityPdfName && <div className="opportunity-pdf-selected"><span className="detail-note">{opportunityPdfName}{!opportunityPdfRef.current ? " · Choose again to analyze" : ""}</span><button type="button" className="resume-file-delete" aria-label="Remove selected job description PDF" title="Remove PDF" onClick={() => resetOpportunityInput("pdf")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7M10 11v5m4-5v5"/></svg></button></div>}</div>}
           </div>
           <div className="inline-actions opportunity-analyze"><button type="button" className="primary-button" disabled={busy || (!!jobAnalysis && !!opportunitySource) || (opportunityMethod === "url" && !opportunityUrl.trim()) || (opportunityMethod === "text" && opportunityInput.trim().length < 30) || (opportunityMethod === "pdf" && !opportunityPdfRef.current)} onClick={() => void run(analyzeDescription, 3, opportunityMethod === "pdf" ? "Reading PDF and analyzing description…" : opportunityMethod === "url" ? "Reading posting and analyzing description…" : "Analyzing description…")}>Analyze Description</button>{(opportunityInput || opportunityUrl || opportunityPdfName || opportunityDraft) && <button type="button" className="secondary-button" disabled={busy} onClick={() => resetOpportunityInput()}>Start Over</button>}{busy && processing && <span className="resume-processing" role="status"><span className="resume-processing-dots" aria-hidden="true"><i/><i/><i/><i/></span>{processing}</span>}</div>
          {opportunityDraft && <section className="opportunity-review opportunity-section"><h3>Company and Role</h3><p className="detail-note">{opportunityDraft.confidence === "uncertain" || !opportunityDraft.company || !opportunityDraft.role ? "Check the missing or uncertain details before saving." : "Check these details before saving."}</p>
            <label className="field-label">Company<input value={opportunityDraft.company} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, company: event.target.value, confidence: "uncertain" })}/></label>
            {!opportunityDraft.company && <button type="button" className="text-button" onClick={() => setOpportunityDraft({ ...opportunityDraft, company: "Not specified", confidence: "uncertain" })}>Company not listed</button>}
            <label className="field-label">Role<input value={opportunityDraft.role} maxLength={100} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, role: event.target.value })}/></label>
          </section>}
          {jobAnalysis && <div className="job-analysis">{!opportunityDraft && confirmedOpportunity && <section className="opportunity-section"><h3>Company and Role</h3><p>{confirmedOpportunity.role} · {confirmedOpportunity.company}</p></section>}
            <section className="opportunity-section"><h3>What Matters for This Opportunity</h3>{jobAnalysis.seniority && <p>Seniority stated: {jobAnalysis.seniority}</p>}
            {jobAnalysis.requirements.map((item) => <div key={item.id} className="job-requirement"><strong>{item.kind === "required" ? "Required qualification or skill" : item.kind === "preferred" ? "Preferred" : item.kind === "domain" ? "Domain experience" : "Responsibility"}</strong> · {item.text}</div>)}</section>
            <section className="opportunity-section coverage-section"><h3>Career Memory Coverage</h3>
            {coverage?.percentage === null ? <p className="detail-note">Coverage will appear when the description has assessable requirements.</p> : coverage && <div className="coverage-summary"><strong>{coverage.percentage}%</strong><span>{coverage.supported} of {coverage.total} distinct requirements supported.</span><div className="coverage-track" role="progressbar" aria-label="Career Memory evidence coverage" aria-valuenow={coverage.percentage} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${coverage.percentage}%` }}/></div></div>}
            {coverage && coverage.percentage !== null && <div className="coverage-columns"><div><h4>Strengths</h4>{!coverage.strengths.length && <p className="detail-note">No approved memory links found yet.</p>}{coverage.strengths.map(({ requirement, factId }) => { const fact = approvedFacts.find((item) => item.id === factId); return fact ? <div className="coverage-item" key={requirement.id}><strong>{requirement.text}</strong><p>{fact.text.length > 140 ? `${fact.text.slice(0, 137).trimEnd()}…` : fact.text}</p><details><summary>View approved fact and source</summary><p>{fact.text}</p><p>{fact.source}</p></details></div> : null; })}</div><div><h4>Areas to Explore</h4>{!coverage.areas.length && <p className="detail-note">All assessed requirements have recorded support.</p>}{coverage.areas.map(({ requirement, level, factId }) => <div className="coverage-item" key={requirement.id}><strong>{requirement.text}</strong>{level === "partial" && <p className="detail-note">Possible connection to discuss</p>}<details><summary>View context</summary><p>From the job description: {requirement.sourceExcerpt}</p>{factId && <p>Related approved memory: {approvedFacts.find((fact) => fact.id === factId)?.text}</p>}</details></div>)}</div></div>}
            </section>
          </div>}
          {(opportunityDraft || confirmedOpportunity) && <div className="opportunity-actions">{opportunityDraft && <button type="button" className="primary-button" disabled={!opportunityDraft.company.trim() || !opportunityDraft.role.trim() || !jobAnalysis?.requirements.length || busy} onClick={() => void run(async () => {
             const description = opportunitySource === "pdf" ? `PDF: ${opportunityPdfName}` : opportunitySource === "url" ? opportunityUrlText : opportunityInput.trim();
             const sourceLabel = opportunitySource === "pdf" ? opportunityPdfName : opportunitySource === "url" ? opportunityUrl.trim() : "Pasted job description";
             const next = await commitMemory((state) => confirmOpportunity(state, opportunityDraft, description, new Date().toISOString(), jobAnalysis ?? undefined, jobAlignment ?? undefined, sourceLabel));
            const saved = next.opportunities.find((item) => item.company === opportunityDraft.company.trim() && item.role === opportunityDraft.role.trim() && item.description === description);
            if (!saved) throw new Error("Opportunity was saved but could not be selected. Reopen the app to restore it.");
            setActiveOpportunityId(saved.id); setConfirmedOpportunity(opportunityDraft); setOpportunityDraft(null);
            void post<{ logoDataUrl?: string }>("/company-brand", { company: saved.company,
              ...(opportunitySource === "url" ? { sourceUrl: sourceLabel } : { sourceText: opportunitySource === "pdf" ? opportunityUrlText : opportunityInput }) })
              .then(async (brand) => { if (!brand.logoDataUrl) return; await commitMemory((state) => ({ ...state,
                opportunities: state.opportunities.map((item) => item.id === saved.id ? { ...item, brandLogoDataUrl: brand.logoDataUrl } : item) })); refreshBrand((value) => value + 1); })
              .catch(() => undefined);
          }, 3, "Saving opportunity…")}>Save Opportunity</button>}
          {opportunityDraft && !jobAnalysis?.requirements.length && <p className="detail-note">Keep at least one requirement from the job description before saving.</p>}
          {confirmedOpportunity && <div className="saved-opportunity"><span className="detail-note" role="status">Saved opportunity: <strong>{confirmedOpportunity.role} · {confirmedOpportunity.company}</strong></span><button type="button" className="primary-button" onClick={() => { resetOpportunityInput(); setStep(4); }}>Continue to Practice</button><button type="button" className="saved-opportunity-delete" aria-label="Delete saved opportunity" title="Delete saved opportunity" onClick={() => setConfirmation({
            title: "Delete saved opportunity?", description: `${confirmedOpportunity.role} at ${confirmedOpportunity.company} will be removed from this device.`, actionLabel: "Delete opportunity", onConfirm: () => {
            void run(async () => {
            const current = opportunityById(memoryRef.current, activeOpportunityId);
            if (!current) return;
            const next = await commitMemory((state) => removeOpportunity(state, current.id));
            const previous = next.opportunities.at(-1);
            setActiveOpportunityId(previous?.id ?? null);
            setSelectedRoundId(null); setRoundName(""); setRoundCustom("");
            setMemoryProposals(pendingInterviewFacts(next));
            setConfirmedOpportunity(previous ? { company: previous.company, role: previous.role, confidence: "clear" } : null);
            setOpportunityDraft(null); setJobAnalysis(null); setJobAlignment(null);
            setOpportunityInput(""); setOpportunityUrl(""); setOpportunityUrlText("");
            opportunityPdfRef.current = null; setOpportunityPdfName(""); setOpportunityMethod("url");
            }, 3);
            },
          })}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7M10 11v5m4-5v5"/></svg></button></div>}</div>}
        </>}
        {step === 4 && <>
          <div className="detail-heading"><span className="eyebrow">04 / YOUR INTERVIEW</span><h2>Prepare for your interview.</h2></div>
          {!memoryRef.current.opportunities.length ? <p className="detail-note">Save an opportunity in Step 3 to prepare for it here.</p> : <>
            <div className="opportunity-picker" aria-label="Saved opportunities">{memoryRef.current.opportunities.map((item) => { const itemRounds = rounds.filter((round) => round.opportunityId === item.id); const selected = activeOpportunityId === item.id; return <div className="opportunity-card" key={item.id}><button type="button" className={`opportunity-picker-item${selected ? " selected" : ""}`} aria-pressed={selected} onClick={() => selectSavedOpportunity(item.id)}><CompanyIcon logo={item.brandLogoDataUrl}/><strong>{item.company}</strong><span>{item.role}</span><small>{itemRounds.filter((round) => round.status === "completed").length} of {itemRounds.length} rounds completed</small></button>{selected && <button type="button" className="selected-card-delete" aria-label={`Delete ${item.role} at ${item.company}`} onClick={() => confirmDeleteOpportunity(item.id)}>×</button>}</div>; })}</div>
            {activeOpportunityId && <section className="round-setup"><h3>Interview rounds</h3>
              <div className="round-list">{rounds.filter((round) => round.opportunityId === activeOpportunityId).map((round) => <RoundCard key={round.id} round={round} selected={selectedRoundId === round.id} onEdit={() => editRound(round)} onDelete={() => confirmDeleteRound(round)} onStatusChange={(status) => void changeRoundStatus(round, status)}/>)}</div>
              <div className="round-editor"><div className="round-fields"><label className="field-label">Who are you interviewing with?<select value={roundName} onChange={(event) => { if (event.target.value === "Other" && roundName !== "Other") setRoundCustom(""); setRoundName(event.target.value); setRoundNotice(""); }}><option value="">Choose an interview round</option>{["Recruiter / HR", "Hiring Manager", "Team Member", "Panel Interview", "Executive / Leadership", "Portfolio / Technical Interview", "Other"].map((label) => <option key={label}>{label}</option>)}</select></label><label className="field-label">Interview date (optional)<input type="date" value={roundDate} onChange={(event) => setRoundDate(event.target.value)}/></label></div><div className="round-custom-slot">{roundName === "Other" && <label className="field-label">Describe the interview<input value={roundCustom} maxLength={100} onChange={(event) => setRoundCustom(event.target.value)}/></label>}</div>
                <details className="round-reference"><summary>Interviewer reference (optional)</summary><label className="field-label">LinkedIn profile URL<input type="url" value={roundLinkedInUrl} placeholder="https://www.linkedin.com/in/..." onChange={(event) => setRoundLinkedInUrl(event.target.value)}/></label><label className="file-button">Choose LinkedIn PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => void readRoundPdf(event.target.files?.[0])}/></label>{roundPdf && <p>{roundPdf.name} <button type="button" className="text-button" onClick={() => setRoundPdf(undefined)}>Remove PDF</button></p>}</details>
                <div className="inline-actions">{(!selectedRoundId || roundDirty) && <button type="button" className="secondary-button" disabled={roundSaving || !roundName || (roundName === "Other" && roundCustom.trim().length < 2)} onClick={() => void submitRound()}>{roundSaving ? "Saving…" : selectedRoundId ? "Save Changes" : "Add Round"}</button>}{selectedRoundId && <button type="button" className="text-button" onClick={resetRoundEditor}>Add another round</button>}</div>{roundNotice && <p role="status" className="detail-note">{roundNotice}</p>}{roundError && <p role="alert" className="step-error">{roundError}</p>}
              </div>
              <div className="interview-actions"><span className="interview-action-wrap" tabIndex={interviewActionHint ? 0 : undefined} title={interviewActionHint} data-hint={interviewActionHint} aria-label={interviewActionHint}><button type="button" className="secondary-button" disabled={!canPractice || !selectedRoundId} onClick={() => setPractice("voice")}>Practice Interview</button></span><span className="interview-action-wrap" tabIndex={interviewActionHint ? 0 : undefined} title={interviewActionHint} data-hint={interviewActionHint} aria-label={interviewActionHint}><button type="button" className="go-live-button" disabled={!canPractice || !selectedRoundId} onClick={() => setPractice("personal")}><span className="go-live-play" aria-hidden="true">▶</span>Go Live</button></span></div>
            </section>}
          </>}
        </>}
      </section>
      <footer className="page-footer"><span>VantSide</span><span>Practice only · {hasDesktopStorage() ? "Saved on this device" : "Session only"}</span></footer>
    </div>
  </main>;
}
