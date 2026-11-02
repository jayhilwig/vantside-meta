"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import type { HudFact } from "@/lib/interview-hud-pipeline";
import { emptyHudSnapshot, type HudSnapshot, type HudSessionStatus } from "@/lib/hud-window";
import { HudFacts } from "./hud-facts";
import { HudVisibilityIcon } from "./hud-visibility-icon";
import type { GoLiveHudAction } from "@/lib/go-live-session";

export function HudWindowView() {
  const [snapshot, setSnapshot] = useState<HudSnapshot>(emptyHudSnapshot);
  const [commandPending, setCommandPending] = useState(false);
  const [commandError, setCommandError] = useState("");
  const commandPendingRef = useRef(false);
  const closeSentRef = useRef(false);
  const goLiveRef = useRef(false);
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
        typeof cue.projectId === "string" && typeof cue.text === "string" && cue.text.length <= 110);
      commandPendingRef.current = false; setCommandPending(false);
      goLiveRef.current = payload.controls?.kind === "go-live";
      setSnapshot({ status: statuses.includes(payload.status as HudSessionStatus) ? payload.status as HudSessionStatus : "ready",
        question: typeof payload.question === "string" ? payload.question.slice(0, 500) : "",
        cues, noMatch: payload.noMatch === true && cues.length === 0,
        controls: payload.controls?.kind === "go-live" ? { kind: "go-live", automatic: payload.controls.automatic === true,
          startAllowed: payload.controls.startAllowed === true,
          startHint: typeof payload.controls.startHint === "string" ? payload.controls.startHint.slice(0, 120) : "" } : undefined });
    }).then((stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      void emitTo("main", "vantside-hud-ready");
    });
    void getCurrentWindow().onCloseRequested(async () => { await emitTo("main", goLiveRef.current ? "vantside-hud-command" : "vantside-hud-hidden",
      goLiveRef.current ? { action: "close" } : undefined); })
      .then((stop) => { if (disposed) stop(); else unlistenClose = stop; });
    return () => { disposed = true; unlisten?.(); unlistenClose?.(); };
  }, []);

  async function hide() {
    await emitTo("main", "vantside-hud-hidden");
    await getCurrentWindow().hide();
  }

  async function sendCommand(action: GoLiveHudAction) {
    if (action === "close" ? closeSentRef.current : commandPendingRef.current) return;
    if (action === "close") closeSentRef.current = true;
    commandPendingRef.current = true; setCommandPending(true); setCommandError("");
    try { await emitTo("main", "vantside-hud-command", { action }); }
    catch { commandPendingRef.current = false; closeSentRef.current = false; setCommandPending(false); setCommandError("VantSide could not receive this control. Use the main window."); }
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
      <div className="hud-header"><strong>VantSide</strong><span className={`hud-status ${snapshot.status}`} role="status"><i aria-hidden="true"/>{({ ready: "Ready", listening: "Listening", processing: "Processing", paused: "Paused", stopped: "Stopped" } as const)[snapshot.status]}</span></div>
      <button type="button" className="hud-drag" aria-label="Move HUD. Drag or use arrow keys."
        onPointerDown={(event) => { if (event.button === 0) void getCurrentWindow().startDragging(); }}
        onKeyDown={(event) => { void moveWithKeyboard(event); }}>
        <span aria-hidden="true"><i/><i/><i/><i/><i/><i/></span>
      </button>
      <div className="hud-window-actions"><button type="button" className="hud-hide" onClick={() => void hide()} aria-label="Hide HUD" title="Hide HUD"><HudVisibilityIcon hidden/></button>
        {snapshot.controls?.kind === "go-live" && <button type="button" className="hud-close" onClick={() => void sendCommand("close")} aria-label="Close HUD and stop listening" title="Close HUD">×</button>}</div>
      {snapshot.controls?.kind === "go-live" && snapshot.controls.automatic && <div className="hud-session-controls">
        {snapshot.status === "ready" && <><button type="button" className="hud-start" disabled={!snapshot.controls.startAllowed || commandPending} onClick={() => void sendCommand("start")}>Start Listening</button>
          {!snapshot.controls.startAllowed && <span className="hud-control-note">{snapshot.controls.startHint || "Complete setup in VantSide."}</span>}</>}
        {snapshot.status === "listening" && <><button type="button" disabled={commandPending} onClick={() => void sendCommand("pause")}>Pause</button><button type="button" disabled={commandPending} onClick={() => void sendCommand("stop")}>Stop</button></>}
        {snapshot.status === "paused" && <><button type="button" className="hud-start" disabled={commandPending} onClick={() => void sendCommand("resume")}>Resume</button><button type="button" disabled={commandPending} onClick={() => void sendCommand("stop")}>Stop</button></>}
        {snapshot.status === "processing" && <><span className="hud-control-note">Processing…</span><button type="button" disabled={commandPending} onClick={() => void sendCommand("stop")}>Stop</button></>}
        {snapshot.status === "stopped" && <span className="hud-control-note">Listening stopped</span>}
      </div>}
      {commandError && <p className="hud-command-error" role="alert">{commandError}</p>}
      {snapshot.question && <div className="hud-question"><span>QUESTION HEARD</span><p>{snapshot.question}</p></div>}
      {snapshot.question && <p className="hud-decision" role="status">{snapshot.cues.length ? "Career Memory found" : snapshot.noMatch ? "No relevant memory found" : snapshot.status === "processing" ? "Finding relevant Career Memory…" : "Question recognized"}</p>}
      <div className="hud-divider" aria-hidden="true"/>
      <HudFacts cues={snapshot.cues} noMatch={snapshot.noMatch} status={snapshot.status} hasQuestion={Boolean(snapshot.question)}/>
    </div>
  </main>;
}
