"use client";
import { localApiHeaders } from "@/lib/local-api-auth";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BrandMark } from "./practice-app";
import { HudVisibilityIcon } from "./hud-visibility-icon";
import { HudMinimizeGuidance } from "./hud-minimize-guidance";
import { microphonePassed, microphoneSample, speakerPlaybackCompleted } from "@/lib/audio-test-feedback";
import { goLiveReady, systemOutputReady } from "@/lib/device-preflight";
import { startSpeakerTest, type SpeakerTest } from "@/lib/speaker-test";
import { startAnswerRecording, type AnswerRecorder } from "@/lib/record-answer";
import { questionToHud, type HudFact, type HudOpportunity } from "@/lib/interview-hud-pipeline";
import { HudWindowController, tauriHudPort, type HudCueState, type HudSessionStatus, type HudSnapshot } from "@/lib/hud-window";
import { LatestQuestion } from "@/lib/latest-question";
import { listSystemOutputs, startSystemOutputCapture, stopSystemOutputCapture, type SystemOutput } from "@/lib/system-output-capture";
import { looksLikeInterviewQuestion, pcm16ToWavBase64, pcmLevel, SystemQuestionSegmenter } from "@/lib/system-question-segmenter";
import { goLiveAudioHealth } from "@/lib/go-live-audio-health";
import { addSessionQuestion, dispatchGoLiveHudAction, interruptSessionQuestions, settleSessionQuestion,
  type GoLiveHudAction, type QuestionOutcome, type SessionQuestion } from "@/lib/go-live-session";
import { goLiveInterviewOccurred } from "@/lib/interview-rounds";
import type { MemoryProject } from "@/lib/session-schema";
import { hudCuePreparer, liveMetaCueQa } from "@/lib/hud-cue-preparation-port";
import { hudPreparationAllowsStart, type HudPreparationState, type PreparedCueMap } from "@/lib/hud-cue-preparation";
import { HudPreparationStatus } from "./hud-preparation-status";

const api = (process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
type Status = "ready" | "opening" | "permission" | "listening" | "system-listening" | "paused" | "transcribing" | "finding" | "between" | "ending" | "ended";
function hudStatus(status: Status): HudSessionStatus {
  if (status === "listening" || status === "system-listening") return "listening";
  if (status === "paused") return "paused";
  if (status === "opening" || status === "transcribing" || status === "finding" || status === "permission" || status === "ending") return "processing";
  if (status === "ended") return "stopped";
  return "ready";
}
type CaptureDiagnostics = { initialization: string; packets: number; level: number; segments: number; transcription: string;
  question: string; approved: number | null; eligible: number | null; jev: string; meta: string; hud: string };
const emptyDiagnostics = (): CaptureDiagnostics => ({ initialization: "Not started", packets: 0, level: 0, segments: 0,
  transcription: "Not attempted", question: "Not checked", approved: null, eligible: null, jev: "Not checked", meta: "Not checked", hud: "Not shown" });
const outcomeLabel: Record<QuestionOutcome, string> = { processing: "Finding a cue", cue: "Career Memory cue shown",
  "no-cue": "No cue recommended", "no-match": "No relevant approved cue", unavailable: "Cue unavailable", interrupted: "Stopped before cue selection" };

export function InterviewPracticeApp({ projects, opportunity, onBack, onCompleted }: {
  projects: MemoryProject[]; opportunity: HudOpportunity & { roundLabel?: string; interviewer?: string }; onBack: () => void;
  onCompleted(): Promise<void>;
}) {
  const [status, setStatus] = useState<Status>("ready");
  const [consent, setConsent] = useState(false);
  const [inputMode, setInputMode] = useState<"system" | "microphone" | "text">("system");
  const [systemOutputs, setSystemOutputs] = useState<SystemOutput[]>([]);
  const [systemOutputId, setSystemOutputId] = useState("");
  const [systemOutputError, setSystemOutputError] = useState("");
  const [outputRefreshNotice, setOutputRefreshNotice] = useState("");
  const [outputTestStatus, setOutputTestStatus] = useState("");
  const [outputTesting, setOutputTesting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CaptureDiagnostics>(emptyDiagnostics);
  const [captureHealth, setCaptureHealth] = useState("");
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
  const [sessionQuestions, setSessionQuestions] = useState<SessionQuestion[]>([]);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [cues, setCues] = useState<HudFact[]>([]);
  const [hudCueState, setHudCueState] = useState<HudCueState>("idle");
  const [preparedState, setPreparedState] = useState<{ projects: MemoryProject[]; state: HudPreparationState } | null>(null);
  const preparation: HudPreparationState = liveMetaCueQa ? "ready" : preparedState?.projects === projects ? preparedState.state : "preparing";
  const preparedCuesRef = useRef<PreparedCueMap>({});
  const [hudShown, setHudShown] = useState(false);
  const [error, setError] = useState("");
  const [cueNote, setCueNote] = useState("");
  const [hudDeliveryFailed, setHudDeliveryFailed] = useState(false);
  const activeRef = useRef(false);
  const listeningStartedRef = useRef(false);
  const questionRecognizedRef = useRef(false);
  const startingRef = useRef(false);
  const captureRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const cueRunRef = useRef(new LatestQuestion<Awaited<ReturnType<typeof questionToHud>>>());
  const timerRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const hudRunRef = useRef(0);
  const recentRef = useRef<string[]>([]);
  const microphoneTestRef = useRef<{ controller: AbortController; stream: MediaStream | null } | null>(null);
  const speakerTestRef = useRef<SpeakerTest | null>(null);
  const systemCaptureRef = useRef(false);
  const systemStartRef = useRef<Promise<unknown> | null>(null);
  const pausingRef = useRef<Promise<void> | null>(null);
  const systemRunRef = useRef(0);
  const systemProcessingRef = useRef(false);
  const systemOutputIdRef = useRef("");
  const systemOutputsRef = useRef<SystemOutput[]>([]);
  const outputTestRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const outputTestTimerRef = useRef<number | null>(null);
  const selectedWasDefaultRef = useRef(false);
  const startedAtRef = useRef(0);
  const lastPacketAtRef = useRef(0);
  const everSpeechRef = useRef(false);
  const packetCountRef = useRef(0);
  const segmentCountRef = useRef(0);
  const systemTickRef = useRef<number | null>(null);
  const systemDeviceTimerRef = useRef<number | null>(null);
  const systemSegmenterRef = useRef<SystemQuestionSegmenter | null>(null);
  const pendingSystemAudioRef = useRef<Int16Array | null>(null);
  const hudRef = useRef<HudWindowController | null>(null);
  const hudSnapshotRef = useRef<HudSnapshot | null>(null);
  const hudCommandRef = useRef<(action: GoLiveHudAction) => void>(() => undefined);
  const stoppingRef = useRef<Promise<void> | null>(null);
  const closingHudRef = useRef<Promise<void> | null>(null);
  if (!hudRef.current) hudRef.current = new HudWindowController(tauriHudPort);
  const devicesReady = goLiveReady({ consent, inputMode, microphoneId, speakerId, testedMicrophoneId, testedSpeakerId,
    microphoneTesting, speakerTesting });
  const startReady = hudPreparationAllowsStart(preparation) && (inputMode === "system" ? systemOutputReady(consent, systemOutputId, systemOutputError, outputTesting) : devicesReady);

  useEffect(() => {
    if (liveMetaCueQa) return;
    let current = true;
    preparedCuesRef.current = {};
    void hudCuePreparer.prepare(projects).then((result) => {
      if (!current) return;
      preparedCuesRef.current = result.cues;
      setPreparedState({ projects, state: result.usedFallback ? "fallback" : "ready" });
    }).catch(() => { if (current) setPreparedState({ projects, state: "fallback" }); });
    return () => { current = false; };
  }, [projects]);

  useEffect(() => {
    let current = true;
    const snapshot: HudSnapshot = { status: status === "ready" && preparation === "preparing" ? "processing" : hudStatus(status), question, cues,
      noMatch: hudCueState === "no-match", cueState: hudCueState,
      controls: { kind: "go-live", automatic: inputMode === "system", startAllowed: status === "ready" && inputMode === "system" && startReady,
        startHint: preparation === "preparing" ? "Preparing your interview in VantSide." : !consent ? "Confirm consent in VantSide." : !systemOutputId ? "Choose a Windows output in VantSide." :
          inputMode !== "system" ? "Start this input mode in VantSide." : "Complete setup in VantSide." } };
    hudSnapshotRef.current = snapshot;
    void hudRef.current?.publish(snapshot)
      .then(() => { if (current && hudShown && cues.length) setDiagnostics((old) => ({ ...old,
        hud: old.hud.endsWith("rendered") ? old.hud : "Cue event sent, awaiting HUD" })); })
      .catch(() => { if (current) { setHudDeliveryFailed(true);
        setDiagnostics((old) => ({ ...old, hud: "Delivery failed" })); } });
    return () => { current = false; };
  }, [status, question, cues, hudCueState, hudShown, startReady, inputMode, consent, systemOutputId, preparation]);

  useEffect(() => {
    hudCommandRef.current = (action) => {
      if (inputMode !== "system" && action !== "close") return;
      void dispatchGoLiveHudAction(action, hudStatus(status), inputMode === "system" && startReady,
        { start: startSession, pause: pauseSystemListening, resume: startSystemListening,
          stop: endSession, close: closeHudSession });
    };
  });

  async function refreshSystemOutputs(isCurrent: () => boolean = () => true, announce = false) {
    if (!isTauri()) return;
    try {
      const outputs = await listSystemOutputs();
      if (!isCurrent()) return;
      if (announce) {
        const before = systemOutputsRef.current.map((output) => `${output.id}:${output.name}:${output.isDefault}`).join("|");
        const after = outputs.map((output) => `${output.id}:${output.name}:${output.isDefault}`).join("|");
        setOutputRefreshNotice(before === after ? "Output list is unchanged." : "Output list refreshed.");
      }
      systemOutputsRef.current = outputs;
      setSystemOutputs(outputs);
      const selected = systemOutputIdRef.current;
      if (selected && !outputs.some((output) => output.id === selected) && systemCaptureRef.current) {
        void pauseSystemListening("The selected Windows output disconnected. Choose an available output and resume.");
      } else if (systemCaptureRef.current && selectedWasDefaultRef.current &&
        outputs.find((output) => output.isDefault)?.id !== selected) {
        void pauseSystemListening("Windows changed its default output. Choose the output now playing interview audio, then resume.");
      }
      const next = selected && outputs.some((output) => output.id === selected)
        ? selected : outputs.find((output) => output.isDefault)?.id ?? outputs[0]?.id ?? "";
      systemOutputIdRef.current = next;
      setSystemOutputId(next);
      setSystemOutputError(outputs.length ? "" : "No Windows audio output is available.");
    } catch (cause) {
      if (!isCurrent()) return;
      setSystemOutputError(cause instanceof Error ? cause.message : "Windows outputs could not be listed.");
      if (announce) setOutputRefreshNotice("Output refresh failed.");
    }
  }

  useEffect(() => {
    let disposed = false;
    let unlistenReady: (() => void) | undefined;
    let unlistenHidden: (() => void) | undefined;
    let unlistenRendered: (() => void) | undefined;
    let unlistenCommand: (() => void) | undefined;
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
        hudRunRef.current++;
        setHudShown(false); void hudRef.current?.hide();
      }).then((stop) => { if (disposed) stop(); else unlistenHidden = stop; });
      void listen<{ action?: GoLiveHudAction }>("vantside-hud-command", ({ payload }) => {
        if (!disposed && ["start", "pause", "resume", "stop", "close"].includes(payload?.action ?? ""))
          hudCommandRef.current(payload.action!);
      }).then((stop) => { if (disposed) stop(); else unlistenCommand = stop; });
      void listen<{ count?: number }>("vantside-hud-rendered", ({ payload }) => {
        if (activeRef.current && Number.isInteger(payload?.count) && (payload.count ?? 0) > 0)
          setDiagnostics((current) => ({ ...current, hud: `${payload.count} cue${payload.count === 1 ? "" : "s"} rendered` }));
      }).then((stop) => { if (disposed) stop(); else unlistenRendered = stop; });
    }
    void navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
      if (!disposed) { setMicrophones(devices.filter((device) => device.kind === "audioinput"));
        setSpeakers(devices.filter((device) => device.kind === "audiooutput")); }
    }).catch(() => undefined);
    return () => {
      disposed = true; unlistenReady?.(); unlistenHidden?.(); unlistenRendered?.(); unlistenCommand?.();
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      void stopResources();
    };
  // Device discovery is intentionally bound once to this session's mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopResources(closeHud = true): Promise<void> {
    activeRef.current = false;
    sequenceRef.current++;
    hudRunRef.current++;
    systemRunRef.current++;
    systemSegmenterRef.current?.reset(); systemSegmenterRef.current = null;
    pendingSystemAudioRef.current = null;
    if (systemTickRef.current !== null) window.clearInterval(systemTickRef.current);
    systemTickRef.current = null;
    if (systemDeviceTimerRef.current !== null) window.clearInterval(systemDeviceTimerRef.current);
    systemDeviceTimerRef.current = null;
    const stopOutputTest = outputTestRef.current?.stop();
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
    systemStartRef.current = null;
    systemCaptureRef.current = false;
    return Promise.allSettled([stopOutputTest, stop?.catch(() => undefined).then(() => stopSystemOutputCapture()),
      closeHud ? hudRef.current?.close() : undefined]).then(() => undefined);
  }

  async function testSystemOutput() {
    if (!systemOutputIdRef.current || outputTestRef.current || activeRef.current) return;
    const outputId = systemOutputIdRef.current;
    let cancelled = false;
    let heard = false;
    const test = { stop: async () => {
      if (cancelled) return;
      cancelled = true;
      if (outputTestTimerRef.current !== null) window.clearTimeout(outputTestTimerRef.current);
      outputTestTimerRef.current = null;
      await start?.catch(() => undefined);
      await stopSystemOutputCapture().catch(() => undefined);
      if (outputTestRef.current === test) { outputTestRef.current = null; setOutputTesting(false); }
    } };
    outputTestRef.current = test;
    setOutputTesting(true);
    setOutputTestStatus("Play a short question in Windows Media Player through this output.");
    const start = startSystemOutputCapture(outputId, (samples) => {
      if (cancelled || heard) return;
      if (pcmLevel(samples) >= 0.009) {
        heard = true;
        setOutputTestStatus("Audio detected on this Windows output.");
        void test.stop();
      }
    }, (message) => { if (!cancelled) { setOutputTestStatus(message); void test.stop(); } });
    try {
      await start;
      if (cancelled) return;
      outputTestTimerRef.current = window.setTimeout(() => {
        if (!heard && !cancelled) setOutputTestStatus("No playback reached this output. Check Media Player’s output in Windows Volume Mixer, then try again.");
        void test.stop();
      }, 8_000);
    } catch (cause) {
      if (!cancelled) setOutputTestStatus(cause instanceof Error ? cause.message : "The selected Windows output could not be tested.");
      void test.stop();
    }
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
    setError(""); setCueNote(""); setQuestion(""); setCues([]); setHudCueState("idle"); setStatus("permission");
    try {
      const recorder = await startAnswerRecording(controller.signal, microphoneId || undefined);
      if (!activeRef.current || controller.signal.aborted) { recorder.discard(); return; }
      recorderRef.current = recorder;
      listeningStartedRef.current = true;
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
        setDiagnostics((current) => ({ ...current, transcription: "Attempting Meta transcription" }));
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
          setDiagnostics((current) => ({ ...current, transcription: "Succeeded" }));
          if (looksLikeInterviewQuestion(result.transcript)) {
            setDiagnostics((current) => ({ ...current, question: "Recognized" }));
            await processQuestion(result.transcript);
          } else { setDiagnostics((current) => ({ ...current, question: "Not recognized as a question" }));
            setCueNote("Speech was transcribed, but no interview question was recognized."); setStatus("system-listening"); }
        } catch (cause) {
          if (!controller.signal.aborted && activeRef.current && run === systemRunRef.current) {
            setDiagnostics((current) => ({ ...current, transcription: "Failed" }));
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
    if (!activeRef.current || !outputId || systemCaptureRef.current || systemStartRef.current || pausingRef.current) return;
    const run = ++systemRunRef.current;
    setError(""); setCueNote("");
    setCaptureHealth(""); setDiagnostics({ ...emptyDiagnostics(), initialization: "Starting" });
    startedAtRef.current = Date.now(); lastPacketAtRef.current = 0; everSpeechRef.current = false;
    packetCountRef.current = 0; segmentCountRef.current = 0;
    selectedWasDefaultRef.current = Boolean(systemOutputs.find((output) => output.id === outputId)?.isDefault);
    const segmenter = new SystemQuestionSegmenter((pcm) => {
      if (activeRef.current && run === systemRunRef.current) {
        segmentCountRef.current++;
        setDiagnostics((current) => ({ ...current, segments: current.segments + 1 }));
        void handleSystemSegment(pcm, run);
      }
    }, () => { if (run === systemRunRef.current) setCueNote("A long audio segment was skipped. Pause playback briefly between questions."); },
    (level, voiced) => {
      if (run !== systemRunRef.current) return;
      if (voiced) everSpeechRef.current = true;
      setDiagnostics((current) => ({ ...current, level: Math.min(100, Math.round(level * 400)) }));
    });
    systemSegmenterRef.current = segmenter;
    setStatus("opening");
    const start = startSystemOutputCapture(outputId, (samples) => {
      if (activeRef.current && run === systemRunRef.current) {
        lastPacketAtRef.current = Date.now();
        packetCountRef.current++;
        setCaptureHealth((current) => current.startsWith("No playback") ? "" : current);
        setDiagnostics((current) => ({ ...current, packets: current.packets + 1 }));
        segmenter.push(samples);
      }
    }, (message) => { if (run === systemRunRef.current) void pauseSystemListening(message); });
    systemStartRef.current = start;
    try {
      await start;
      if (run !== systemRunRef.current || !activeRef.current) { await stopSystemOutputCapture(); return; }
      systemCaptureRef.current = true;
      listeningStartedRef.current = true;
      systemTickRef.current = window.setInterval(() => {
        segmenter.tick();
        if (run === systemRunRef.current) setCaptureHealth(goLiveAudioHealth(Date.now() - startedAtRef.current,
          packetCountRef.current, everSpeechRef.current, segmentCountRef.current,
          lastPacketAtRef.current ? Date.now() - lastPacketAtRef.current : Date.now() - startedAtRef.current));
      }, 200);
      systemDeviceTimerRef.current = window.setInterval(() => { void refreshSystemOutputs(); }, 2_000);
      setDiagnostics((current) => ({ ...current, initialization: "Captured selected Windows output" }));
      setStatus("system-listening");
    } catch (cause) {
      if (run === systemRunRef.current) {
        systemSegmenterRef.current = null;
        systemStartRef.current = null;
        setDiagnostics((current) => ({ ...current, initialization: "Failed" }));
        setStatus("paused");
        setError(cause instanceof Error ? cause.message : "Windows output capture could not start.");
      }
    }
  }

  async function pauseSystemListening(message = "") {
    if (pausingRef.current) return pausingRef.current;
    const pausing = (async () => {
      systemRunRef.current++;
      systemSegmenterRef.current?.reset(); systemSegmenterRef.current = null;
      pendingSystemAudioRef.current = null;
      if (systemTickRef.current !== null) window.clearInterval(systemTickRef.current);
      systemTickRef.current = null;
      if (systemDeviceTimerRef.current !== null) window.clearInterval(systemDeviceTimerRef.current);
      systemDeviceTimerRef.current = null;
      requestRef.current?.abort(); requestRef.current = null;
      cueRunRef.current.cancel(); sequenceRef.current++;
      const start = systemStartRef.current;
      systemCaptureRef.current = false;
      await start?.catch(() => undefined);
      await stopSystemOutputCapture().catch(() => undefined);
      systemStartRef.current = null;
      if (activeRef.current) { setStatus("paused"); setCaptureHealth(""); if (message) setError(message); }
    })();
    pausingRef.current = pausing;
    try { await pausing; } finally { if (pausingRef.current === pausing) pausingRef.current = null; }
  }

  async function startSession() {
    if (startingRef.current || activeRef.current || !startReady) return;
    if (speakerTestRef.current) stopSpeakerTest();
    startingRef.current = true;
    const generation = sequenceRef.current;
    listeningStartedRef.current = false;
    questionRecognizedRef.current = false;
    setError(""); setCueNote(""); setCues([]); setQuestion(""); setSessionQuestions([]); setHudCueState("idle"); setHudDeliveryFailed(false);
    setStatus("opening");
    try {
      if (!isTauri()) throw new Error("Open the VantSide desktop app to use the floating HUD.");
      await hudRef.current!.publish({ status: "processing", question: "", cues: [], noMatch: false,
        controls: { kind: "go-live", automatic: inputMode === "system", startAllowed: false, startHint: "" } });
      await hudRef.current!.show();
      if (generation !== sequenceRef.current) return;
      activeRef.current = true;
      setHudShown(true);
      if (inputMode === "microphone") await listenForQuestion();
      else if (inputMode === "system") await startSystemListening();
      else setStatus("between");
    } catch (cause) {
      await stopResources();
      setHudShown(false);
      setStatus("ready");
      setError(cause instanceof Error ? cause.message : "The interview could not start.");
    } finally { startingRef.current = false; }
  }

  async function processQuestion(recognized: string, fromAudio = true) {
    const next = recognized.trim().slice(0, 500);
    if (next.length < 4 || !activeRef.current) { setStatus(inputMode === "system" ? "system-listening" : "between"); setError("No clear question was captured. Try again or type it."); return; }
    if (fromAudio) questionRecognizedRef.current = true;
    const sequence = ++sequenceRef.current;
    let approvedCount = 0; let eligibleCount: number | null = null; let jevDecision = "";
    setSessionQuestions((current) => addSessionQuestion(interruptSessionQuestions(current), sequence, next));
    setDiagnostics((current) => ({ ...current, approved: null, eligible: null, jev: "Not checked", meta: "Not checked", hud: "Awaiting cue" }));
    setQuestion(next); setCues([]); setHudCueState("finding"); setCueNote(""); setHudDeliveryFailed(false); setStatus("finding");
    try {
      await cueRunRef.current.run((signal) => questionToHud({ question: next, projects, opportunity,
        recentFactIds: recentRef.current, preparedCues: liveMetaCueQa ? undefined : preparedCuesRef.current, signal, onStage: (event) => {
          if (!activeRef.current || sequence !== sequenceRef.current) return;
          if (event.stage === "approved") approvedCount = event.count ?? 0;
          if (event.stage === "eligible") eligibleCount = event.count ?? 0;
          if (event.stage === "jev") jevDecision = event.decision ?? "No cue";
          setDiagnostics((current) => ({ ...current,
            ...(event.stage === "approved" ? { approved: approvedCount } : {}),
            ...(event.stage === "eligible" ? { eligible: eligibleCount } : {}),
            ...(event.stage === "jev" ? { jev: jevDecision } : {}),
            ...(event.stage === "meta" ? { meta: event.decision ?? "No cue" } : {}),
            ...(event.stage === "prepared" ? { meta: "Prepared cue" } : {}) }));
        } }), (result) => {
        if (!activeRef.current || sequence !== sequenceRef.current) return;
        setCues(result.cues);
        setHudCueState(result.cues.length ? "shown" : result.reason === "unavailable" ? "unavailable" : "no-match");
        const outcome: QuestionOutcome = result.cues.length ? "cue" : result.reason === "unavailable" ? "unavailable" :
          result.reason === "irrelevant" || (jevDecision && jevDecision !== "show") ? "no-cue" : "no-match";
        setSessionQuestions((current) => settleSessionQuestion(current, sequence, outcome));
        if (!result.cues.length) setDiagnostics((current) => ({ ...current, hud: "No cue to show" }));
        if (result.cues.length) recentRef.current = [...recentRef.current, ...result.cues.map((cue) => cue.factId)].slice(-10);
        else setCueNote(result.reason === "unavailable" ? "Cue decision unavailable. Continue the interview." :
          approvedCount === 0 ? "No approved Career Memory facts are available for cues." :
          jevDecision && jevDecision !== "show" ? "Jev did not recommend a cue for this question." :
          eligibleCount === 0 ? "No matching approved evidence for this question." : "No grounded cue was selected for this question.");
      }, (cause) => {
        if (activeRef.current && sequence === sequenceRef.current) {
          setHudCueState("unavailable");
          setSessionQuestions((current) => settleSessionQuestion(current, sequence, "unavailable"));
          setCueNote(cause instanceof Error ? cause.message : "Cue unavailable. Continue the interview.");
        }
      });
    } catch (cause) {
      if (activeRef.current && sequence === sequenceRef.current) {
        setHudCueState("unavailable");
        setSessionQuestions((current) => settleSessionQuestion(current, sequence, "unavailable"));
        setCueNote(cause instanceof Error ? cause.message : "Cue unavailable. Continue the interview.");
      }
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
    void processQuestion(text, false);
  }

  async function endSession() {
    if (stoppingRef.current) return stoppingRef.current;
    if (!activeRef.current && status === "ended") return;
    setStatus("ending");
    const stopping = (async () => {
      await stopResources(false);
      setStatus("ended"); setSessionQuestions(interruptSessionQuestions); setTypedQuestion(""); setCaptureHealth("");
      setTestedMicrophoneId(null); setTestedSpeakerId(null); setMicrophoneStatus(""); setSpeakerStatus("");
      const completedInterview = goLiveInterviewOccurred(listeningStartedRef.current, questionRecognizedRef.current);
      listeningStartedRef.current = false;
      questionRecognizedRef.current = false;
      if (completedInterview) {
        try { await onCompleted(); }
        catch { setError("The interview stopped, but its round status could not be saved. Update it in your interview rounds."); }
      }
    })();
    stoppingRef.current = stopping;
    try { await stopping; } finally { if (stoppingRef.current === stopping) stoppingRef.current = null; }
  }

  async function closeHudSession() {
    if (closingHudRef.current) return closingHudRef.current;
    const closing = (async () => {
      if (activeRef.current || stoppingRef.current || status === "opening" || status === "permission") await endSession();
      hudRunRef.current++;
      await hudRef.current?.close();
      setHudShown(false);
    })();
    closingHudRef.current = closing;
    try { await closing; } finally { if (closingHudRef.current === closing) closingHudRef.current = null; }
  }

  async function toggleHud() {
    const run = ++hudRunRef.current;
    try {
      if (hudShown) { await hudRef.current?.hide(); setHudShown(false); }
      else {
        if (hudSnapshotRef.current) await hudRef.current?.publish(hudSnapshotRef.current);
        await hudRef.current?.show();
        if (run !== hudRunRef.current) return;
        setHudShown(true); setHudDeliveryFailed(false);
      }
    } catch { setError("The HUD could not be shown. Try again or continue the interview without a cue."); }
  }

  const running = status !== "ready" && status !== "ended";
  return <main className="app-shell"><div className="page-wrap">
    <header className="topbar"><button className="text-button" type="button" onClick={() => { void (async () => { if (activeRef.current || listeningStartedRef.current) await endSession(); await stopResources(); onBack(); })(); }}>← Four steps</button>
      <span className="brand-lockup"><BrandMark small/><span>VantSide</span></span><span className="session-pill">INTERVIEW SETUP</span></header>
    <section className="interview-v1">
      <span className="eyebrow">04 / YOUR INTERVIEW</span>
      <h1>{opportunity.role}</h1><p className="interview-company">{opportunity.company}{opportunity.roundLabel ? ` · ${opportunity.roundLabel}` : ""}{opportunity.interviewer ? ` · ${opportunity.interviewer}` : ""}</p>
      {inputMode !== "system" && <p className="interview-source">A practice partner can ask a question into your selected microphone.</p>}
      <div className="interview-status" role="status" aria-live="polite"><span className={`interview-status-dot ${status}`}/>{status === "ended" ? "Interview ended" : status === "ready"
          ? preparation === "preparing" ? "Preparing your interview" : !consent ? "Confirm consent to continue" : startReady ? "Ready" : inputMode === "system" ? outputTesting ? "Output test in progress" : systemOutputError ? "Check the Windows output" : "Choose a Windows output to continue" : microphoneTesting ? "Microphone test in progress" : "Test your microphone to continue"
          : ({ opening: "Opening HUD or audio", permission: "Opening microphone", listening: "Listening for a question", "system-listening": "Listening to Windows output", paused: "Listening paused", transcribing: "Transcribing question", finding: "Finding relevant memory", between: "Ready for the next question", ending: "Ending interview" } as const)[status]}</div>
      {status === "ready" && <HudPreparationStatus state={preparation}/>}
      <div className="interview-controls">
        {!running && <><label className="field-label interview-mic">Question input<select value={inputMode} onChange={(event) => setInputMode(event.target.value as "system" | "microphone" | "text")}><option value="system">Windows output · automatic listening</option><option value="microphone">Microphone · manual question</option><option value="text">Keyboard · test or fallback</option></select></label>
          {inputMode === "system" ? <div className="audio-device-grid go-live-setup">
            <section className="device-card" aria-label="Microphone"><h3>Microphone</h3><p>Your meeting microphone stays in your meeting app. Automatic question detection does not capture it.</p></section>
            <section className="device-card" aria-label="Interviewer audio"><h3>Where you’ll hear the interviewer</h3><label className="field-label">Windows output<select value={systemOutputId} disabled={outputTesting} onChange={(event) => { systemOutputIdRef.current = event.target.value; setSystemOutputId(event.target.value); setSystemOutputError(""); setOutputTestStatus(""); setOutputRefreshNotice(""); }}><option value="" disabled>Choose an output</option>{systemOutputs.map((output) => <option key={output.id} value={output.id}>{output.name}{output.isDefault ? " · default" : ""}</option>)}</select></label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={!systemOutputId} onClick={() => { if (outputTesting) void outputTestRef.current?.stop(); else void testSystemOutput(); }}>{outputTesting ? "Stop test" : "Test output"}</button><button type="button" className="text-button" disabled={outputTesting} onClick={() => void refreshSystemOutputs(() => true, true)}>Refresh outputs</button></div>{outputRefreshNotice && <p className="device-status" role="status">{outputRefreshNotice}</p>}{outputTestStatus && <p className="device-status" role="status">{outputTestStatus}</p>}{systemOutputError && <p className="step-error" role="alert">{systemOutputError}</p>}</section>
          </div> : <details className="audio-devices" open><summary>Audio setup</summary><div className="audio-device-grid">
            <section className="device-card" aria-label="Microphone setup"><h3>Microphone</h3><label>Input<select value={microphoneId} disabled={microphoneTesting} onPointerDown={() => void revealMicrophones()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void revealMicrophones(); }} onFocus={() => void refreshDevices().catch(() => undefined)} onChange={(event) => { setMicrophoneId(event.target.value); setTestedMicrophoneId(null); setMicrophoneStatus(""); }}><option value="">System default</option>{microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={microphoneTesting || speakerTesting} onClick={() => void testMicrophone()}>Test microphone</button><meter min="0" max="100" value={microphoneLevel} aria-label="Microphone level"/></div>{microphoneStatus && <span className="device-status" role="status"><span className={testedMicrophoneId === microphoneId ? "test-check" : ""} aria-hidden="true">{testedMicrophoneId === microphoneId ? "✓" : ""}</span>{microphoneStatus}</span>}</section>
            <section className="device-card" aria-label="Speaker setup"><h3>Speaker</h3><label>Output{typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && speakers.length ? <select value={speakerId} disabled={speakerTesting} onChange={(event) => { setSpeakerId(event.target.value); setTestedSpeakerId(null); setSpeakerStatus(""); }}><option value="">{speakers.find((device) => device.deviceId === "default")?.label || "System default"}</option>{speakers.filter((device) => device.deviceId !== "default").map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Speaker ${index + 1}`}</option>)}</select> : <span className="device-default">System output</span>}</label><div className="device-card-actions"><button type="button" className="secondary-button" disabled={microphoneTesting} onClick={() => { if (speakerTesting) stopSpeakerTest(); else void testSpeaker(); }}>{speakerTesting ? "Stop" : "Test speaker"}</button></div>{speakerStatus && <span className="device-status" role="status"><span className={testedSpeakerId === speakerId ? "test-check" : ""} aria-hidden="true">{testedSpeakerId === speakerId ? "✓" : ""}</span>{speakerStatus}</span>}</section>
          </div></details>}
          <div className="go-live-readiness"><label className="interview-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)}/> Everyone whose speech is captured consents, and recording and AI use are allowed.</label>
          <button type="button" className="primary-button" disabled={!startReady || startingRef.current} onClick={() => void startSession()}>{status === "ended" ? "Start New Session" : inputMode === "system" ? "Start Listening" : "Start Interview"}</button>
          {isTauri() && <button type="button" className="secondary-button hud-toggle-main" onClick={() => void toggleHud()}><HudVisibilityIcon hidden={hudShown}/>{hudShown ? "Hide HUD" : "Open HUD"}</button>}</div></>}
        {running && <>
          {inputMode === "system" && status === "paused" && <label className="field-label go-live-paused-output">Where you’ll hear the interviewer<select value={systemOutputId} onChange={(event) => { systemOutputIdRef.current = event.target.value; setSystemOutputId(event.target.value); setSystemOutputError(""); }}><option value="" disabled>Choose an output</option>{systemOutputs.map((output) => <option key={output.id} value={output.id}>{output.name}{output.isDefault ? " · default" : ""}</option>)}</select></label>}
          <div className="interview-buttons">
            {status === "listening" && <button type="button" className="primary-button" onClick={() => void finishQuestion()}>Finish Question</button>}
            {status === "between" && inputMode === "microphone" && <button type="button" className="primary-button" onClick={() => void listenForQuestion()}>Listen for Next Question</button>}
            {inputMode === "system" && status !== "paused" && <button type="button" className="secondary-button" disabled={status !== "system-listening"} onClick={() => void pauseSystemListening()}>Pause</button>}
            {inputMode === "system" && status === "paused" && <button type="button" className="primary-button" disabled={!systemOutputId} onClick={() => void startSystemListening()}>Resume</button>}
            <button type="button" className="secondary-button" disabled={status === "ending"} onClick={() => void endSession()}>{inputMode === "system" ? "Stop" : "End Interview"}</button>
            <button type="button" className="text-button hud-toggle-main" disabled={status === "ending" || status === "opening"} onClick={() => void toggleHud()}><HudVisibilityIcon hidden={hudShown}/>{hudShown ? "Hide HUD" : "Show HUD"}</button>
          </div></>}
      </div>
      <HudMinimizeGuidance open={hudShown}/>
      {error && <p className="step-error" role="alert">{error}</p>}
      {inputMode === "system" && running && captureHealth && <p className="step-error" role="status">{captureHealth}</p>}
      {inputMode === "system" && status !== "ready" && <details className="go-live-diagnostics"><summary>Listening diagnostics</summary><dl>
        <dt>Selected output ID</dt><dd><code>{systemOutputId || "None"}</code></dd>
        <dt>Capture</dt><dd>{diagnostics.initialization}</dd>
        <dt>PCM packets</dt><dd>{diagnostics.packets}</dd>
        <dt>Audio level</dt><dd><meter min="0" max="100" value={diagnostics.level} aria-label="Windows output level"/> {diagnostics.level}%</dd>
        <dt>Speech segments</dt><dd>{diagnostics.segments}</dd>
        <dt>Meta transcription</dt><dd>{diagnostics.transcription}</dd>
        <dt>Question recognition</dt><dd>{diagnostics.question}</dd>
        <dt>Approved facts</dt><dd>{diagnostics.approved ?? "Not checked"}</dd>
        <dt>Matching facts</dt><dd>{diagnostics.eligible ?? "Not checked"}</dd>
        <dt>Jev decision</dt><dd>{diagnostics.jev}</dd>
        <dt>Meta cue</dt><dd>{diagnostics.meta}</dd>
        <dt>HUD delivery</dt><dd>{diagnostics.hud}</dd>
      </dl></details>}
      {running && <><p className="interview-guidance">{inputMode === "system" ? status === "paused" ? "Windows playback capture is off." : "Only the selected Windows output is monitored. Your microphone stays separate." : status === "listening" ? "Mic on · Ask a question, then choose Finish Question." : status === "between" ? "Mic off · Answer naturally, then continue with another question." : status === "opening" || status === "permission" ? "Mic permission is requested only when spoken questions begin." : status === "ending" ? "Mic off · Closing the HUD." : "Mic off · Processing the completed question."}</p>
        {inputMode !== "system" && <details className="interview-text-fallback" open={inputMode === "text" ? true : undefined}><summary>{inputMode === "text" ? "Type a practice question" : "Type a question instead"}</summary><form onSubmit={submitTyped}><label className="field-label">Practice question<input value={typedQuestion} maxLength={500} disabled={status !== "between"} onChange={(event) => setTypedQuestion(event.target.value)}/></label><button type="submit" className="secondary-button" disabled={typedQuestion.trim().length < 4 || status !== "between"}>Use question</button></form></details>}</>}
      {question && running && !hudShown && <section className="interview-recognized" aria-live="polite"><h2>Question heard</h2><p>{question}</p></section>}
      {status === "ended" && <section className="go-live-summary" aria-label="Session questions"><h2>Questions heard</h2>
        {sessionQuestions.length ? <ol>{sessionQuestions.map((item) => <li key={item.id}><span>{item.question}</span><small>{outcomeLabel[item.outcome]}</small></li>)}</ol> : <p>No interview questions were recognized this session.</p>}
      </section>}
      {cueNote && <p className="detail-note" role="status">{cueNote}</p>}
      {cues.length > 0 && !hudDeliveryFailed && <p className="detail-note" role="status">{cues.length} approved Career Memory {cues.length === 1 ? "cue" : "cues"} in the HUD.</p>}
    </section>
    <footer className="page-footer"><span>VantSide</span><span>Consent required · Raw audio stays in this session</span></footer>
  </div></main>;
}
