import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeInterviewQuestion, pcm16ToWavBase64, SystemQuestionSegmenter } from "./system-question-segmenter";

const speech = new Int16Array(2_400).fill(8_000);
const quiet = new Int16Array(2_400);

test("short noise and silence do not produce a transcription segment", () => {
  const segments: Int16Array[] = [];
  const detector = new SystemQuestionSegmenter((pcm) => segments.push(pcm), () => assert.fail("too long"));
  detector.push(quiet, 0);
  detector.push(new Int16Array(2_400).fill(9), 100);
  detector.tick(2_000);
  assert.equal(segments.length, 0);
});

test("speech completes only after a quiet boundary, including when audio callbacks stop", () => {
  const segments: Int16Array[] = [];
  const detector = new SystemQuestionSegmenter((pcm) => segments.push(pcm), () => assert.fail("too long"));
  detector.push(quiet, 0);
  for (let i = 1; i <= 7; i++) detector.push(speech, i * 100);
  detector.tick(1_400);
  assert.equal(segments.length, 0);
  detector.tick(1_700);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].length, quiet.length + speech.length * 7);
  detector.tick(3_000);
  assert.equal(segments.length, 1);
});

test("pause/reset discards partial speech and a long segment is rejected instead of cut", () => {
  let segments = 0; let tooLong = 0;
  const detector = new SystemQuestionSegmenter(() => { segments++; }, () => { tooLong++; });
  for (let i = 0; i < 7; i++) detector.push(speech, i * 100);
  detector.reset(); detector.tick(3_000);
  assert.equal(segments, 0);
  for (let i = 0; i <= 480; i++) detector.push(speech, 4_000 + i * 100);
  assert.equal(tooLong, 1);
  assert.equal(segments, 0);
});

test("only complete question-like turns go to the cue path", () => {
  assert.equal(looksLikeInterviewQuestion("Tell me about a difficult product decision."), true);
  assert.equal(looksLikeInterviewQuestion("How did you resolve the team conflict?"), true);
  assert.equal(looksLikeInterviewQuestion("Thanks, that was helpful."), false);
  assert.equal(looksLikeInterviewQuestion("hello"), false);
});

test("24 kHz WAV has the Meta transcription contract header", () => {
  const bytes = Buffer.from(pcm16ToWavBase64(new Int16Array([0, 1, -1])), "base64");
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.readUInt32LE(24), 24_000);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.readUInt32LE(40), 6);
});
