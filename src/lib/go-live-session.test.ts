import assert from "node:assert/strict";
import test from "node:test";
import { addSessionQuestion, canRunGoLiveHudAction, dispatchGoLiveHudAction, interruptSessionQuestions,
  settleSessionQuestion, type GoLiveHudAction } from "./go-live-session";

test("HUD start requires Ready and current-session consent/setup; repeated start cannot pass the state gate", async () => {
  const calls: GoLiveHudAction[] = [];
  const handlers = Object.fromEntries((["start", "pause", "resume", "stop", "close"] as const)
    .map((action) => [action, () => { calls.push(action); }])) as Record<GoLiveHudAction, () => void>;
  assert.equal(await dispatchGoLiveHudAction("start", "ready", false, handlers), false);
  assert.equal(await dispatchGoLiveHudAction("start", "ready", true, handlers), true);
  assert.equal(await dispatchGoLiveHudAction("start", "processing", true, handlers), false);
  assert.deepEqual(calls, ["start"]);
});

test("HUD pause/resume/stop and close route to distinct main-window actions", async () => {
  const calls: GoLiveHudAction[] = [];
  const handlers = Object.fromEntries((["start", "pause", "resume", "stop", "close"] as const)
    .map((action) => [action, () => { calls.push(action); }])) as Record<GoLiveHudAction, () => void>;
  assert.equal(canRunGoLiveHudAction("pause", "processing", true), false);
  assert.equal(await dispatchGoLiveHudAction("pause", "listening", true, handlers), true);
  assert.equal(await dispatchGoLiveHudAction("resume", "paused", true, handlers), true);
  assert.equal(await dispatchGoLiveHudAction("stop", "processing", true, handlers), true);
  assert.equal(await dispatchGoLiveHudAction("close", "stopped", false, handlers), true);
  assert.deepEqual(calls, ["pause", "resume", "stop", "close"]);
});

test("question summary is bounded, preserves outcomes, and replaces pending work on stop", () => {
  let items = addSessionQuestion([], 1, "  What did you build?  ");
  items = addSessionQuestion(items, 1, "duplicate");
  assert.equal(items.length, 1);
  items = settleSessionQuestion(items, 1, "cue");
  items = addSessionQuestion(items, 2, "How did you handle the launch?");
  items = interruptSessionQuestions(items);
  assert.deepEqual(items.map((item) => [item.question, item.outcome]),
    [["What did you build?", "cue"], ["How did you handle the launch?", "interrupted"]]);
  for (let id = 3; id < 26; id++) items = addSessionQuestion(items, id, `Question ${id}?`);
  assert.equal(items.length, 20);
  assert.equal(items[0].id, 6);
});
