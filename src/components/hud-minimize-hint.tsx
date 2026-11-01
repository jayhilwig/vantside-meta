"use client";

import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

export function HudMinimizeHint({ visible }: { visible: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (!isTauri() || !visible || dismissed) return null;
  return <p className="hud-minimize-hint">You can minimize VantSide and keep the floating HUD visible over your interview.
    <button type="button" aria-label="Dismiss HUD tip" onClick={() => setDismissed(true)}>×</button>
  </p>;
}
