import { detectInterviewerQuestion } from "./interviewer-question";
import { LiveEvidenceBuffer, type LiveEvidenceStats } from "./live-evidence";

export type LiveStatus = "connecting" | "listening" | "user-speaking" | "speaking" | "paused" | "ended" | "error";
export type LiveInterview = { pause(): void; resume(): void; close(): void; finish(): Promise<string>;
  userSpeech(): string; evidenceStats(): LiveEvidenceStats };

export function liveSpeakerStatus(now: number, lastInterviewerAudio: number, lastUserAudio: number): "speaking" | "user-speaking" | "listening" {
  return now - lastInterviewerAudio < 450 ? "speaking" : now - lastUserAudio < 400 ? "user-speaking" : "listening";
}

type Options = {
  microphoneId?: string; outputId?: string; signal: AbortSignal;
  openingPrompt?: string;
  onInterviewerQuestion?(question: string): void;
  onEvidenceLimit?(): void;
  createSession(sdp: string): Promise<{ sdp: string }>;
  onStatus(status: LiveStatus): void; onLevel(level: number): void; onError(message: string): void;
};

export async function startLiveInterview(options: Options): Promise<LiveInterview> {
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") throw new Error("This desktop WebView does not support live microphone conversations.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: options.microphoneId ? { deviceId: { exact: options.microphoneId } } : true });
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  const player = new Audio(); player.autoplay = true;
  const context = new AudioContext();
  const micAnalyser = context.createAnalyser(); micAnalyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(micAnalyser);
  const micSamples = new Uint8Array(micAnalyser.fftSize);
  let outputAnalyser: AnalyserNode | null = null;
  let outputSamples: Uint8Array<ArrayBuffer> | null = null;
  let closed = false; let paused = false; let ready = false; let timer = 0; let readyTimer = 0; let questionTimer = 0; let finishTimer = 0;
  let finalizing: Promise<string> | null = null;
  let resolveFinish: ((text: string) => void) | null = null;
  let evidenceLimitNotified = false;
  let assistantSpeech = "";
  let lastInterviewerAudio = 0; let lastUserAudio = 0; let displayedStatus: LiveStatus | null = null;
  const evidence = new LiveEvidenceBuffer();
  const reportStatus = (status: LiveStatus) => { if (status !== displayedStatus) { displayedStatus = status; options.onStatus(status); } };
  const abort = () => close();
  options.signal.addEventListener("abort", abort, { once: true });
  function close(showEnded = true) {
    if (closed) return;
    closed = true; window.clearInterval(timer); window.clearTimeout(readyTimer); window.clearTimeout(questionTimer); window.clearTimeout(finishTimer);
    if (channel.readyState === "open" && !finalizing) {
      try { channel.send(JSON.stringify({ type: "session.close" })); } catch { /* Still release local capture. */ }
    }
    channel.close(); peer.close(); stream.getTracks().forEach((track) => track.stop());
    player.pause(); player.srcObject = null; void context.close();
    options.signal.removeEventListener("abort", abort); options.onLevel(0); if (showEnded) reportStatus("ended");
    resolveFinish?.(evidence.text()); resolveFinish = null;
  }
  const live: LiveInterview = {
    close, userSpeech: () => evidence.text(), evidenceStats: () => evidence.stats(),
    finish() {
      if (closed) return Promise.resolve(evidence.text());
      if (finalizing) return finalizing;
      finalizing = new Promise<string>((resolve) => {
        resolveFinish = resolve;
        finishTimer = window.setTimeout(() => close(), 5000);
        if (channel.readyState === "open") {
          try { channel.send(JSON.stringify({ type: "session.close" })); } catch { close(); }
        } else close();
      });
      return finalizing;
    },
    pause() { if (closed || paused) return; paused = true; stream.getAudioTracks().forEach((track) => { track.enabled = false; }); player.muted = true;
      if (channel.readyState === "open") channel.send(JSON.stringify({ type: "session.input_audio.mute" })); reportStatus("paused"); },
    resume() { if (closed || !paused) return; paused = false; stream.getAudioTracks().forEach((track) => { track.enabled = true; }); player.muted = false;
      if (channel.readyState === "open") channel.send(JSON.stringify({ type: "session.input_audio.unmute" })); lastInterviewerAudio = 0; lastUserAudio = 0; reportStatus("listening"); },
  };
  try {
    if (options.outputId) {
      if (typeof player.setSinkId !== "function") throw new Error("This desktop WebView cannot select that speaker. Choose the system output.");
      await player.setSinkId(options.outputId);
    }
    if (closed) throw new Error("Voice session cancelled.");
    peer.ontrack = (event) => {
      if (closed) return;
      player.srcObject = event.streams[0];
      outputAnalyser = context.createAnalyser(); outputAnalyser.fftSize = 512;
      context.createMediaStreamSource(event.streams[0]).connect(outputAnalyser);
      outputSamples = new Uint8Array(outputAnalyser.fftSize);
      void player.play().catch(() => { close(false); options.onError("Speaker playback was blocked. Check your output device and try again."); });
    };
    channel.onmessage = (event) => {
      if (closed) return;
      let message: { type?: string; delta?: string; start_ms?: number; end_ms?: number; reason?: string; error?: { code?: string } };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === "session.started") {
        ready = true; window.clearTimeout(readyTimer); reportStatus("listening");
        channel.send(JSON.stringify({ type: "session.commentary.append", event_id: "opening_greeting", delegation_id: null,
          content: options.openingPrompt ?? "Greet the candidate briefly as their practice interviewer. Ask one opening question about their approved professional background, then listen." }));
      } else if (message.type === "session.input_transcript.delta" && typeof message.delta === "string") {
        if (evidence.append(message.delta, message.start_ms, message.end_ms) && !evidenceLimitNotified) {
          evidenceLimitNotified = true;
          options.onEvidenceLimit?.();
        }
      }
      else if (message.type === "session.output_transcript.delta" && typeof message.delta === "string") {
        assistantSpeech = (assistantSpeech + message.delta).slice(-1000);
        window.clearTimeout(questionTimer);
        const checkQuestion = () => {
          if (closed || paused) return;
          if (displayedStatus === "speaking") { questionTimer = window.setTimeout(checkQuestion, 450); return; }
          const question = detectInterviewerQuestion(assistantSpeech); assistantSpeech = "";
          console.info("Practice HUD", { stage: "interviewer-question", detected: !!question });
          if (question) options.onInterviewerQuestion?.(question);
        };
        questionTimer = window.setTimeout(checkQuestion, 900);
      }
      else if (message.type === "session.closed") {
        const interrupted = !finalizing && message.reason && message.reason !== "close_requested";
        close(!interrupted);
        if (interrupted) options.onError(message.reason === "expired"
          ? "The voice session reached its time limit. Review the speech captured so far, then start another interview."
          : "The voice session ended unexpectedly. Review the speech captured so far, then start another interview.");
      }
      else if (message.type === "error") { close(false); options.onError("The voice session reported an error. Please restart it."); }
    };
    peer.onconnectionstatechange = () => {
      if (!closed && (peer.connectionState === "failed" || peer.connectionState === "disconnected")) {
        close(false); options.onError("Voice connection was lost. Please start a new interview.");
      }
    };
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    if (peer.iceGatheringState !== "complete") await new Promise<void>((resolve) => {
      const onGathering = () => { if (peer.iceGatheringState === "complete") { window.clearTimeout(timeout); peer.removeEventListener("icegatheringstatechange", onGathering); resolve(); } };
      const timeout = window.setTimeout(() => { peer.removeEventListener("icegatheringstatechange", onGathering); resolve(); }, 6000);
      peer.addEventListener("icegatheringstatechange", onGathering);
    });
    if (closed) throw new Error("Voice session cancelled.");
    const session = await options.createSession(peer.localDescription?.sdp ?? offer.sdp ?? "");
    if (closed) throw new Error("Voice session cancelled.");
    await peer.setRemoteDescription({ type: "answer", sdp: session.sdp });
    readyTimer = window.setTimeout(() => { if (!ready && !closed) { close(false); options.onError("Voice session did not become ready. Please try again."); } }, 15_000);
    timer = window.setInterval(() => {
      if (closed || paused || !ready) return;
      micAnalyser.getByteTimeDomainData(micSamples);
      const micLevel = Math.sqrt(micSamples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / micSamples.length);
      options.onLevel(Math.min(100, Math.round(micLevel * 450)));
      let outputLevel = 0;
      if (outputAnalyser && outputSamples && !player.paused) {
        outputAnalyser.getByteTimeDomainData(outputSamples);
        outputLevel = Math.sqrt(outputSamples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / outputSamples.length);
      }
      const now = Date.now();
      if (outputLevel > 0.02) lastInterviewerAudio = now;
      if (micLevel > 0.03 && outputLevel <= 0.02) lastUserAudio = now;
      reportStatus(liveSpeakerStatus(now, lastInterviewerAudio, lastUserAudio));
    }, 130);
    return live;
  } catch (cause) { close(false); throw cause; }
}
