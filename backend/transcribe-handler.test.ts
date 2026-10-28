import assert from "node:assert/strict";
import test from "node:test";
import { transcribeAnswer } from "./transcribe-handler";

function wav() {
  const bytes = Buffer.alloc(44 + 16_000 * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes.toString("base64");
}

test("turn-based Meta transcription uses documented WAV multipart contract", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL };
  process.env.MODEL_API_KEY = "mock-only";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  try {
    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(String(input), "https://example.invalid/v1/asr/transcribe");
      assert.match(String(init?.headers && (init.headers as Record<string, string>)["Content-Type"]), /multipart\/form-data; boundary=/);
      const body = Buffer.from(init?.body as Uint8Array);
      assert.match(body.toString("latin1", 0, 400), /"model":"muse-voice-transcribe-1.0"/);
      assert.match(body.toString("latin1", 0, 400), /"mode":"PUSH_TO_TALK"/);
      return Response.json({ sessionId: "mock", transcript: "I led the launch research.", audioDurationMs: 1000, turns: [] });
    };
    const result = await transcribeAnswer({ audio: wav() }, fetcher);
    assert.equal(result.status, 200);
    assert.equal("transcript" in result.body ? result.body.transcript : null, "I led the launch research.");
    const invalid = await transcribeAnswer({ audio: Buffer.from("not wav").toString("base64") }, fetcher);
    assert.equal(invalid.status, 400);
  } finally {
    if (previous.key === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previous.key;
    if (previous.base === undefined) delete process.env.META_API_BASE_URL; else process.env.META_API_BASE_URL = previous.base;
  }
});
