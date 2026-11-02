import type { GoLiveHudAction } from "./go-live-session";
import type { HudSnapshot, HudSessionStatus } from "./hud-window";

type ControlButton = { action: GoLiveHudAction; label: string; primary?: boolean; disabled?: boolean };

export function hudControlPresentation(snapshot: HudSnapshot): { buttons: ControlButton[]; note: string } {
  const controls = snapshot.controls;
  if (!controls) return { buttons: [], note: "" };
  if (snapshot.status === "stopped") return { buttons: [], note: controls.kind === "practice" ? "Practice stopped" : "Listening stopped" };
  if (snapshot.status === "ready") {
    if (controls.kind === "go-live" && controls.automatic)
      return { buttons: [{ action: "start", label: "Start Listening", primary: true, disabled: !controls.startAllowed }],
        note: controls.startAllowed ? "" : controls.startHint || "Complete setup in VantSide." };
    return { buttons: [], note: controls.kind === "practice" ? "Start Practice in VantSide." : "Start this input mode in VantSide." };
  }
  if (controls.kind === "practice" && !controls.canStop) return { buttons: [], note: "Preparing review…" };
  if (snapshot.status === "paused") return { buttons: [
    { action: "resume", label: "Resume", primary: true }, { action: "stop", label: controls.kind === "practice" ? "End Practice" : "Stop" }], note: "" };
  if (snapshot.status === "listening") return { buttons: [
    ...(controls.kind === "practice" || controls.automatic ? [{ action: "pause" as const, label: "Pause" }] : []),
    { action: "stop", label: controls.kind === "practice" ? "End Practice" : "Stop" }], note: "" };
  return { buttons: [{ action: "stop", label: controls.kind === "practice" ? "End Practice" : "Stop" }], note: "Processing…" };
}

export function canRunPracticeHudAction(action: GoLiveHudAction, status: HudSessionStatus, canStop: boolean): boolean {
  if (action === "close") return true;
  if (!canStop) return false;
  if (action === "pause") return status === "listening";
  if (action === "resume") return status === "paused";
  return action === "stop" && (status === "listening" || status === "paused" || status === "processing");
}

export class HudCommandGate {
  private pending = false;
  private closing = false;

  begin(action: GoLiveHudAction): boolean {
    if (this.closing || (this.pending && action !== "close")) return false;
    this.pending = true;
    if (action === "close") this.closing = true;
    return true;
  }

  settled(): void { if (!this.closing) this.pending = false; }
  failed(): void { this.pending = false; this.closing = false; }
}
