import assert from "node:assert/strict";
import test from "node:test";
import { microphonePassed, microphoneSample, speakerPlaybackCompleted } from "./audio-test-feedback";

test("microphone feedback ignores silence and isolated spikes, then recognizes sustained input", () => {
  let streak = 0;
  for (const level of [0, 0, 18, 0, 9, 12, 14]) streak = microphoneSample(level, streak);
  assert.equal(microphonePassed(streak), false);
  streak = microphoneSample(16, streak);
  assert.equal(microphonePassed(streak), true);
  assert.equal(microphonePassed(microphoneSample(0, streak)), false);
});

test("speaker success requires playback completion rather than starting or cancellation", () => {
  assert.equal(speakerPlaybackCompleted("ended"), true);
  assert.equal(speakerPlaybackCompleted("cancelled"), false);
  assert.equal(speakerPlaybackCompleted("error"), false);
});
