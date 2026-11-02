import assert from "node:assert/strict";
import test from "node:test";
import { HudWindowController, emptyHudSnapshot, type HudSnapshot, type HudWindowHandle, type HudWindowPort } from "./hud-window";

test("HUD opens once, republishes on ready, hides, reopens, and closes on interview end", async () => {
  const calls: string[] = [];
  let existing: HudWindowHandle | null = null;
  const handle: HudWindowHandle = { show: async () => { calls.push("show"); },
    hide: async () => { calls.push("hide"); }, close: async () => { calls.push("close"); existing = null; } };
  const port: HudWindowPort = { find: async () => existing,
    create: async () => { calls.push("create"); existing = handle; return handle; },
    publish: async (snapshot) => { calls.push(`publish:${snapshot.status}:${snapshot.cues.length}`); } };
  const hud = new HudWindowController(port);
  await hud.show(); await hud.show();
  await hud.publish({ status: "listening", question: "What API work did you lead?", noMatch: false,
    cues: [{ factId: "fact-1", projectId: "project-1", text: "Led API work" }] });
  await hud.ready(); await hud.hide(); await hud.show(); await hud.close();
  assert.equal(calls.filter((call) => call === "create").length, 1);
  assert.deepEqual(calls, ["create", "show", "publish:ready:0", "show", "publish:ready:0",
    "publish:listening:1", "publish:listening:1", "hide", "show", "publish:listening:1", "close"]);
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

test("session status, question, approved cue and no-match survive hide but clear on close", async () => {
  const published: HudSnapshot[] = [];
  const handle: HudWindowHandle = { show: async () => {}, hide: async () => {}, close: async () => {} };
  const hud = new HudWindowController({ find: async () => null, create: async () => handle,
    publish: async (snapshot) => { published.push(structuredClone(snapshot)); } });
  await hud.show();
  assert.deepEqual(published.at(-1), emptyHudSnapshot());
  await hud.publish({ status: "listening", question: "", cues: [], noMatch: false });
  await hud.publish({ status: "processing", question: "Tell me about your API work?", cues: [], noMatch: false });
  await hud.publish({ status: "listening", question: "Tell me about your API work?",
    cues: [{ factId: "old", projectId: "old-project", text: "Old cue" }], noMatch: false });
  assert.equal(published.at(-1)?.cues[0]?.factId, "old");
  await hud.publish({ status: "listening", question: "Tell me about design?", cues: [], noMatch: true });
  assert.equal(published.at(-1)?.noMatch, true);
  await hud.publish({ status: "paused", question: "Tell me about design?", cues: [], noMatch: true });
  await hud.hide();
  await hud.show();
  assert.equal(published.at(-1)?.status, "paused");
  await hud.publish({ status: "listening", question: "", cues: [], noMatch: false });
  await hud.close();
  await hud.show();
  await hud.ready();
  assert.deepEqual(published.at(-1), emptyHudSnapshot());
  assert.equal(published.some((snapshot) => snapshot.cues.some((cue) => cue.factId === "old")), true);
});

test("a stopped session keeps its last cue visible until Close dismisses the window", async () => {
  let closes = 0;
  const published: HudSnapshot[] = [];
  const handle: HudWindowHandle = { show: async () => {}, hide: async () => {}, close: async () => { closes++; } };
  const hud = new HudWindowController({ find: async () => null, create: async () => handle,
    publish: async (snapshot) => { published.push(structuredClone(snapshot)); } });
  await hud.show();
  await hud.publish({ status: "stopped", question: "How did you launch the API?", noMatch: false,
    cues: [{ factId: "approved-1", projectId: "project-1", text: "Led the API launch" }],
    controls: { kind: "go-live", automatic: true, startAllowed: false, startHint: "" } });
  assert.equal(closes, 0);
  assert.equal(published.at(-1)?.status, "stopped");
  assert.equal(published.at(-1)?.cues[0]?.factId, "approved-1");
  await hud.close();
  assert.equal(closes, 1);
  await hud.show();
  assert.deepEqual(published.at(-1), emptyHudSnapshot());
});

test("Practice Stop leaves the shared HUD visible with its last cue until Close", async () => {
  let closes = 0;
  const published: HudSnapshot[] = [];
  const hud = new HudWindowController({ find: async () => null,
    create: async () => ({ show: async () => {}, hide: async () => {}, close: async () => { closes++; } }),
    publish: async (snapshot) => { published.push(structuredClone(snapshot)); } });
  await hud.show();
  await hud.publish({ status: "listening", question: "What did you build?", noMatch: false,
    cues: [{ factId: "approved-1", projectId: "project-1", text: "Led an API redesign" }],
    controls: { kind: "practice", canStop: true } });
  await hud.publish({ ...published.at(-1)!, status: "stopped", controls: { kind: "practice", canStop: false } });
  assert.equal(closes, 0);
  assert.equal(published.at(-1)?.status, "stopped");
  assert.equal(published.at(-1)?.cues[0]?.factId, "approved-1");
  await hud.close();
  assert.equal(closes, 1);
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
