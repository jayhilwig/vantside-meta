import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { HudFact } from "./interview-hud-pipeline";

export type HudSessionStatus = "ready" | "listening" | "processing" | "paused" | "stopped";
export type HudCueState = "idle" | "finding" | "shown" | "no-match" | "unavailable";
export type HudControls =
  | { kind: "go-live"; automatic: boolean; startAllowed: boolean; startHint: string }
  | { kind: "practice"; canStop: boolean };
export type HudSnapshot = { status: HudSessionStatus; question: string; cues: HudFact[]; noMatch: boolean;
  cueState?: HudCueState; controls?: HudControls };
export const emptyHudSnapshot = (): HudSnapshot => ({ status: "ready", question: "", cues: [], noMatch: false });

export interface HudWindowHandle { show(): Promise<void>; hide(): Promise<void>; close(): Promise<void> }
export interface HudWindowPort {
  find(): Promise<HudWindowHandle | null>;
  create(): Promise<HudWindowHandle>;
  publish(snapshot: HudSnapshot): Promise<void>;
}

export class HudWindowController {
  private window: HudWindowHandle | null = null;
  private opening: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private visible = false;
  private generation = 0;
  private snapshot = emptyHudSnapshot();

  constructor(private readonly port: HudWindowPort) {}

  async show(): Promise<void> {
    if (this.closing) await this.closing;
    this.visible = true;
    if (this.opening) return this.opening;
    const generation = this.generation;
    this.opening = (async () => {
      const window = await this.port.find() ?? await this.port.create();
      if (generation !== this.generation || !this.visible) { await window.close(); return; }
      this.window = window;
      await window.show();
      await this.port.publish(this.snapshot);
    })();
    try { await this.opening; } finally { this.opening = null; }
  }

  async ready(): Promise<void> {
    if (this.visible) await this.port.publish(this.snapshot);
  }

  async publish(snapshot: HudSnapshot): Promise<void> {
    this.snapshot = { ...snapshot, question: snapshot.question.slice(0, 500), cues: snapshot.cues.slice(0, 3) };
    if (this.visible && this.window) await this.port.publish(this.snapshot);
  }

  async hide(): Promise<void> {
    this.visible = false;
    if (this.window) await this.window.hide().catch(() => undefined);
  }

  async close(): Promise<void> {
    this.generation++;
    this.visible = false;
    this.snapshot = emptyHudSnapshot();
    if (this.closing) return this.closing;
    const closing = (async () => {
      await this.opening?.catch(() => undefined);
      const window = this.window;
      this.window = null;
      if (window) await window.close().catch(() => undefined);
    })();
    this.closing = closing;
    try { await closing; } finally { if (this.closing === closing) this.closing = null; }
  }
}

export const tauriHudPort: HudWindowPort = {
  find: () => WebviewWindow.getByLabel("hud"),
  create: async () => {
    const main = WebviewWindow.getCurrent();
    const [position, size, scale] = await Promise.all([main.outerPosition(), main.outerSize(), main.scaleFactor()]);
    return new Promise((resolve, reject) => {
      const window = new WebviewWindow("hud", {
      url: "/hud/", title: "VantSide HUD", width: 1080, height: 290, minWidth: 520, minHeight: 240,
      x: Math.round(position.x / scale + (size.width / scale - 1080) / 2), y: Math.round(position.y / scale + 56),
      visible: false, decorations: false, alwaysOnTop: true, skipTaskbar: true,
      transparent: true, shadow: false, resizable: true, preventOverflow: true, focus: false,
      });
      void window.once("tauri://created", () => resolve(window)).catch(reject);
      void window.once("tauri://error", () => reject(new Error("The desktop HUD could not open."))).catch(reject);
    });
  },
  publish: (snapshot) => emitTo("hud", "vantside-hud-state", snapshot),
};
