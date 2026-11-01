import assert from "node:assert/strict";
import test from "node:test";
import { goLiveReady, type GoLivePreflight } from "./device-preflight";

const initial: GoLivePreflight = { consent: true, inputMode: "microphone", microphoneId: "", speakerId: "",
  testedMicrophoneId: null, testedSpeakerId: null, microphoneTesting: false, speakerTesting: false };

test("Go Live microphone mode requires both device tests and consent", () => {
  assert.equal(goLiveReady(initial), false);
  assert.equal(goLiveReady({ ...initial, testedMicrophoneId: "" }), false);
  assert.equal(goLiveReady({ ...initial, testedMicrophoneId: "", testedSpeakerId: "" }), true);
  assert.equal(goLiveReady({ ...initial, testedMicrophoneId: "", testedSpeakerId: "", consent: false }), false);
});

test("changing a tested device or starting a new test removes readiness", () => {
  const ready = { ...initial, testedMicrophoneId: "", testedSpeakerId: "" };
  assert.equal(goLiveReady({ ...ready, microphoneId: "usb-mic" }), false);
  assert.equal(goLiveReady({ ...ready, speakerId: "headphones" }), false);
  assert.equal(goLiveReady({ ...ready, microphoneTesting: true }), false);
  assert.equal(goLiveReady({ ...ready, speakerTesting: true }), false);
});

test("text fallback still requires device preflight before Ready", () => {
  assert.equal(goLiveReady({ ...initial, inputMode: "text" }), false);
  assert.equal(goLiveReady({ ...initial, inputMode: "text", testedMicrophoneId: "", testedSpeakerId: "" }), true);
  assert.equal(goLiveReady({ ...initial, inputMode: "text", consent: false }), false);
});
