"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import type { HudFact } from "@/lib/interview-hud-pipeline";

function emphasized(text: string) {
  return text.split(/(\$?\d+(?:[.,]\d+)?%?)/g).map((part, index) =>
    /^\$?\d/.test(part) ? <strong key={index} className="hud-number">{part}</strong> : part);
}

export function HudWindowView() {
  const [cues, setCues] = useState<HudFact[]>([]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    void listen<{ cues?: HudFact[] }>("vantside-hud-cues", ({ payload }) => {
      if (!Array.isArray(payload?.cues)) return;
      setCues(payload.cues.slice(0, 3).filter((cue) => typeof cue.factId === "string" &&
        typeof cue.projectId === "string" && typeof cue.text === "string" && cue.text.length <= 110));
    }).then((stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      void emitTo("main", "vantside-hud-ready");
    });
    void getCurrentWindow().onCloseRequested(() => { void emitTo("main", "vantside-hud-hidden"); })
      .then((stop) => { if (disposed) stop(); else unlistenClose = stop; });
    return () => { disposed = true; unlisten?.(); unlistenClose?.(); };
  }, []);

  async function hide() {
    await emitTo("main", "vantside-hud-hidden");
    await getCurrentWindow().hide();
  }

  async function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const change = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
    if (!change) return;
    event.preventDefault();
    const window = getCurrentWindow();
    const position = await window.outerPosition();
    await window.setPosition(new PhysicalPosition(position.x + change[0], position.y + change[1]));
  }

  return <main className="hud-root" aria-label="Career Memory HUD">
    <div className="hud-surface">
      <button type="button" className="hud-drag" aria-label="Move HUD. Drag or use arrow keys."
        onPointerDown={(event) => { if (event.button === 0) void getCurrentWindow().startDragging(); }}
        onKeyDown={(event) => { void moveWithKeyboard(event); }}>
        <span aria-hidden="true"><i/><i/><i/><i/><i/><i/></span>
      </button>
      <button type="button" className="hud-hide" onClick={() => void hide()} aria-label="Hide HUD">×</button>
      <div className="hud-facts" aria-live="polite" aria-atomic="true">
        {cues.length ? cues.map((cue) => <div className="hud-fact" key={cue.factId} data-fact-id={cue.factId}>{emphasized(cue.text)}</div>)
          : <p className="hud-waiting">Waiting for a relevant practice question</p>}
      </div>
    </div>
  </main>;
}
