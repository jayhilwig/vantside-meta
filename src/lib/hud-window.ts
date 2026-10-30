import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { HudFact } from "./interview-hud-pipeline";

export interface HudWindowHandle { show(): Promise<void>; hide(): Promise<void>; close(): Promise<void> }
export interface HudWindowPort {
  find(): Promise<HudWindowHandle | null>;
  create(): Promise<HudWindowHandle>;
  publish(cues: HudFact[]): Promise<void>;
}

export class HudWindowController {
  private window: HudWindowHandle | null = null;
  private opening: Promise<void> | null = null;
  private visible = false;
  private generation = 0;
  private cues: HudFact[] = [];

  constructor(private readonly port: HudWindowPort) {}

  async show(): Promise<void> {
    if (this.opening) return this.opening;
    this.visible = true;
    const generation = this.generation;
    this.opening = (async () => {
      const window = await this.port.find() ?? await this.port.create();
      if (generation !== this.generation || !this.visible) { await window.close(); return; }
      this.window = window;
      await window.show();
      if (this.cues.length) await this.port.publish(this.cues);
    })();
    try { await this.opening; } finally { this.opening = null; }
  }

  async ready(): Promise<void> {
    if (this.visible) await this.port.publish(this.cues);
  }

  async publish(cues: HudFact[]): Promise<void> {
    this.cues = cues.slice(0, 3);
    if (this.visible && this.window) await this.port.publish(this.cues);
  }

  async hide(): Promise<void> {
    this.visible = false;
    if (this.window) await this.window.hide().catch(() => undefined);
  }

  async close(): Promise<void> {
    this.generation++;
    this.visible = false;
    this.cues = [];
    const window = this.window;
    this.window = null;
    if (window) await window.close().catch(() => undefined);
  }
}

export const tauriHudPort: HudWindowPort = {
  find: () => WebviewWindow.getByLabel("hud"),
  create: async () => {
    const main = WebviewWindow.getCurrent();
    const [position, size, scale] = await Promise.all([main.outerPosition(), main.outerSize(), main.scaleFactor()]);
    return new Promise((resolve, reject) => {
      const window = new WebviewWindow("hud", {
      url: "/hud/", title: "VantSide HUD", width: 1080, height: 178, minWidth: 520, minHeight: 130,
      x: Math.round(position.x / scale + (size.width / scale - 1080) / 2), y: Math.round(position.y / scale + 56),
      visible: false, decorations: false, alwaysOnTop: true, skipTaskbar: true,
      transparent: true, shadow: false, resizable: true, preventOverflow: true, focus: false,
      });
      void window.once("tauri://created", () => resolve(window)).catch(reject);
      void window.once("tauri://error", () => reject(new Error("The desktop HUD could not open."))).catch(reject);
    });
  },
  publish: (cues) => emitTo("hud", "vantside-hud-cues", { cues }),
};
