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
  const closing = hud.close();
  resolveCreate(handle);
  await Promise.all([opening, closing]);
  assert.deepEqual(calls, ["close"]);
});

test("show after hide during window creation still displays the window", async () => {
  const calls: string[] = [];
  let resolveCreate!: (window: HudWindowHandle) => void;
  const handle: HudWindowHandle = { show: async () => { calls.push("show"); },
    hide: async () => { calls.push("hide"); }, close: async () => { calls.push("close"); } };
  const hud = new HudWindowController({ find: async () => null,
    create: () => new Promise((resolve) => { resolveCreate = resolve; }), publish: async () => {} });
  const opening = hud.show();
  await Promise.resolve();
  await hud.hide();
  const reopening = hud.show();
  resolveCreate(handle);
  await Promise.all([opening, reopening]);
  assert.deepEqual(calls, ["show"]);
  await hud.close();
  assert.deepEqual(calls, ["show", "close"]);
});

test("closing discards cues before a new session", async () => {
  const published: number[] = [];
  const handle: HudWindowHandle = { show: async () => {}, hide: async () => {}, close: async () => {} };
  const hud = new HudWindowController({ find: async () => null, create: async () => handle,
    publish: async (cues) => { published.push(cues.length); } });
  await hud.show();
  await hud.publish([{ factId: "old", projectId: "old-project", text: "Old cue" }]);
  await hud.close();
  await hud.show();
  await hud.ready();
  assert.deepEqual(published, [1, 0]);
});

test("a new session waits for the previous HUD window to finish closing", async () => {
  const calls: string[] = [];
  let finishClose!: () => void;
  const first: HudWindowHandle = { show: async () => { calls.push("show-first"); }, hide: async () => {},
    close: () => new Promise((resolve) => { finishClose = () => { calls.push("close-first"); resolve(); }; }) };
  const second: HudWindowHandle = { show: async () => { calls.push("show-second"); }, hide: async () => {}, close: async () => {} };
  let created = 0;
  const hud = new HudWindowController({ find: async () => null,
    create: async () => ++created === 1 ? first : second, publish: async () => {} });
  await hud.show();
  const closing = hud.close();
  const reopening = hud.show();
  await Promise.resolve();
  assert.deepEqual(calls, ["show-first"]);
  finishClose();
  await Promise.all([closing, reopening]);
  assert.deepEqual(calls, ["show-first", "close-first", "show-second"]);
});
