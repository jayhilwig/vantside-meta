import type { HudPreparationState } from "@/lib/hud-cue-preparation";

export function HudPreparationStatus({ state }: { state: HudPreparationState }) {
  if (state === "ready") return null;
  if (state === "fallback") return <p className="hud-preparation-fallback" role="status">Ready with approved Career Memory excerpts. Quick-reference preparation was unavailable.</p>;
  return <section className="hud-preparation" role="status" aria-live="polite">
    <span className="resume-processing-dots" aria-hidden="true"><i/><i/><i/><i/></span>
    <div><strong>Preparing your interview</strong><p>Creating quick-reference cues from your Career Memory.</p></div>
  </section>;
}
