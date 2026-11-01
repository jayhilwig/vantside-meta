"use client";

import { useEffect, useRef, useState } from "react";
import { localApiHeaders } from "@/lib/local-api-auth";
import { startLiveInterview, type LiveInterview, type LiveStatus } from "@/lib/live-interview";
import type { CareerProfile, MemoryProject } from "@/lib/session-schema";
import type { PendingInterviewFact } from "@/lib/journey-memory";
import { questionToHud, type HudFact, type HudOpportunity } from "@/lib/interview-hud-pipeline";
import { LatestQuestion } from "@/lib/latest-question";
import { HudFacts } from "./hud-facts";
import type { PracticeReview } from "@/lib/practice-review-schema";
import { microphonePassed, microphoneSample, speakerPlaybackCompleted } from "@/lib/audio-test-feedback";
import { HudWindowController, tauriHudPort } from "@/lib/hud-window";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
type Review = PracticeReview;
type Context = { company: string; role: string; description: string; round: string; requirements: string[]; strengths: string[]; areas: string[];
  hudRequirements?: HudOpportunity["requirements"]; preparationQuestions?: string[] };

async function post<T>(route: string, body: object, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${api}${route}`, { method: "POST", headers: await localApiHeaders(), body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The practice request failed.");
  return result as T;
}

export function ConversationalPracticeApp({ profile, projects, context, savedReview, savedPending, onSaveReview, onBack, onProposals, onApprove, onDiscard }: {
  profile: CareerProfile | null; projects: MemoryProject[]; context: Context; onBack(): void;
  savedReview: Review | null; savedPending: PendingInterviewFact[]; onSaveReview(review: Review): Promise<void>;
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
  const [deviceMessageFor, setDeviceMessageFor] = useState<"microphone" | "speaker">("microphone");
  const [deviceOutcome, setDeviceOutcome] = useState<"pass" | "quiet" | null>(null);
  const [testing, setTesting] = useState(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const testMicRef = useRef<MediaStream | null>(null);
  const testRunRef = useRef(0);
  const microphoneListAuthorizedRef = useRef(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(savedReview);
  const [cues, setCues] = useState<HudFact[]>([]);
  const cueRunRef = useRef(new LatestQuestion<Awaited<ReturnType<typeof questionToHud>>>());
  const hudRef = useRef<HudWindowController | null>(null);
  if (!hudRef.current) hudRef.current = new HudWindowController(tauriHudPort);
  const [hudShown, setHudShown] = useState(false);
  const hudStartedRef = useRef(false);
  const recentCueIds = useRef<string[]>([]);
  const [pending, setPending] = useState<PendingInterviewFact[]>(savedPending);
  const [saving, setSaving] = useState(false);
  const liveRef = useRef<LiveInterview | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef("");
  useEffect(() => {
    const cueRun = cueRunRef.current;
    const hud = hudRef.current;
    const testRun = testRunRef;
    let disposed = false; let unlistenReady: (() => void) | undefined; let unlistenHidden: (() => void) | undefined;
    if (isTauri()) {
      void listen("vantside-hud-ready", () => { void hud?.ready(); }).then((stop) => { if (disposed) stop(); else unlistenReady = stop; });
      void listen("vantside-hud-hidden", () => { setHudShown(false); void hud?.hide(); }).then((stop) => { if (disposed) stop(); else unlistenHidden = stop; });
    }
    void navigator.mediaDevices?.enumerateDevices?.().then((items) => { setMicrophones(items.filter((item) => item.kind === "audioinput")); setSpeakers(items.filter((item) => item.kind === "audiooutput")); }).catch(() => undefined);
    return () => { disposed = true; testRun.current++; testMicRef.current?.getTracks().forEach((track) => track.stop());
      unlistenReady?.(); unlistenHidden?.(); cueRun.cancel(); requestRef.current?.abort(); liveRef.current?.close(); testAudioRef.current?.pause(); testAudioRef.current = null; void hud?.close(); };
  }, []);

  async function revealMicrophones() {
    try { if (!microphoneListAuthorizedRef.current) { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); microphoneListAuthorizedRef.current = true; }
      const devices = await navigator.mediaDevices.enumerateDevices(); setMicrophones(devices.filter((item) => item.kind === "audioinput")); }
    catch (cause) { setDeviceMessageFor("microphone"); setDeviceOutcome(null); setDeviceMessage(cause instanceof Error ? cause.message : "Microphone access is unavailable."); }
  }

  function cueForQuestion(question: string) {
    setCues([]);
    void hudRef.current?.publish([]);
    void cueRunRef.current.run((signal) => questionToHud({ question, projects, opportunity: { company: context.company, role: context.role,
      requirements: context.hudRequirements, preparationQuestions: context.preparationQuestions },
      recentFactIds: recentCueIds.current, signal }), (result) => {
      setCues(result.cues);
      void hudRef.current?.publish(result.cues);
      recentCueIds.current = [...recentCueIds.current, ...result.cues.map((cue) => cue.factId)].slice(-10);
    }, () => setCues([]));
  }

  async function testMicrophone() {
    if (testing) return;
    const run = ++testRunRef.current;
    setTesting(true); setDeviceMessageFor("microphone"); setDeviceOutcome(null); setDeviceMessage("");
    let stream: MediaStream | null = null; let audio: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true });
      testMicRef.current = stream;
      microphoneListAuthorizedRef.current = true;
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === "audioinput")); setSpeakers(devices.filter((device) => device.kind === "audiooutput"));
      setDeviceMessage("Speak to test your microphone…");
      audio = new AudioContext(); const analyser = audio.createAnalyser(); analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser); const samples = new Uint8Array(analyser.fftSize);
      let streak = 0; let passed = false;
      for (let i = 0; i < 38 && run === testRunRef.current; i++) { analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        const current = Math.min(100, Math.round(rms * 400)); setLevel(current);
        streak = microphoneSample(current, streak); if (microphonePassed(streak)) passed = true;
        await new Promise((resolve) => window.setTimeout(resolve, 80)); }
      if (run === testRunRef.current) { setDeviceOutcome(passed ? "pass" : "quiet"); setDeviceMessage(passed ? "Input detected" : "Input was too quiet. Check your microphone and try again."); }
    } catch (cause) { if (run === testRunRef.current) setDeviceMessage(cause instanceof Error ? cause.message : "Microphone test failed."); }
    finally { stream?.getTracks().forEach((track) => track.stop()); testMicRef.current = null; if (audio) await audio.close();
      if (run === testRunRef.current) { setLevel(0); setTesting(false); } }
  }

  async function testSpeaker() {
    if (testing) return;
    setTesting(true); setDeviceMessageFor("speaker"); setDeviceOutcome(null); setDeviceMessage("");
    const audio = new Audio("/speaker-test.mp3"); testAudioRef.current = audio;
    try {
      if (speakerId) { if (typeof audio.setSinkId !== "function") throw new Error("Speaker selection is unavailable. Use the system output."); await audio.setSinkId(speakerId); }
      const finished = new Promise<"ended" | "cancelled">((resolve, reject) => {
        audio.onended = () => resolve("ended"); audio.onpause = () => resolve("cancelled");
        audio.onerror = () => reject(new Error("Speaker test could not play."));
      });
      await audio.play();
      if (testAudioRef.current !== audio) return;
      setDeviceMessage("Playing speaker test");
      if (speakerPlaybackCompleted(await finished) && testAudioRef.current === audio) { setDeviceOutcome("pass"); setDeviceMessage("Playback completed"); }
    } catch (cause) { if (testAudioRef.current === audio) setDeviceMessage(cause instanceof Error ? cause.message : "Speaker test failed."); }
    finally { audio.pause(); audio.removeAttribute("src"); if (testAudioRef.current === audio) { testAudioRef.current = null; setTesting(false); } }
  }

  async function toggleHud() {
    try {
      if (hudShown) { await hudRef.current?.hide(); setHudShown(false); }
      else { await hudRef.current?.show(); setHudShown(true); }
    } catch { setError("The floating HUD could not open. The interview can continue."); }
  }

  async function start() {
    if (!consent || liveRef.current || requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    setStatus("connecting"); setError(""); setCues([]); transcriptRef.current = ""; hudStartedRef.current = false;
    try {
      const live = await startLiveInterview({ microphoneId, outputId: speakerId, signal: controller.signal,
        openingPrompt: `Greet briefly and ask one opening question for the ${context.round} interview for ${context.role} at ${context.company}. Then listen.`,
        createSession: (sdp) => post<{ sdp: string }>("/interview/live/session", { sdp, profile: profile ?? undefined, projects,
          practice: { company: context.company, role: context.role, round: context.round, description: context.description,
            requirements: context.requirements, strengths: context.strengths, areas: context.areas } }, controller.signal),
        onStatus: (next) => { setStatus(next);
          if (next === "listening" && isTauri() && !hudStartedRef.current) {
            hudStartedRef.current = true;
            void hudRef.current?.show().then(() => { if (hudStartedRef.current) setHudShown(true); }).catch(() => setError("The floating HUD could not open. The interview can continue."));
          }
          if (next === "ended" && liveRef.current) void end(); }, onLevel: setLevel,
        onInterviewerQuestion: cueForQuestion,
        onError: (message) => { cueRunRef.current.cancel(); void hudRef.current?.close(); setHudShown(false); liveRef.current = null; setError(message); setStatus("error"); },
      });
      if (controller.signal.aborted) live.close(); else liveRef.current = live;
    } catch (cause) { if (!controller.signal.aborted) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Voice could not start. Check your microphone and connection."); } }
    finally { if (requestRef.current === controller) requestRef.current = null; }
  }

  async function end() {
    cueRunRef.current.cancel(); setCues([]); setHudShown(false); hudStartedRef.current = false; void hudRef.current?.close();
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
      if (!controller.signal.aborted) { setReview(result); await onSaveReview(result); setStatus("ended"); transcriptRef.current = ""; }
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
  return <main className="app-shell"><div className="page-wrap practice-conversation"><button type="button" className="text-button" onClick={() => { cueRunRef.current.cancel(); requestRef.current?.abort(); liveRef.current?.close(); void hudRef.current?.close(); onBack(); }}>← Back to rounds</button>
    <h1>Practice Interview</h1><p>{context.role} · {context.company} · {context.round}</p>
    <div className="live-status" role="status" aria-live="polite"><span className={`live-status-dot ${status}`} aria-hidden="true"/><span>Interview status</span><strong>{({ ready: "Ready", connecting: "Connecting", listening: "Listening", "user-speaking": "You’re speaking", speaking: "Interviewer speaking", paused: "Paused", ended: "Ended", error: "Error", reviewing: "Preparing review" } as const)[status]}</strong></div>
    {!running && status !== "reviewing" && <><details className="audio-devices" open><summary>Audio setup</summary><div className="audio-device-grid"><section className="device-card" aria-label="Microphone setup"><h3>Microphone</h3><label>Input<select value={microphoneId} onPointerDown={() => void revealMicrophones()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void revealMicrophones(); }} onFocus={() => void navigator.mediaDevices?.enumerateDevices?.().then((items) => setMicrophones(items.filter((item) => item.kind === "audioinput"))).catch(() => undefined)} onChange={(event) => setMicrophoneId(event.target.value)}><option value="">System default</option>{microphones.map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Microphone ${index + 1}`}</option>)}</select></label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={testing} onClick={() => void testMicrophone()}>Test microphone</button><meter min="0" max="100" value={level} aria-label="Microphone level"/></div>{deviceMessageFor === "microphone" && deviceMessage && <span className="device-status" role="status"><span className={deviceOutcome === "pass" ? "test-check" : deviceOutcome === "quiet" ? "test-fail" : ""} aria-hidden="true">{deviceOutcome === "pass" ? "✓" : deviceOutcome === "quiet" ? "×" : ""}</span>{deviceMessage}</span>}</section><section className="device-card" aria-label="Speaker setup"><h3>Speaker</h3><label>Output{typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && speakers.length ? <select value={speakerId} onChange={(event) => setSpeakerId(event.target.value)}><option value="">{speakers.find((item) => item.deviceId === "default")?.label || "System default"}</option>{speakers.filter((item) => item.deviceId !== "default").map((item, index) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Speaker ${index + 1}`}</option>)}</select> : <span className="device-default">System output</span>}</label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={testing} onClick={() => void testSpeaker()}>Test speaker</button></div>{deviceMessageFor === "speaker" && deviceMessage && <span className="device-status" role="status"><span className={deviceOutcome === "pass" ? "test-check" : ""} aria-hidden="true">{deviceOutcome === "pass" ? "✓" : ""}</span>{deviceMessage}</span>}</section></div></details><label className="practice-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/> I confirm this is consensual practice and recording and AI use are allowed.</label><button type="button" className="primary-button" disabled={!consent || testing || pending.length > 0} onClick={() => void start()}>{review ? "Continue Interview" : "Start Interview"}</button>{review && <p className="detail-note">A completed new segment replaces this round’s saved review.</p>}{pending.length > 0 && <p className="detail-note">Review proposed facts before starting another interview.</p>}</>}
    {running && <div className="inline-actions"><meter min="0" max="100" value={level} aria-label="Microphone level"/>{status === "paused" ? <button type="button" className="secondary-button" onClick={() => liveRef.current?.resume()}>Resume</button> : status !== "connecting" && <button type="button" className="secondary-button" onClick={() => liveRef.current?.pause()}>Pause</button>}<button type="button" className="secondary-button" onClick={() => void end()}>End Interview</button></div>}
    {running && status !== "connecting" && isTauri() && <button type="button" className="text-button" onClick={() => void toggleHud()}>{hudShown ? "Hide HUD" : "Show HUD"}</button>}
    {running && !isTauri() && <section className="practice-hud" aria-label="Practice Career Memory HUD"><span className="eyebrow">PRACTICE HUD</span><div className="hud-surface"><HudFacts cues={cues}/></div></section>}
    {error && <p className="step-error" role="alert">{error}{transcriptRef.current.length >= 40 && <button type="button" className="text-button" onClick={() => void prepareReview()}>Retry review</button>}</p>}
    {review && <section className="practice-review"><h2>Practice review</h2>
      {review.competencies?.length > 0 && <div><h3>Job requirements</h3>{review.competencies.map((item) => <div className="practice-competency" key={item.requirement}><strong>{item.requirement}</strong><span>{item.assessment}</span><p>{item.explanation}</p>{item.suggestion && <p>{item.suggestion}</p>}</div>)}</div>}
      {(["topics", "strengths", "clarity"] as const).map((key) => review[key].length > 0 && <div key={key}><h3>{key === "clarity" ? "Clarity and specificity" : key === "topics" ? "Topics covered" : "Strengths demonstrated"}</h3>{review[key].map((item, index) => <p key={index}>{item.text}</p>)}</div>)}
      {review.areas.length > 0 && <div><h3 className="areas-heading">Areas to practice</h3>{review.areas.map((item) => <p key={item}>{item}</p>)}</div>}
      {!pending.length && review.proposals.length > 0 && <button type="button" className="secondary-button" disabled={saving} onClick={() => void saveProposals()}>{saving ? "Saving proposals…" : `Review ${review.proposals.length} proposed Career Memory facts`}</button>}
      {pending.length > 0 && <div className="practice-facts"><h3>Proposed Career Memory</h3>{pending.map((item) => <div className="review-fact review-pending-fact" key={item.id}><div className="review-pending-heading"><strong>{item.title}</strong><button type="button" className="pending-delete" disabled={saving} aria-label={`Discard proposed fact: ${item.title}`} onClick={() => void finishFacts(false, [item])}>×</button></div><label className="field-label">Fact<textarea rows={2} maxLength={300} value={item.text} onChange={(event) => setPending((current) => current.map((fact) => fact.id === item.id ? { ...fact, text: event.target.value } : fact))}/></label></div>)}<div className="inline-actions"><button type="button" className="primary-button" disabled={saving} onClick={() => void finishFacts(true)}>Accept Facts</button><button type="button" className="secondary-button dismiss-button" disabled={saving} onClick={() => void finishFacts(false)}>Discard All Facts</button></div></div>}
      {!review.topics.length && !review.strengths.length && !review.clarity.length && !review.areas.length && !review.competencies?.length && <p>Not enough grounded detail for feedback.</p>}
    </section>}
  </div></main>;
}
