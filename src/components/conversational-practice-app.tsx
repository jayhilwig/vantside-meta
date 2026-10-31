"use client";

import { useEffect, useRef, useState } from "react";
import { localApiHeaders } from "@/lib/local-api-auth";
import { startLiveInterview, type LiveInterview, type LiveStatus } from "@/lib/live-interview";
import type { CareerProfile, MemoryProject } from "@/lib/session-schema";

const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
type Item = { text: string; quote: string };
type Review = { topics: Item[]; strengths: Item[]; clarity: Item[]; areas: string[]; proposals: Array<{ title: string; text: string; source: string }> };
type Context = { company: string; role: string; description: string; round: string; requirements: string[]; strengths: string[]; areas: string[] };

async function post<T>(route: string, body: object, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${api}${route}`, { method: "POST", headers: await localApiHeaders(), body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The practice request failed.");
  return result as T;
}

export function ConversationalPracticeApp({ profile, projects, context, onBack, onProposals }: {
  profile: CareerProfile | null; projects: MemoryProject[]; context: Context; onBack(): void;
  onProposals(items: Review["proposals"]): Promise<void>;
}) {
  const [status, setStatus] = useState<LiveStatus | "ready" | "reviewing">("ready");
  const [consent, setConsent] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [saving, setSaving] = useState(false);
  const liveRef = useRef<LiveInterview | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef("");
  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices?.().then((items) => setMicrophones(items.filter((item) => item.kind === "audioinput"))).catch(() => undefined);
    return () => { requestRef.current?.abort(); liveRef.current?.close(); };
  }, []);

  async function start() {
    if (!consent || liveRef.current || requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    setStatus("connecting"); setError(""); setReview(null); transcriptRef.current = "";
    try {
      const live = await startLiveInterview({ microphoneId, signal: controller.signal,
        openingPrompt: `Greet briefly and ask one opening question for the ${context.round} interview for ${context.role} at ${context.company}. Then listen.`,
        createSession: (sdp) => post<{ sdp: string }>("/interview/live/session", { sdp, profile: profile ?? undefined, projects,
          practice: { company: context.company, role: context.role, round: context.round, description: context.description,
            requirements: context.requirements, strengths: context.strengths, areas: context.areas } }, controller.signal),
        onStatus: (next) => { setStatus(next); if (next === "ended" && liveRef.current) void end(); }, onLevel: setLevel,
        onError: (message) => { liveRef.current = null; setError(message); setStatus("error"); },
      });
      if (controller.signal.aborted) live.close(); else liveRef.current = live;
    } catch (cause) { if (!controller.signal.aborted) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Voice could not start. Check your microphone and connection."); } }
    finally { if (requestRef.current === controller) requestRef.current = null; }
  }

  async function end() {
    requestRef.current?.abort(); requestRef.current = null;
    const live = liveRef.current; liveRef.current = null;
    transcriptRef.current = live?.userSpeech().trim() ?? transcriptRef.current;
    live?.close(); setLevel(0); setStatus("ended");
    if (transcriptRef.current.length < 40) { setError("There was not enough captured speech for a grounded review. Your Career Memory is unchanged."); return; }
    await prepareReview();
  }

  async function prepareReview() {
    const controller = new AbortController(); requestRef.current = controller; setStatus("reviewing"); setError("");
    try { const result = await post<Review>("/interview/practice/review", { transcript: transcriptRef.current, role: context.role,
      round: context.round, requirements: context.requirements }, controller.signal);
      if (!controller.signal.aborted) { setReview(result); setStatus("ended"); transcriptRef.current = ""; }
    } catch (cause) { if (!controller.signal.aborted) { setStatus("ended"); setError(cause instanceof Error ? cause.message : "Review unavailable. Try again."); } }
    finally { if (requestRef.current === controller) requestRef.current = null; }
  }

  async function saveProposals() {
    if (!review?.proposals.length || saving) return;
    setSaving(true); setError("");
    try { await onProposals(review.proposals); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Proposals could not be saved. Try again."); setSaving(false); }
  }

  const running = ["connecting", "listening", "user-speaking", "speaking", "paused"].includes(status);
  return <main className="app-shell"><div className="page-wrap practice-conversation"><button type="button" className="text-button" onClick={() => { requestRef.current?.abort(); liveRef.current?.close(); onBack(); }}>← Back to rounds</button>
    <h1>Practice Interview</h1><p>{context.role} · {context.company} · {context.round}</p>
    <div className="live-status" role="status" aria-live="polite"><strong>{({ ready: "Ready", connecting: "Connecting", listening: "Listening", "user-speaking": "You’re speaking", speaking: "Interviewer speaking", paused: "Paused", ended: "Ended", error: "Error", reviewing: "Preparing review" } as const)[status]}</strong></div>
    {!running && status !== "reviewing" && <><label className="field-label">Microphone<select value={microphoneId} onFocus={() => void navigator.mediaDevices?.enumerateDevices?.().then((items) => setMicrophones(items.filter((item) => item.kind === "audioinput"))).catch(() => undefined)} onChange={(event) => setMicrophoneId(event.target.value)}><option value="">System default</option>{microphones.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Microphone ${index + 1}`}</option>)}</select></label><label className="practice-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/> Practice only. Everyone present consents, recording and AI use are allowed, and voice is processed by an external AI service.</label><button type="button" className="primary-button" disabled={!consent} onClick={() => void start()}>Start Interview</button></>}
    {running && <div className="inline-actions"><meter min="0" max="100" value={level} aria-label="Microphone level"/><button type="button" className="secondary-button" onClick={() => void end()}>End Interview</button></div>}
    {error && <p className="step-error" role="alert">{error}{transcriptRef.current.length >= 40 && <button type="button" className="text-button" onClick={() => void prepareReview()}>Retry review</button>}</p>}
    {review && <section className="practice-review"><h2>Practice review</h2>{(["topics", "strengths", "clarity"] as const).map((key) => review[key].length > 0 && <div key={key}><h3>{key === "clarity" ? "Clarity and specificity" : key === "topics" ? "Topics covered" : "Strengths demonstrated"}</h3>{review[key].map((item, index) => <p key={index}>{item.text}</p>)}</div>)}{review.areas.length > 0 && <div><h3>Areas to practice</h3>{review.areas.map((item) => <p key={item}>{item}</p>)}</div>}{review.proposals.length > 0 && <button type="button" className="secondary-button" disabled={saving} onClick={() => void saveProposals()}>{saving ? "Saving proposals…" : `Review ${review.proposals.length} proposed Career Memory facts`}</button>}{!review.topics.length && !review.strengths.length && !review.clarity.length && !review.areas.length && <p>Not enough grounded detail for feedback.</p>}</section>}
  </div></main>;
}
