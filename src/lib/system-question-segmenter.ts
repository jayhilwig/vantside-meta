const RATE = 24_000;
const SILENCE_MS = 950;
const MAX_SAMPLES = RATE * 48;

// Windows loopback arrives as mono PCM16. Bound every in-memory segment and
// finalize on silence, including when WASAPI stops sending silent packets.
export class SystemQuestionSegmenter {
  private before: number[] = [];
  private speech: number[] = [];
  private voicedSamples = 0;
  private lastVoiceAt = 0;

  constructor(private readonly onSegment: (pcm: Int16Array) => void,
    private readonly onTooLong: () => void) {}

  push(chunk: Int16Array, now = Date.now()) {
    if (!chunk.length) return;
    const rms = Math.sqrt(chunk.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / chunk.length);
    const voiced = rms >= 0.009;
    if (!this.speech.length && !voiced) {
      this.before.push(...chunk);
      if (this.before.length > RATE / 4) this.before.splice(0, this.before.length - RATE / 4);
      return;
    }
    if (!this.speech.length) { this.speech = this.before; this.before = []; }
    this.speech.push(...chunk);
    if (voiced) { this.voicedSamples += chunk.length; this.lastVoiceAt = now; }
    if (this.speech.length > MAX_SAMPLES) { this.reset(); this.onTooLong(); return; }
    if (!voiced) this.tick(now);
  }

  tick(now = Date.now()) {
    if (!this.speech.length || now - this.lastVoiceAt < SILENCE_MS) return;
    const output = this.voicedSamples >= RATE * 0.35 ? Int16Array.from(this.speech) : null;
    this.reset();
    if (output) this.onSegment(output);
  }

  reset() { this.before = []; this.speech = []; this.voicedSamples = 0; this.lastVoiceAt = 0; }
}

export function looksLikeInterviewQuestion(transcript: string): boolean {
  const value = transcript.trim();
  if (value.length < 12 || value.split(/\s+/).length < 4) return false;
  return /\?|^(?:tell|describe|walk|share|explain|give|what|why|how|when|where|which|who|can|could|would|have|do|did|please)\b/i.test(value);
}

export function pcm16ToWavBase64(samples: Int16Array): string {
  if (!samples.length || samples.length > MAX_SAMPLES) throw new Error("The audio segment is outside the supported range.");
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  label(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); label(8, "WAVE"); label(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}
