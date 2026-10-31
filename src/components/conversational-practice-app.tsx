"use client";

import { useEffect, useRef, useState } from "react";
import { localApiHeaders } from "@/lib/local-api-auth";
import { startLiveInterview, type LiveInterview, type LiveStatus } from "@/lib/live-interview";
import type { CareerProfile, MemoryProject } from "@/lib/session-schema";
import type { PendingInterviewFact } from "@/lib/journey-memory";

const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
type Item = { text: string; quote: string };
type Competency = { requirement: string; assessment: "Strong" | "Develop Further" | "Not Demonstrated"; explanation: string; quote: string; suggestion: string };
type Review = { topics: Item[]; strengths: Item[]; clarity: Item[]; areas: string[]; competencies: Competency[]; proposals: Array<{ title: string; text: string; source: string }> };
type Context = { company: string; role: string; description: string; round: string; requirements: string[]; strengths: string[]; areas: string[] };

async function post<T>(route: string, body: object, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${api}${route}`, { method: "POST", headers: await localApiHeaders(), body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The practice request failed.");
  return result as T;
}

export function ConversationalPracticeApp({ profile, projects, context, onBack, onProposals, onApprove, onDiscard }: {
  profile: CareerProfile | null; projects: MemoryProject[]; context: Context; onBack(): void;
  onProposals(items: Review["proposals"]): Promise<PendingInterviewFact[]>;
  onApprove(items: PendingInterviewFact[]): Promise<void>; onDiscard(items: PendingInterviewFact[]): Promise<void>;
}) {
  const [status, setStatus] = useState<LiveStatus | "ready" | "reviewing">("ready");
  const [consent, setConsent] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [speakerId, setSpeakerId] = useState("");
  const [level, setLevel] = useState(0);
  const [deviceMessage, setDeviceMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [pending, setPending] = useState<PendingInterviewFact[]>([]);
  const [saving, setSaving] = useState(false);
  const liveRef = useRef<LiveInterview | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef("");
  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices?.().then((items) => { setMicrophones(items.filter((item) => item.kind === "audioinput")); setSpeakers(items.filter((item) => item.kind === "audiooutput")); }).catch(() => undefined);
    return () => { requestRef.current?.abort(); liveRef.current?.close(); testAudioRef.current?.pause(); testAudioRef.current = null; };
  }, []);

  async function testMicrophone() {
    if (testing) return;
    setTesting(true); setDeviceMessage("");
    let stream: MediaStream | null = null; let audio: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true });
      audio = new AudioContext(); const analyser = audio.createAnalyser(); analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser); const samples = new Uint8Array(analyser.fftSize);
      let peak = 0;
      for (let i = 0; i < 16; i++) { analyser.getByteTimeDomainData(samples);
        peak = Math.max(peak, Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length));
        setLevel(Math.min(100, Math.round(peak * 450))); await new Promise((resolve) => window.setTimeout(resolve, 100)); }
      if (peak < 0.015) setDeviceMessage("Input was too quiet. Check your microphone and try again.");
    } catch (cause) { setDeviceMessage(cause instanceof Error ? cause.message : "Microphone test failed."); }
    finally { stream?.getTracks().forEach((track) => track.stop()); if (audio) await audio.close(); setLevel(0); setTesting(false); }
  }

  async function testSpeaker() {
    if (testing) return;
    setTesting(true); setDeviceMessage("");
    const audio = new Audio("/speaker-test.mp3"); testAudioRef.current = audio;
    try {
      if (speakerId) { if (typeof audio.setSinkId !== "function") throw new Error("Speaker selection is unavailable. Use the system output."); await audio.setSinkId(speakerId); }
      await new Promise<void>((resolve, reject) => { audio.onended = () => resolve(); audio.onpause = () => resolve(); audio.onerror = () => reject(new Error("Speaker test could not play."));
        void audio.play().catch(reject); });
    } catch (cause) { setDeviceMessage(cause instanceof Error ? cause.message : "Speaker test failed."); }
    finally { audio.pause(); audio.removeAttribute("src"); if (testAudioRef.current === audio) testAudioRef.current = null; setTesting(false); }
  }

  async function start() {
    if (!consent || liveRef.current || requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    setStatus("connecting"); setError(""); setReview(null); transcriptRef.current = "";
    try {
      const live = await startLiveInterview({ microphoneId, outputId: speakerId, signal: controller.signal,
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
    try { setPending(await onProposals(review.proposals)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Proposals could not be saved. Try again."); setSaving(false); }
    finally { setSaving(false); }
  }

  async function finishFacts(accept: boolean, items = pending) {
    if (saving || !items.length) return;
    setSaving(true); setError("");
    try { if (accept) await onApprove(items); else await onDiscard(items);
      setPending((current) => current.filter((item) => !items.some((removed) => removed.id === item.id)));
      if (items.length === pending.length) setReview((current) => current && { ...current, proposals: [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Career Memory could not be updated."); }
    finally { setSaving(false); }
  }

  const running = ["connecting", "listening", "user-speaking", "speaking", "paused"].includes(status);
  return <main className="app-shell"><div className="page-wrap practice-conversation"><button type="button" className="text-button" onClick={() => { requestRef.current?.abort(); liveRef.current?.close(); onBack(); }}>← Back to rounds</button>
    <h1>Practice Interview</h1><p>{context.role} · {context.company} · {context.round}</p>
    <p className="practice-status" role="status" aria-live="polite"><span className={`live-status-dot ${status}`} aria-hidden="true"/>{({ ready: "Ready", connecting: "Connecting", listening: "Listening", "user-speaking": "You’re speaking", speaking: "Interviewer speaking", paused: "Paused", ended: "Ended", error: "Error", reviewing: "Preparing review" } as const)[status]}</p>
    {!running && status !== "reviewing" && <><div className="round-fields"><label className="field-label">Microphone<select value={microphoneId} onFocus={() => void navigator.mediaDevices?.enumerateDevices?.().then((items) => setMicrophones(items.filter((item) => item.kind === "audioinput"))).catch(() => undefined)} onChange={(event) => setMicrophoneId(event.target.value)}><option value="">System default</option>{microphones.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Microphone ${index + 1}`}</option>)}</select></label><label className="field-label">Speaker{typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && speakers.length ? <select value={speakerId} onChange={(event) => setSpeakerId(event.target.value)}><option value="">System default</option>{speakers.filter((item) => item.deviceId !== "default").map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Speaker ${index + 1}`}</option>)}</select> : <span className="device-default">System output</span>}</label></div><div className="inline-actions"><button type="button" className="secondary-button" disabled={testing} onClick={() => void testMicrophone()}>Test microphone</button><button type="button" className="secondary-button" disabled={testing} onClick={() => void testSpeaker()}>Test speaker</button><meter min="0" max="100" value={level} aria-label="Microphone level"/></div>{deviceMessage && <p role="status" className="detail-note">{deviceMessage}</p>}<label className="practice-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/> I confirm this is consensual practice and recording and AI use are allowed.</label><button type="button" className="primary-button" disabled={!consent || testing || pending.length > 0} onClick={() => void start()}>Start Interview</button>{pending.length > 0 && <p className="detail-note">Review proposed facts before starting another interview.</p>}</>}
    {running && <div className="inline-actions"><meter min="0" max="100" value={level} aria-label="Microphone level"/>{status === "paused" ? <button type="button" className="secondary-button" onClick={() => liveRef.current?.resume()}>Resume</button> : status !== "connecting" && <button type="button" className="secondary-button" onClick={() => liveRef.current?.pause()}>Pause</button>}<button type="button" className="secondary-button" onClick={() => void end()}>End Interview</button></div>}
    {error && <p className="step-error" role="alert">{error}{transcriptRef.current.length >= 40 && <button type="button" className="text-button" onClick={() => void prepareReview()}>Retry review</button>}</p>}
    {review && <section className="practice-review"><h2>Practice review</h2>
      {review.competencies?.length > 0 && <div><h3>Job requirements</h3>{review.competencies.map((item) => <div className="practice-competency" key={item.requirement}><strong>{item.requirement}</strong><span>{item.assessment}</span><p>{item.explanation}</p>{item.suggestion && <p>{item.suggestion}</p>}</div>)}</div>}
      {(["topics", "strengths", "clarity"] as const).map((key) => review[key].length > 0 && <div key={key}><h3>{key === "clarity" ? "Clarity and specificity" : key === "topics" ? "Topics covered" : "Strengths demonstrated"}</h3>{review[key].map((item, index) => <p key={index}>{item.text}</p>)}</div>)}
      {review.areas.length > 0 && <div><h3>Areas to practice</h3>{review.areas.map((item) => <p key={item}>{item}</p>)}</div>}
      {!pending.length && review.proposals.length > 0 && <button type="button" className="secondary-button" disabled={saving} onClick={() => void saveProposals()}>{saving ? "Saving proposals…" : `Review ${review.proposals.length} proposed Career Memory facts`}</button>}
      {pending.length > 0 && <div className="practice-facts"><h3>Proposed Career Memory</h3>{pending.map((item) => <div className="review-fact review-pending-fact" key={item.id}><div className="review-pending-heading"><strong>{item.title}</strong><button type="button" className="pending-delete" disabled={saving} aria-label={`Discard proposed fact: ${item.title}`} onClick={() => void finishFacts(false, [item])}>×</button></div><label className="field-label">Fact<textarea rows={2} maxLength={300} value={item.text} onChange={(event) => setPending((current) => current.map((fact) => fact.id === item.id ? { ...fact, text: event.target.value } : fact))}/></label></div>)}<div className="inline-actions"><button type="button" className="primary-button" disabled={saving} onClick={() => void finishFacts(true)}>Accept Facts</button><button type="button" className="secondary-button dismiss-button" disabled={saving} onClick={() => void finishFacts(false)}>Discard All Facts</button></div></div>}
      {!review.topics.length && !review.strengths.length && !review.clarity.length && !review.areas.length && !review.competencies?.length && <p>Not enough grounded detail for feedback.</p>}
    </section>}
  </div></main>;
}
