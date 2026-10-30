"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BrandMark } from "./practice-app";
import { startAnswerRecording, type AnswerRecorder } from "@/lib/record-answer";
import { questionToHud, type HudFact, type HudOpportunity } from "@/lib/interview-hud-pipeline";
import { HudWindowController, tauriHudPort } from "@/lib/hud-window";
import { LatestQuestion } from "@/lib/latest-question";
import type { MemoryProject } from "@/lib/session-schema";

const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
type Status = "ready" | "opening" | "permission" | "listening" | "transcribing" | "finding" | "between" | "ending" | "ended";

export function InterviewPracticeApp({ projects, opportunity, onBack }: {
  projects: MemoryProject[]; opportunity: HudOpportunity; onBack: () => void;
}) {
  const [status, setStatus] = useState<Status>("ready");
  const [consent, setConsent] = useState(false);
  const [inputMode, setInputMode] = useState<"microphone" | "text">("microphone");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [question, setQuestion] = useState("");
  const [typedQuestion, setTypedQuestion] = useState("");
  const [cues, setCues] = useState<HudFact[]>([]);
  const [hudShown, setHudShown] = useState(false);
  const [error, setError] = useState("");
  const [cueNote, setCueNote] = useState("");
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const captureRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const cueRunRef = useRef(new LatestQuestion<Awaited<ReturnType<typeof questionToHud>>>());
  const timerRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const recentRef = useRef<string[]>([]);
  const hudRef = useRef<HudWindowController | null>(null);
  if (!hudRef.current) hudRef.current = new HudWindowController(tauriHudPort);

  useEffect(() => {
    let disposed = false;
    let unlistenReady: (() => void) | undefined;
    let unlistenHidden: (() => void) | undefined;
    if (isTauri()) {
      void listen("vantside-hud-ready", () => { void hudRef.current?.ready(); })
        .then((stop) => { if (disposed) stop(); else unlistenReady = stop; });
      void listen("vantside-hud-hidden", () => {
        setHudShown(false); void hudRef.current?.hide();
      }).then((stop) => { if (disposed) stop(); else unlistenHidden = stop; });
    }
    void navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
      if (!disposed) setMicrophones(devices.filter((device) => device.kind === "audioinput"));
    }).catch(() => undefined);
    return () => {
      disposed = true; unlistenReady?.(); unlistenHidden?.();
      void stopResources();
    };
  }, []);

  function stopResources(): Promise<void> {
    activeRef.current = false;
    sequenceRef.current++;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    captureRef.current?.abort(); captureRef.current = null;
    recorderRef.current?.discard(); recorderRef.current = null;
    requestRef.current?.abort(); requestRef.current = null;
    cueRunRef.current.cancel();
    recentRef.current = [];
    return hudRef.current?.close() ?? Promise.resolve();
  }

  async function listenForQuestion() {
    if (!activeRef.current || recorderRef.current || captureRef.current || requestRef.current) return;
    const controller = new AbortController();
    captureRef.current = controller;
    setError(""); setCueNote(""); setQuestion(""); setCues([]); setStatus("permission");
    void hudRef.current?.publish([]);
    try {
      const recorder = await startAnswerRecording(controller.signal, microphoneId || undefined);
      if (!activeRef.current || controller.signal.aborted) { recorder.discard(); return; }
      recorderRef.current = recorder;
      setStatus("listening");
      void navigator.mediaDevices.enumerateDevices().then((devices) =>
        setMicrophones(devices.filter((device) => device.kind === "audioinput"))).catch(() => undefined);
      timerRef.current = window.setTimeout(() => { void finishQuestion(); }, 55_000);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setStatus("between");
        setError(cause instanceof Error ? cause.message : "Microphone access failed. Check permission and try again.");
      }
    } finally {
      if (captureRef.current === controller) captureRef.current = null;
    }
  }

  async function startSession() {
    if (startingRef.current || activeRef.current || !consent) return;
    startingRef.current = true;
    const generation = sequenceRef.current;
    setError(""); setCueNote("");
    setStatus("opening");
    try {
      if (!isTauri()) throw new Error("Open the VantSide desktop app to use the floating HUD.");
      await hudRef.current!.show();
      if (generation !== sequenceRef.current) return;
      activeRef.current = true;
      setHudShown(true);
      if (inputMode === "microphone") await listenForQuestion();
      else setStatus("between");
    } catch (cause) {
      await stopResources();
      setStatus("ready");
      setError(cause instanceof Error ? cause.message : "The interview could not start.");
    } finally { startingRef.current = false; }
  }

  async function processQuestion(recognized: string) {
    const next = recognized.trim().slice(0, 500);
    if (next.length < 4 || !activeRef.current) { setStatus("between"); setError("No clear question was captured. Try again or type it."); return; }
    const sequence = ++sequenceRef.current;
    setQuestion(next); setCues([]); setCueNote(""); setStatus("finding");
    try {
      await hudRef.current?.publish([]);
      await cueRunRef.current.run((signal) => questionToHud({ question: next, projects, opportunity,
        recentFactIds: recentRef.current, signal }), (result) => {
        if (!activeRef.current || sequence !== sequenceRef.current) return;
        setCues(result.cues);
        void hudRef.current?.publish(result.cues);
        if (result.cues.length) recentRef.current = [...recentRef.current, ...result.cues.map((cue) => cue.factId)].slice(-10);
        else setCueNote(result.reason === "unavailable" ? "Cue decision unavailable. Continue the interview." : "No approved memory cue for this question.");
      }, (cause) => {
        if (activeRef.current && sequence === sequenceRef.current)
          setCueNote(cause instanceof Error ? cause.message : "Cue unavailable. Continue the interview.");
      });
    } catch (cause) {
      if (activeRef.current && sequence === sequenceRef.current)
        setCueNote(cause instanceof Error ? cause.message : "Cue unavailable. Continue the interview.");
    } finally {
      if (activeRef.current && sequence === sequenceRef.current) setStatus("between");
    }
  }

  async function finishQuestion() {
    const recorder = recorderRef.current;
    if (!activeRef.current || !recorder) return;
    recorderRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    let audio: string;
    try { audio = recorder.finish(); }
    catch (cause) { setStatus("between"); setError(cause instanceof Error ? cause.message : "Record a clear question and try again."); return; }
    setStatus("transcribing"); setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`${api}/interview/transcribe`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio }), signal: controller.signal });
      audio = "";
      const result: { transcript?: string; error?: string } = await response.json();
      if (!response.ok || !result.transcript) throw new Error(result.error ?? "The question could not be transcribed. Try again.");
      if (!activeRef.current || controller.signal.aborted) return;
      requestRef.current = null;
      await processQuestion(result.transcript);
    } catch (cause) {
      if (!controller.signal.aborted && activeRef.current) {
        setStatus("between");
        setError(cause instanceof Error ? cause.message : "Transcription failed. Try again or type the question.");
      }
    } finally { audio = ""; if (requestRef.current === controller) requestRef.current = null; }
  }

  function submitTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRef.current || recorderRef.current || requestRef.current || cueRunRef.current.running || typedQuestion.trim().length < 4) return;
    const text = typedQuestion.trim();
    setTypedQuestion("");
    void processQuestion(text);
  }

  async function endSession() {
    setStatus("ending");
    await stopResources();
    setStatus("ended"); setHudShown(false); setCues([]); setCueNote(""); setQuestion(""); setTypedQuestion(""); setError("");
  }

  async function toggleHud() {
    try {
      if (hudShown) { await hudRef.current?.hide(); setHudShown(false); }
      else { await hudRef.current?.show(); setHudShown(true); await hudRef.current?.publish(cues); }
    } catch { setError("The HUD could not be shown. Try again or continue the interview without a cue."); }
  }

  const running = status !== "ready" && status !== "ended";
  return <main className="app-shell"><div className="page-wrap">
    <header className="topbar"><button className="text-button" type="button" onClick={() => { void stopResources(); onBack(); }}>← Four steps</button>
      <span className="brand-lockup"><BrandMark small/><span>VantSide</span></span><span className="session-pill">PRACTICE INTERVIEW</span></header>
    <section className="interview-v1">
      <span className="eyebrow">04 / YOUR INTERVIEW</span>
      <h1>{opportunity.role}</h1><p className="interview-company">{opportunity.company}</p>
      <p className="interview-source">A practice partner can ask a question into your selected microphone. No meeting audio is captured.</p>
      <div className="interview-controls">
        <div className="interview-status" role="status" aria-live="polite"><span className={`interview-status-dot ${status}`}/>{({ ready: "Ready", opening: "Opening HUD", permission: "Opening microphone", listening: "Listening for a question", transcribing: "Transcribing question", finding: "Finding relevant memory", between: "Ready for the next question", ending: "Ending interview", ended: "Interview ended" } as const)[status]}</div>
        {!running && <><label className="field-label interview-mic">Question input<select value={inputMode} onChange={(event) => setInputMode(event.target.value as "microphone" | "text")}><option value="microphone">Microphone · spoken questions</option><option value="text">Keyboard · test or fallback</option></select></label>
          {inputMode === "microphone" && <label className="field-label interview-mic">Microphone<select value={microphoneId} onFocus={() => { void navigator.mediaDevices?.enumerateDevices?.().then((devices) => setMicrophones(devices.filter((device) => device.kind === "audioinput"))).catch(() => undefined); }} onChange={(event) => setMicrophoneId(event.target.value)}><option value="">System default</option>{microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>}
          <label className="interview-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/> This practice is permitted, and anyone whose speech is captured consents.</label>
          <button type="button" className="primary-button" disabled={!consent || startingRef.current} onClick={() => void startSession()}>Start Interview</button></>}
        {running && <>
          <div className="interview-buttons">
            {status === "listening" && <button type="button" className="primary-button" onClick={() => void finishQuestion()}>Finish Question</button>}
            {status === "between" && inputMode === "microphone" && <button type="button" className="primary-button" onClick={() => void listenForQuestion()}>Listen for Next Question</button>}
            <button type="button" className="secondary-button" disabled={status === "ending"} onClick={() => void endSession()}>End Interview</button>
            <button type="button" className="text-button" disabled={status === "ending" || status === "opening"} onClick={() => void toggleHud()}>{hudShown ? "Hide HUD" : "Show HUD"}</button>
          </div></>}
      </div>
      {error && <p className="step-error" role="alert">{error}</p>}
      {running && <><p className="interview-guidance">{status === "listening" ? "Mic on · Ask a question, then choose Finish Question." : status === "between" ? "Mic off · Answer naturally, then continue with another question." : status === "opening" || status === "permission" ? "Mic permission is requested only when spoken questions begin." : status === "ending" ? "Mic off · Closing the HUD." : "Mic off · Processing the completed question."}</p>
        <details className="interview-text-fallback" open={inputMode === "text" ? true : undefined}><summary>{inputMode === "text" ? "Type a practice question" : "Type a question instead"}</summary><form onSubmit={submitTyped}><label className="field-label">Practice question<input value={typedQuestion} maxLength={500} disabled={status !== "between"} onChange={(event) => setTypedQuestion(event.target.value)}/></label><button type="submit" className="secondary-button" disabled={typedQuestion.trim().length < 4 || status !== "between"}>Use question</button></form></details></>}
      {question && <section className="interview-recognized" aria-live="polite"><h2>Question heard</h2><p>{question}</p></section>}
      {cueNote && <p className="detail-note" role="status">{cueNote}</p>}
      {cues.length > 0 && <p className="detail-note" role="status">{cues.length} approved Career Memory {cues.length === 1 ? "cue" : "cues"} in the HUD.</p>}
    </section>
    <footer className="page-footer"><span>VantSide</span><span>Practice only · Audio and questions stay in this session</span></footer>
  </div></main>;
}
