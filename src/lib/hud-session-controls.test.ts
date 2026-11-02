import assert from "node:assert/strict";
import test from "node:test";
import { canRunPracticeHudAction, HudCommandGate, hudControlPresentation } from "./hud-session-controls";
import { emptyHudSnapshot, type HudSnapshot } from "./hud-window";

const practice = (status: HudSnapshot["status"], canStop = true): HudSnapshot => ({
  ...emptyHudSnapshot(), status, controls: { kind: "practice", canStop },
});
const goLive = (status: HudSnapshot["status"], automatic = true): HudSnapshot => ({
  ...emptyHudSnapshot(), status, controls: { kind: "go-live", automatic, startAllowed: true, startHint: "" },
});

test("Practice HUD exposes real pause, resume and stop, then a stopped state with Close", () => {
  assert.deepEqual(hudControlPresentation(practice("listening")).buttons.map((button) => button.label), ["Pause", "End Practice"]);
  assert.deepEqual(hudControlPresentation(practice("paused")).buttons.map((button) => button.label), ["Resume", "End Practice"]);
  assert.equal(hudControlPresentation(practice("stopped")).note, "Practice stopped");
  assert.deepEqual(hudControlPresentation(practice("stopped")).buttons, []);
  assert.equal(canRunPracticeHudAction("pause", "listening", true), true);
  assert.equal(canRunPracticeHudAction("resume", "paused", true), true);
  assert.equal(canRunPracticeHudAction("stop", "processing", true), true);
  assert.equal(canRunPracticeHudAction("stop", "stopped", false), false);
  assert.equal(canRunPracticeHudAction("close", "stopped", false), true);
  assert.equal(canRunPracticeHudAction("start", "ready", true), false);
});

test("Go Live HUD retains its ready, listening, paused, processing and stopped controls", () => {
  assert.deepEqual(hudControlPresentation(goLive("ready")).buttons.map((button) => button.label), ["Start Listening"]);
  assert.deepEqual(hudControlPresentation(goLive("listening")).buttons.map((button) => button.label), ["Pause", "Stop"]);
  assert.deepEqual(hudControlPresentation(goLive("paused")).buttons.map((button) => button.label), ["Resume", "Stop"]);
  assert.deepEqual(hudControlPresentation(goLive("processing")).buttons.map((button) => button.label), ["Stop"]);
  assert.equal(hudControlPresentation(goLive("stopped")).note, "Listening stopped");
  assert.deepEqual(hudControlPresentation(goLive("listening", false)).buttons.map((button) => button.label), ["Stop"]);
});

test("HUD command gate suppresses repeats while leaving Close available during a pending command", () => {
  const gate = new HudCommandGate();
  assert.equal(gate.begin("stop"), true);
  assert.equal(gate.begin("stop"), false);
  assert.equal(gate.begin("close"), true);
  assert.equal(gate.begin("close"), false);
  gate.settled();
  assert.equal(gate.begin("pause"), false);
  gate.failed();
  assert.equal(gate.begin("pause"), true);
});
