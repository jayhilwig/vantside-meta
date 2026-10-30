import assert from "node:assert/strict";
import test from "node:test";
import { HudWindowController, type HudWindowHandle, type HudWindowPort } from "./hud-window";

test("HUD opens once, republishes on ready, hides, reopens, and closes on interview end", async () => {
  const calls: string[] = [];
  let existing: HudWindowHandle | null = null;
  const handle: HudWindowHandle = { show: async () => { calls.push("show"); },
    hide: async () => { calls.push("hide"); }, close: async () => { calls.push("close"); existing = null; } };
  const port: HudWindowPort = { find: async () => existing,
    create: async () => { calls.push("create"); existing = handle; return handle; },
    publish: async (cues) => { calls.push(`publish:${cues.length}`); } };
  const hud = new HudWindowController(port);
  await hud.show(); await hud.show();
  await hud.publish([{ factId: "fact-1", projectId: "project-1", text: "Led API work" }]);
  await hud.ready(); await hud.hide(); await hud.show(); await hud.close();
  assert.equal(calls.filter((call) => call === "create").length, 1);
  assert.deepEqual(calls, ["create", "show", "show", "publish:1", "publish:1", "hide", "show", "publish:1", "close"]);
});

test("ending while the window is opening closes the late window without showing it", async () => {
  const calls: string[] = [];
  let resolveCreate!: (window: HudWindowHandle) => void;
  const handle: HudWindowHandle = { show: async () => { calls.push("show"); }, hide: async () => {},
    close: async () => { calls.push("close"); } };
  const hud = new HudWindowController({ find: async () => null,
    create: () => new Promise((resolve) => { resolveCreate = resolve; }), publish: async () => {} });
  const opening = hud.show();
  await Promise.resolve();
  await hud.close();
  resolveCreate(handle);
  await opening;
  assert.deepEqual(calls, ["close"]);
});
