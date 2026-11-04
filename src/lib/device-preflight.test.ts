import assert from "node:assert/strict";
import test from "node:test";
import { goLiveReady, systemOutputReady, type GoLivePreflight } from "./device-preflight";

const initial: GoLivePreflight = { consent: true, inputMode: "microphone", microphoneId: "", speakerId: "",
  testedMicrophoneId: null, testedSpeakerId: null, microphoneTesting: false, speakerTesting: false };

test("Go Live microphone mode requires detected input and consent, not a speaker test", () => {
  assert.equal(goLiveReady(initial), false);
  assert.equal(goLiveReady({ ...initial, testedMicrophoneId: "" }), true);
  assert.equal(goLiveReady({ ...initial, testedMicrophoneId: "", testedSpeakerId: "" }), true);
  assert.equal(goLiveReady({ ...initial, testedMicrophoneId: "", testedSpeakerId: "", consent: false }), false);
});

test("changing a tested device or starting a new test removes readiness", () => {
  const ready = { ...initial, testedMicrophoneId: "", testedSpeakerId: "" };
  assert.equal(goLiveReady({ ...ready, microphoneId: "usb-mic" }), false);
  assert.equal(goLiveReady({ ...ready, speakerId: "headphones" }), true);
  assert.equal(goLiveReady({ ...ready, microphoneTesting: true }), false);
  assert.equal(goLiveReady({ ...ready, speakerTesting: true }), true);
});

test("text fallback still requires device preflight before Ready", () => {
  assert.equal(goLiveReady({ ...initial, inputMode: "text" }), false);
  assert.equal(goLiveReady({ ...initial, inputMode: "text", testedMicrophoneId: "", testedSpeakerId: "" }), true);
  assert.equal(goLiveReady({ ...initial, inputMode: "text", consent: false }), false);
});

test("system audio cannot pass the microphone preflight in place of output capture", () => {
  assert.equal(goLiveReady({ ...initial, inputMode: "system", testedMicrophoneId: "" }), false);
  assert.equal(systemOutputReady(true, "", "", false), false);
  assert.equal(systemOutputReady(true, "output", "capture unavailable", false), false);
  assert.equal(systemOutputReady(true, "output", "", true), false);
  assert.equal(systemOutputReady(false, "output", "", false), false);
  assert.equal(systemOutputReady(true, "output", "", false), true);
});
