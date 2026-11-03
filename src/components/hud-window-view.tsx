"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import type { HudFact } from "@/lib/interview-hud-pipeline";
import { emptyHudSnapshot, type HudCueState, type HudSnapshot, type HudSessionStatus } from "@/lib/hud-window";
import { HudFacts } from "./hud-facts";
import { HudVisibilityIcon } from "./hud-visibility-icon";
import type { GoLiveHudAction } from "@/lib/go-live-session";
import { HudCommandGate, hudControlPresentation } from "@/lib/hud-session-controls";
import { canDragHudHeader } from "@/lib/hud-drag";

export function HudWindowView() {
  const [snapshot, setSnapshot] = useState<HudSnapshot>(emptyHudSnapshot);
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState("");
  const commandGate = useRef(new HudCommandGate());
  useEffect(() => {
    if (snapshot.cues.length) void emitTo("main", "vantside-hud-rendered", { count: snapshot.cues.length });
  }, [snapshot.cues]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    void listen<Partial<HudSnapshot>>("vantside-hud-state", ({ payload }) => {
      if (!Array.isArray(payload?.cues)) return;
      const statuses: HudSessionStatus[] = ["ready", "listening", "processing", "paused", "stopped"];
      const cues: HudFact[] = payload.cues.slice(0, 3).filter((cue) => typeof cue.factId === "string" &&
        typeof cue.projectId === "string" && typeof cue.text === "string" && cue.text.length <= 400);
      const cueStates: HudCueState[] = ["idle", "finding", "shown", "no-match", "unavailable"];
      commandGate.current.settled(); setCommandPending(false);
      setSnapshot({ status: statuses.includes(payload.status as HudSessionStatus) ? payload.status as HudSessionStatus : "ready",
        question: typeof payload.question === "string" ? payload.question.slice(0, 500) : "",
        cues, noMatch: payload.noMatch === true && cues.length === 0,
        cueState: cueStates.includes(payload.cueState as HudCueState) ? payload.cueState : undefined,
        controls: payload.controls?.kind === "go-live" ? { kind: "go-live", automatic: payload.controls.automatic === true,
          startAllowed: payload.controls.startAllowed === true,
          startHint: typeof payload.controls.startHint === "string" ? payload.controls.startHint.slice(0, 120) : "" }
          : payload.controls?.kind === "practice" ? { kind: "practice", canStop: payload.controls.canStop === true } : undefined });
    }).then((stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      void emitTo("main", "vantside-hud-ready");
    });
    void getCurrentWindow().onCloseRequested(async () => { await emitTo("main", "vantside-hud-command", { action: "close" }); })
      .then((stop) => { if (disposed) stop(); else unlistenClose = stop; });
    return () => { disposed = true; unlisten?.(); unlistenClose?.(); };
  }, []);

  async function hide() {
    await emitTo("main", "vantside-hud-hidden");
    await getCurrentWindow().hide();
  }

  async function sendCommand(action: GoLiveHudAction) {
    if (!commandGate.current.begin(action)) return;
    setCommandPending(true); setCommandError("");
    try { await emitTo("main", "vantside-hud-command", { action }); }
    catch { commandGate.current.failed(); setCommandPending(false); setCommandError("VantSide could not receive this control. Use the main window."); }
  }

  async function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const change = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
    if (!change) return;
    event.preventDefault();
    const window = getCurrentWindow();
    const position = await window.outerPosition();
    await window.setPosition(new PhysicalPosition(position.x + change[0], position.y + change[1]));
  }

  const controlPresentation = hudControlPresentation(snapshot);
  return <main className="hud-root" aria-label="Career Memory HUD">
    <div className="hud-surface">
      <div className="hud-header" title="Drag to move HUD" onPointerDown={(event) => {
        if (canDragHudHeader(event.button, event.target as Element)) void getCurrentWindow().startDragging();
      }}><strong>VantSide</strong><span className={`hud-status ${snapshot.status}`} role="status"><i aria-hidden="true"/>{({ ready: "Ready", listening: "Listening", processing: "Processing", paused: "Paused", stopped: "Stopped" } as const)[snapshot.status]}</span></div>
      <button type="button" className="hud-drag" aria-label="Move HUD. Drag or use arrow keys."
        onPointerDown={(event) => { if (event.button === 0) void getCurrentWindow().startDragging(); }}
        onKeyDown={(event) => { void moveWithKeyboard(event); }}>
        <span aria-hidden="true"><i/><i/><i/><i/><i/><i/></span>
      </button>
      <div className="hud-window-actions"><button type="button" className="hud-hide" onClick={() => void hide()} aria-label="Hide HUD" title="Hide HUD"><HudVisibilityIcon hidden/></button>
        {snapshot.controls && <button type="button" className="hud-close" onClick={() => void sendCommand("close")} aria-label="Close HUD and end active session" title="Close HUD">×</button>}</div>
      {snapshot.controls && <div className="hud-session-controls">
        {controlPresentation.buttons.map((button) => <button key={button.action} type="button" className={button.primary ? "hud-start" : undefined}
          disabled={commandPending || button.disabled} onClick={() => void sendCommand(button.action)}>{button.label}</button>)}
        {controlPresentation.note && <span className="hud-control-note">{controlPresentation.note}</span>}
      </div>}
      <div className="hud-content">
        {commandError && <p className="hud-command-error" role="alert">{commandError}</p>}
        {snapshot.question && <div className="hud-question"><span>QUESTION HEARD</span><p>{snapshot.question}</p></div>}
        {snapshot.question && <p className="hud-decision">{snapshot.cues.length ? "Career Memory found" : "Question recognized"}</p>}
        <div className="hud-divider" aria-hidden="true"/>
        <HudFacts cues={snapshot.cues} noMatch={snapshot.noMatch} cueState={snapshot.cueState} status={snapshot.status} hasQuestion={Boolean(snapshot.question)}/>
      </div>
    </div>
  </main>;
}
