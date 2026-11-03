import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HudFacts, hudCueMessage } from "./hud-facts";

test("HUD distinguishes waiting, finding, no match, service failure, and stopped states", () => {
  assert.equal(hudCueMessage("idle", "listening", false), "Waiting for a question");
  assert.equal(hudCueMessage("finding", "listening", true), "Checking Career Memory…");
  assert.equal(hudCueMessage("no-match", "listening", true), "No matching Career Memory");
  assert.equal(hudCueMessage("unavailable", "listening", true), "Cue unavailable. You can keep interviewing.");
  assert.equal(hudCueMessage("idle", "stopped", false), "Session stopped");
});

test("HUD shows at most three approved cues and retains fact references", () => {
  const cues = Array.from({ length: 4 }, (_, index) => ({ factId: `approved-${index}`, projectId: "project", text: `Approved fact ${index}` }));
  const html = renderToStaticMarkup(<HudFacts cues={cues} cueState="shown" status="listening" hasQuestion/>);
  assert.equal((html.match(/class="hud-fact"/g) ?? []).length, 3);
  assert.match(html, /data-fact-id="approved-0"/);
  assert.doesNotMatch(html, /approved-3/);
});
