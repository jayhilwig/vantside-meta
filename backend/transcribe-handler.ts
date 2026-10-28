import { randomUUID } from "node:crypto";
import { z } from "zod";

const requestSchema = z.object({ audio: z.string().min(100).max(4_100_000) }).strict();
const responseSchema = z.object({
  transcript: z.string().trim().min(1).max(3000),
  audioDurationMs: z.number().nonnegative(),
}).passthrough();

function validWav(bytes: Buffer) {
  if (bytes.length < 45 || bytes.length > 3_000_044) return false;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE" ||
      bytes.toString("ascii", 12, 16) !== "fmt " || bytes.toString("ascii", 36, 40) !== "data") return false;
  if (bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(16) !== 16 ||
      bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(34) !== 16 ||
      bytes.readUInt32LE(40) !== bytes.length - 44) return false;
  const rate = bytes.readUInt32LE(24);
  return (rate === 16_000 || rate === 24_000) && bytes.readUInt32LE(28) === rate * 2 &&
    bytes.readUInt16LE(32) === 2 && (bytes.length - 44) / (rate * 2) <= 60;
}

export async function transcribeAnswer(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = requestSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Record an answer of at most one minute." } };
  const bytes = Buffer.from(input.data.audio, "base64");
  if (!validWav(bytes)) return { status: 400, body: { error: "Audio must be a short mono 16-bit WAV at 16 or 24 kHz." } };
  const apiKey = process.env.MODEL_API_KEY;
  const baseUrl = process.env.META_API_BASE_URL;
  if (!apiKey || !baseUrl) return { status: 503, body: { error: "Meta transcription is not configured on the local backend." } };
  const boundary = `vantside-${randomUUID()}`;
  const data = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" })}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="answer.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  try {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(data),
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    if (!response.ok) return { status: 502, body: { error: "Meta could not transcribe that answer. Please try again." } };
    const parsed = responseSchema.safeParse(await response.json());
    return parsed.success ? { status: 200, body: { transcript: parsed.data.transcript } }
      : { status: 502, body: { error: "Meta returned an unreadable transcript. Please try again." } };
  } catch {
    return { status: 502, body: { error: "Transcription was interrupted. Please try again." } };
  }
}
