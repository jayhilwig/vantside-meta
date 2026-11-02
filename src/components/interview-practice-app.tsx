"use client";
import { localApiHeaders } from "@/lib/local-api-auth";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BrandMark } from "./practice-app";
import { HudMinimizeHint } from "./hud-minimize-hint";
import { microphonePassed, microphoneSample, speakerPlaybackCompleted } from "@/lib/audio-test-feedback";
import { goLiveReady } from "@/lib/device-preflight";
import { startSpeakerTest, type SpeakerTest } from "@/lib/speaker-test";
import { startAnswerRecording, type AnswerRecorder } from "@/lib/record-answer";
import { questionToHud, type HudFact, type HudOpportunity } from "@/lib/interview-hud-pipeline";
import { HudWindowController, tauriHudPort } from "@/lib/hud-window";
import { LatestQuestion } from "@/lib/latest-question";
import { listSystemOutputs, startSystemOutputCapture, stopSystemOutputCapture, type SystemOutput } from "@/lib/system-output-capture";
import { looksLikeInterviewQuestion, pcm16ToWavBase64, SystemQuestionSegmenter } from "@/lib/system-question-segmenter";
import type { MemoryProject } from "@/lib/session-schema";

const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
type Status = "ready" | "opening" | "permission" | "listening" | "system-listening" | "paused" | "transcribing" | "finding" | "between" | "ending" | "ended";

export function InterviewPracticeApp({ projects, opportunity, onBack }: {
  projects: MemoryProject[]; opportunity: HudOpportunity & { roundLabel?: string; interviewer?: string }; onBack: () => void;
}) {
  const [status, setStatus] = useState<Status>("ready");
  const [consent, setConsent] = useState(false);
  const [inputMode, setInputMode] = useState<"system" | "microphone" | "text">("system");
  const [systemOutputs, setSystemOutputs] = useState<SystemOutput[]>([]);
  const [systemOutputId, setSystemOutputId] = useState("");
  const [systemOutputError, setSystemOutputError] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [speakerId, setSpeakerId] = useState("");
  const [testedMicrophoneId, setTestedMicrophoneId] = useState<string | null>(null);
  const [testedSpeakerId, setTestedSpeakerId] = useState<string | null>(null);
  const [microphoneTesting, setMicrophoneTesting] = useState(false);
  const [speakerTesting, setSpeakerTesting] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [microphoneStatus, setMicrophoneStatus] = useState("");
  const [speakerStatus, setSpeakerStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [typedQuestion, setTypedQuestion] = useState("");
  const [cues, setCues] = useState<HudFact[]>([]);
  const [hudShown, setHudShown] = useState(false);
  const [error, setError] = useState("");
  const [cueNote, setCueNote] = useState("");
  const [hudDeliveryFailed, setHudDeliveryFailed] = useState(false);
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const captureRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const cueRunRef = useRef(new LatestQuestion<Awaited<ReturnType<typeof questionToHud>>>());
  const timerRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const recentRef = useRef<string[]>([]);
  const microphoneTestRef = useRef<{ controller: AbortController; stream: MediaStream | null } | null>(null);
  const speakerTestRef = useRef<SpeakerTest | null>(null);
  const systemCaptureRef = useRef(false);
  const systemStartRef = useRef<Promise<unknown> | null>(null);
  const systemRunRef = useRef(0);
  const systemProcessingRef = useRef(false);
  const systemOutputIdRef = useRef("");
  const systemTickRef = useRef<number | null>(null);
  const systemSegmenterRef = useRef<SystemQuestionSegmenter | null>(null);
  const pendingSystemAudioRef = useRef<Int16Array | null>(null);
  const hudRef = useRef<HudWindowController | null>(null);
  if (!hudRef.current) hudRef.current = new HudWindowController(tauriHudPort);
  const devicesReady = goLiveReady({ consent, inputMode, microphoneId, speakerId, testedMicrophoneId, testedSpeakerId,
    microphoneTesting, speakerTesting });
  const startReady = inputMode === "system" ? consent && !!systemOutputId && !systemOutputError : devicesReady;

  async function refreshSystemOutputs(isCurrent: () => boolean = () => true) {
    if (!isTauri()) return;
    try {
      const outputs = await listSystemOutputs();
      if (!isCurrent()) return;
      setSystemOutputs(outputs);
      const selected = systemOutputIdRef.current;
      if (selected && !outputs.some((output) => output.id === selected) && systemCaptureRef.current) {
        void pauseSystemListening("The selected Windows output disconnected. Choose an available output and resume.");
      }
      const next = selected && outputs.some((output) => output.id === selected)
        ? selected : outputs.find((output) => output.isDefault)?.id ?? outputs[0]?.id ?? "";
      systemOutputIdRef.current = next;
      setSystemOutputId(next);
      setSystemOutputError(outputs.length ? "" : "No Windows audio output is available.");
    } catch (cause) {
      if (!isCurrent()) return;
      setSystemOutputError(cause instanceof Error ? cause.message : "Windows outputs could not be listed.");
    }
  }

  useEffect(() => {
    let disposed = false;
    let unlistenReady: (() => void) | undefined;
    let unlistenHidden: (() => void) | undefined;
    const onDeviceChange = () => {
      void refreshSystemOutputs(() => !disposed);
      setTestedMicrophoneId(null); setTestedSpeakerId(null);
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (!disposed) { setMicrophones(devices.filter((device) => device.kind === "audioinput"));
          setSpeakers(devices.filter((device) => device.kind === "audiooutput"));
          setMicrophoneId((id) => id && !devices.some((device) => device.kind === "audioinput" && device.deviceId === id) ? "" : id);
          setSpeakerId((id) => id && !devices.some((device) => device.kind === "audiooutput" && device.deviceId === id) ? "" : id); }
      }).catch(() => undefined);
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    void Promise.resolve().then(() => { if (!disposed) return refreshSystemOutputs(() => !disposed); });
    if (isTauri()) {
      void listen("vantside-hud-ready", () => { void hudRef.current?.ready(); })
        .then((stop) => { if (disposed) stop(); else unlistenReady = stop; });
      void listen("vantside-hud-hidden", () => {
        setHudShown(false); void hudRef.current?.hide();
      }).then((stop) => { if (disposed) stop(); else unlistenHidden = stop; });
    }
    void navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
      if (!disposed) { setMicrophones(devices.filter((device) => device.kind === "audioinput"));
        setSpeakers(devices.filter((device) => device.kind === "audiooutput")); }
    }).catch(() => undefined);
    return () => {
      disposed = true; unlistenReady?.(); unlistenHidden?.();
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      void stopResources();
    };
  // Device discovery is intentionally bound once to this session's mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopResources(): Promise<void> {
    activeRef.current = false;
    sequenceRef.current++;
    systemRunRef.current++;
    systemSegmenterRef.current?.reset(); systemSegmenterRef.current = null;
    pendingSystemAudioRef.current = null;
    if (systemTickRef.current !== null) window.clearInterval(systemTickRef.current);
    systemTickRef.current = null;
    microphoneTestRef.current?.controller.abort();
    microphoneTestRef.current?.stream?.getTracks().forEach((track) => track.stop());
    microphoneTestRef.current = null;
    speakerTestRef.current?.stop(); speakerTestRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    captureRef.current?.abort(); captureRef.current = null;
    recorderRef.current?.discard(); recorderRef.current = null;
    requestRef.current?.abort(); requestRef.current = null;
    cueRunRef.current.cancel();
    recentRef.current = [];
    const stop = systemStartRef.current;
    systemCaptureRef.current = false;
    return Promise.allSettled([stop?.catch(() => undefined).then(() => stopSystemOutputCapture()),
      hudRef.current?.close()]).then(() => undefined);
  }

  async function refreshDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMicrophones(devices.filter((device) => device.kind === "audioinput"));
    setSpeakers(devices.filter((device) => device.kind === "audiooutput"));
  }

  async function revealMicrophones() {
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop()); await refreshDevices(); }
    catch (cause) { setMicrophoneStatus(cause instanceof Error ? cause.message : "Microphone access is unavailable."); }
  }

  async function testMicrophone() {
    if (microphoneTestRef.current || speakerTestRef.current) return;
    const test = { controller: new AbortController(), stream: null as MediaStream | null };
    microphoneTestRef.current = test;
    setMicrophoneTesting(true); setTestedMicrophoneId(null); setMicrophoneStatus("");
    let context: AudioContext | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true });
      test.stream = stream;
      if (test.controller.signal.aborted) return;
      context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      await refreshDevices(); if (test.controller.signal.aborted) return;
      setMicrophoneStatus("Speak to test your microphone…");
      let streak = 0; let passed = false;
      for (let i = 0; i < 38 && !test.controller.signal.aborted; i++) {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        const level = Math.min(100, Math.round(rms * 400)); setMicrophoneLevel(level);
        streak = microphoneSample(level, streak); if (microphonePassed(streak)) passed = true;
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
      if (!test.controller.signal.aborted) {
        if (passed) setTestedMicrophoneId(microphoneId);
        setMicrophoneStatus(passed ? "Input detected" : "Input was too quiet. Check your microphone and try again.");
      }
    } catch (cause) { if (!test.controller.signal.aborted) setMicrophoneStatus(cause instanceof Error ? cause.message : "Microphone test failed."); }
    finally { test.stream?.getTracks().forEach((track) => track.stop()); if (context) await context.close();
      if (microphoneTestRef.current === test) { microphoneTestRef.current = null; setMicrophoneTesting(false); setMicrophoneLevel(0); } }
  }

  async function testSpeaker() {
    if (speakerTestRef.current || microphoneTestRef.current) return;
    const test = startSpeakerTest(speakerId); speakerTestRef.current = test;
    setSpeakerTesting(true); setTestedSpeakerId(null); setSpeakerStatus("Playing speaker test");
    try { if (speakerPlaybackCompleted(await test.finished) && speakerTestRef.current === test) {
      setTestedSpeakerId(speakerId); setSpeakerStatus("Playback completed");
    } } catch (cause) { if (speakerTestRef.current === test) setSpeakerStatus(cause instanceof Error ? cause.message : "Speaker test failed."); }
    finally { if (speakerTestRef.current === test) { speakerTestRef.current = null; setSpeakerTesting(false); } }
  }

  function stopSpeakerTest() {
    speakerTestRef.current?.stop(); speakerTestRef.current = null;
    setSpeakerTesting(false); setTestedSpeakerId(null); setSpeakerStatus("");
  }

  async function listenForQuestion() {
    if (!activeRef.current || recorderRef.current || captureRef.current || requestRef.current) return;
    const controller = new AbortController();
    captureRef.current = controller;
    setError(""); setCueNote(""); setQuestion(""); setCues([]); setStatus("permission");
    void hudRef.current?.publish([]).catch(() => setCueNote("The HUD could not clear its previous cue. Hide and show it, or try again."));
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

  async function handleSystemSegment(initial: Int16Array, run: number) {
    if (systemProcessingRef.current) { pendingSystemAudioRef.current = initial; return; }
    systemProcessingRef.current = true;
    let segment: Int16Array | null = initial;
    try {
      while (segment && activeRef.current && run === systemRunRef.current) {
        setStatus("transcribing"); setError("");
        const controller = new AbortController(); requestRef.current = controller;
        try {
          let audio = pcm16ToWavBase64(segment);
          const response = await fetch(`${api}/interview/transcribe`, { method: "POST",
            headers: await localApiHeaders(), body: JSON.stringify({ audio }), signal: controller.signal });
          audio = "";
          const result: { transcript?: string; error?: string } = await response.json().catch(() => {
            throw new Error("Meta transcription returned unreadable data.");
          });
          if (!response.ok || !result.transcript) throw new Error(result.error ?? "Meta could not transcribe the output audio.");
          if (controller.signal.aborted || run !== systemRunRef.current || !activeRef.current) return;
          if (looksLikeInterviewQuestion(result.transcript)) await processQuestion(result.transcript);
          else { setCueNote("No complete interview question heard yet."); setStatus("system-listening"); }
        } catch (cause) {
          if (!controller.signal.aborted && activeRef.current && run === systemRunRef.current) {
            setError(cause instanceof Error ? cause.message : "Output transcription failed. Pause and retry.");
            setStatus("system-listening");
          }
        } finally { if (requestRef.current === controller) requestRef.current = null; }
        segment = pendingSystemAudioRef.current;
        pendingSystemAudioRef.current = null;
      }
    } finally {
      systemProcessingRef.current = false;
      const pending = pendingSystemAudioRef.current;
      if (pending && activeRef.current && systemCaptureRef.current) {
        pendingSystemAudioRef.current = null;
        void handleSystemSegment(pending, systemRunRef.current);
      }
    }
  }

  async function startSystemListening() {
    const outputId = systemOutputIdRef.current;
    if (!activeRef.current || !outputId || systemCaptureRef.current) return;
    const run = ++systemRunRef.current;
    setError(""); setCueNote("");
    const segmenter = new SystemQuestionSegmenter((pcm) => {
      if (activeRef.current && run === systemRunRef.current) void handleSystemSegment(pcm, run);
    }, () => { if (run === systemRunRef.current) setCueNote("A long audio segment was skipped. Pause playback briefly between questions."); });
    systemSegmenterRef.current = segmenter;
    setStatus("opening");
    const start = startSystemOutputCapture(outputId, (samples) => {
      if (activeRef.current && run === systemRunRef.current) segmenter.push(samples);
    }, (message) => { if (run === systemRunRef.current) void pauseSystemListening(message); });
    systemStartRef.current = start;
    try {
      await start;
      if (run !== systemRunRef.current || !activeRef.current) { await stopSystemOutputCapture(); return; }
      systemCaptureRef.current = true;
      systemTickRef.current = window.setInterval(() => segmenter.tick(), 200);
      setStatus("system-listening");
    } catch (cause) {
      if (run === systemRunRef.current) {
        systemSegmenterRef.current = null;
        setStatus("paused");
        setError(cause instanceof Error ? cause.message : "Windows output capture could not start.");
      }
    }
  }

  async function pauseSystemListening(message = "") {
    systemRunRef.current++;
    systemSegmenterRef.current?.reset(); systemSegmenterRef.current = null;
    pendingSystemAudioRef.current = null;
    if (systemTickRef.current !== null) window.clearInterval(systemTickRef.current);
    systemTickRef.current = null;
    requestRef.current?.abort(); requestRef.current = null;
    cueRunRef.current.cancel(); sequenceRef.current++;
    const start = systemStartRef.current;
    systemCaptureRef.current = false;
    await start?.catch(() => undefined);
    await stopSystemOutputCapture().catch(() => undefined);
    systemStartRef.current = null;
    if (activeRef.current) { setStatus("paused"); if (message) setError(message); }
  }

  async function startSession() {
    if (startingRef.current || activeRef.current || !startReady) return;
    startingRef.current = true;
    const generation = sequenceRef.current;
    setError(""); setCueNote(""); setCues([]); setQuestion(""); setHudDeliveryFailed(false);
    setStatus("opening");
    try {
      if (!isTauri()) throw new Error("Open the VantSide desktop app to use the floating HUD.");
      await hudRef.current!.show();
      if (generation !== sequenceRef.current) return;
      activeRef.current = true;
      setHudShown(true);
      if (inputMode === "microphone") await listenForQuestion();
      else if (inputMode === "system") await startSystemListening();
      else setStatus("between");
    } catch (cause) {
      await stopResources();
      setStatus("ready");
      setError(cause instanceof Error ? cause.message : "The interview could not start.");
    } finally { startingRef.current = false; }
  }

  async function processQuestion(recognized: string) {
    const next = recognized.trim().slice(0, 500);
    if (next.length < 4 || !activeRef.current) { setStatus(inputMode === "system" ? "system-listening" : "between"); setError("No clear question was captured. Try again or type it."); return; }
    const sequence = ++sequenceRef.current;
    setQuestion(next); setCues([]); setCueNote(""); setHudDeliveryFailed(false); setStatus("finding");
    try {
      await hudRef.current?.publish([]).catch(() => { setHudDeliveryFailed(true); });
      await cueRunRef.current.run((signal) => questionToHud({ question: next, projects, opportunity,
        recentFactIds: recentRef.current, signal }), (result) => {
        if (!activeRef.current || sequence !== sequenceRef.current) return;
        setCues(result.cues);
        void hudRef.current?.publish(result.cues).then(() => { if (activeRef.current && sequence === sequenceRef.current) setHudDeliveryFailed(false); })
          .catch(() => { if (activeRef.current && sequence === sequenceRef.current) { setHudDeliveryFailed(true); setCueNote("The floating HUD could not update. Try Show HUD or the next question."); } });
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
      if (activeRef.current && sequence === sequenceRef.current) setStatus(inputMode === "system" ? "system-listening" : "between");
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
        headers: await localApiHeaders(), body: JSON.stringify({ audio }), signal: controller.signal });
      audio = "";
      const result: { transcript?: string; error?: string } = await response.json().catch(() => {
        throw new Error("The transcription service returned unreadable data. Try the question again.");
      });
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
    setTestedMicrophoneId(null); setTestedSpeakerId(null); setMicrophoneStatus(""); setSpeakerStatus(""); setHudDeliveryFailed(false);
  }

  async function toggleHud() {
    const generation = sequenceRef.current;
    try {
      if (hudShown) { await hudRef.current?.hide(); setHudShown(false); }
      else { await hudRef.current?.show(); if (!activeRef.current || generation !== sequenceRef.current) return;
        setHudShown(true); await hudRef.current?.publish(cues); setHudDeliveryFailed(false); }
    } catch { setError("The HUD could not be shown. Try again or continue the interview without a cue."); }
  }

  const running = status !== "ready" && status !== "ended";
  return <main className="app-shell"><div className="page-wrap">
    <header className="topbar"><button className="text-button" type="button" onClick={() => { void stopResources().finally(onBack); }}>← Four steps</button>
      <span className="brand-lockup"><BrandMark small/><span>VantSide</span></span><span className="session-pill">PRACTICE INTERVIEW</span></header>
    <section className="interview-v1">
      <span className="eyebrow">04 / YOUR INTERVIEW</span>
      <h1>{opportunity.role}</h1><p className="interview-company">{opportunity.company}{opportunity.roundLabel ? ` · ${opportunity.roundLabel}` : ""}{opportunity.interviewer ? ` · ${opportunity.interviewer}` : ""}</p>
      <p className="interview-source">{inputMode === "system" ? "Practice only · Listens to Windows playback on the selected output after you start. Your microphone stays separate." : "A practice partner can ask a question into your selected microphone."}</p>
      <div className="interview-controls">
        <div className="interview-status" role="status" aria-live="polite"><span className={`interview-status-dot ${status}`}/>{status === "ended" ? "Interview ended" : status === "ready"
          ? !consent ? "Confirm permitted practice to continue" : startReady ? "Ready" : inputMode === "system" ? "Choose a Windows output to continue" : "Test microphone and speaker to continue"
          : ({ opening: "Opening HUD or audio", permission: "Opening microphone", listening: "Listening for a question", "system-listening": "Listening to Windows output", paused: "Listening paused", transcribing: "Transcribing question", finding: "Finding relevant memory", between: "Ready for the next question", ending: "Ending interview" } as const)[status]}</div>
        {!running && <><label className="field-label interview-mic">Question input<select value={inputMode} onChange={(event) => setInputMode(event.target.value as "system" | "microphone" | "text")}><option value="system">Windows output · automatic listening</option><option value="microphone">Microphone · manual question</option><option value="text">Keyboard · test or fallback</option></select></label>
          {inputMode === "system" ? <div className="audio-devices"><label className="field-label">Windows output to monitor<select value={systemOutputId} onChange={(event) => { systemOutputIdRef.current = event.target.value; setSystemOutputId(event.target.value); setSystemOutputError(""); }}><option value="" disabled>Choose an output</option>{systemOutputs.map((output) => <option key={output.id} value={output.id}>{output.name}{output.isDefault ? " · default" : ""}</option>)}</select></label><button type="button" className="text-button" onClick={() => void refreshSystemOutputs()}>Refresh outputs</button>{systemOutputError && <p className="step-error" role="alert">{systemOutputError}</p>}</div> : <details className="audio-devices" open><summary>Audio setup</summary><div className="audio-device-grid">
            <section className="device-card" aria-label="Microphone setup"><h3>Microphone</h3><label>Input<select value={microphoneId} disabled={microphoneTesting} onPointerDown={() => void revealMicrophones()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void revealMicrophones(); }} onFocus={() => void refreshDevices().catch(() => undefined)} onChange={(event) => { setMicrophoneId(event.target.value); setTestedMicrophoneId(null); setMicrophoneStatus(""); }}><option value="">System default</option>{microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={microphoneTesting || speakerTesting} onClick={() => void testMicrophone()}>Test microphone</button><meter min="0" max="100" value={microphoneLevel} aria-label="Microphone level"/></div>{microphoneStatus && <span className="device-status" role="status"><span className={testedMicrophoneId === microphoneId ? "test-check" : ""} aria-hidden="true">{testedMicrophoneId === microphoneId ? "✓" : ""}</span>{microphoneStatus}</span>}</section>
            <section className="device-card" aria-label="Speaker setup"><h3>Speaker</h3><label>Output{typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && speakers.length ? <select value={speakerId} disabled={speakerTesting} onChange={(event) => { setSpeakerId(event.target.value); setTestedSpeakerId(null); setSpeakerStatus(""); }}><option value="">{speakers.find((device) => device.deviceId === "default")?.label || "System default"}</option>{speakers.filter((device) => device.deviceId !== "default").map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Speaker ${index + 1}`}</option>)}</select> : <span className="device-default">System output</span>}</label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={microphoneTesting} onClick={() => { if (speakerTesting) stopSpeakerTest(); else void testSpeaker(); }}>{speakerTesting ? "Stop" : "Test speaker"}</button></div>{speakerStatus && <span className="device-status" role="status"><span className={testedSpeakerId === speakerId ? "test-check" : ""} aria-hidden="true">{testedSpeakerId === speakerId ? "✓" : ""}</span>{speakerStatus}</span>}</section>
          </div></details>}
          <label className="interview-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/> This practice is permitted, everyone whose speech is captured consents, and audio may be sent to Meta for transcription.</label>
          <button type="button" className="primary-button" disabled={!startReady || startingRef.current} onClick={() => void startSession()}>{inputMode === "system" ? "Start Listening" : "Start Interview"}</button></>}
        {running && <>
          <div className="interview-buttons">
            {status === "listening" && <button type="button" className="primary-button" onClick={() => void finishQuestion()}>Finish Question</button>}
            {status === "between" && inputMode === "microphone" && <button type="button" className="primary-button" onClick={() => void listenForQuestion()}>Listen for Next Question</button>}
            {inputMode === "system" && status !== "paused" && <button type="button" className="secondary-button" disabled={status === "ending" || status === "opening"} onClick={() => void pauseSystemListening()}>Pause</button>}
            {inputMode === "system" && status === "paused" && <button type="button" className="primary-button" disabled={!systemOutputId} onClick={() => void startSystemListening()}>Resume</button>}
            <button type="button" className="secondary-button" disabled={status === "ending"} onClick={() => void endSession()}>{inputMode === "system" ? "Stop" : "End Interview"}</button>
            <button type="button" className="text-button" disabled={status === "ending" || status === "opening"} onClick={() => void toggleHud()}>{hudShown ? "Hide HUD" : "Show HUD"}</button>
          </div></>}
      </div>
      <HudMinimizeHint visible={running && hudShown}/>
      {error && <p className="step-error" role="alert">{error}</p>}
      {running && <><p className="interview-guidance">{inputMode === "system" ? status === "system-listening" ? "Windows playback is being transcribed in short, completed segments. No microphone audio is included." : status === "paused" ? "Windows playback capture is off." : "Processing Windows playback audio." : status === "listening" ? "Mic on · Ask a question, then choose Finish Question." : status === "between" ? "Mic off · Answer naturally, then continue with another question." : status === "opening" || status === "permission" ? "Mic permission is requested only when spoken questions begin." : status === "ending" ? "Mic off · Closing the HUD." : "Mic off · Processing the completed question."}</p>
        {inputMode !== "system" && <details className="interview-text-fallback" open={inputMode === "text" ? true : undefined}><summary>{inputMode === "text" ? "Type a practice question" : "Type a question instead"}</summary><form onSubmit={submitTyped}><label className="field-label">Practice question<input value={typedQuestion} maxLength={500} disabled={status !== "between"} onChange={(event) => setTypedQuestion(event.target.value)}/></label><button type="submit" className="secondary-button" disabled={typedQuestion.trim().length < 4 || status !== "between"}>Use question</button></form></details>}</>}
      {question && <section className="interview-recognized" aria-live="polite"><h2>Question heard</h2><p>{question}</p></section>}
      {cueNote && <p className="detail-note" role="status">{cueNote}</p>}
      {cues.length > 0 && !hudDeliveryFailed && <p className="detail-note" role="status">{cues.length} approved Career Memory {cues.length === 1 ? "cue" : "cues"} in the HUD.</p>}
    </section>
    <footer className="page-footer"><span>VantSide</span><span>Practice only · Audio and questions stay in this session</span></footer>
  </div></main>;
}
