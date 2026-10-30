import assert from "node:assert/strict";
import test from "node:test";
import { startAnswerRecording } from "./record-answer";

test("discarding a spoken-question recording stops the microphone and audio graph", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  let trackStops = 0;
  let contextCloses = 0;
  const processor = { onaudioprocess: null, connect: () => {}, disconnect: () => {} };
  const source = { connect: () => {}, disconnect: () => {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () =>
    ({ getTracks: () => [{ stop: () => { trackStops++; } }] }) } } });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: class {
    sampleRate = 48_000; destination = {};
    resume = async () => {};
    close = async () => { contextCloses++; };
    createMediaStreamSource = () => source;
    createScriptProcessor = () => processor;
  } });
  try {
    const recorder = await startAnswerRecording(new AbortController().signal);
    recorder.discard(); recorder.discard();
    assert.equal(trackStops, 1);
    assert.equal(contextCloses, 1);
    assert.equal(processor.onaudioprocess, null);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else Reflect.deleteProperty(globalThis, "navigator");
    if (originalContext) Object.defineProperty(globalThis, "AudioContext", originalContext); else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});

test("a late microphone permission result is stopped after session cancellation", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let resolveStream!: (stream: MediaStream) => void;
  let stops = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () =>
    new Promise<MediaStream>((resolve) => { resolveStream = resolve; }) } } });
  try {
    const controller = new AbortController();
    const starting = startAnswerRecording(controller.signal);
    controller.abort();
    resolveStream({ getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream);
    await assert.rejects(starting, /Recording stopped/);
    assert.equal(stops, 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else Reflect.deleteProperty(globalThis, "navigator");
  }
});
