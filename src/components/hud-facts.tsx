import type { HudFact } from "@/lib/interview-hud-pipeline";
import type { HudCueState, HudSessionStatus } from "@/lib/hud-window";

export function hudCueMessage(cueState: HudCueState, status: HudSessionStatus, hasQuestion: boolean): string {
  if (cueState === "no-match") return "No matching Career Memory";
  if (cueState === "unavailable") return "Cue unavailable. You can keep interviewing.";
  if (cueState === "finding") return "Checking Career Memory…";
  if (status === "stopped") return "Session stopped";
  if (status === "processing") return "Preparing to listen…";
  if (hasQuestion) return "Question recognized";
  return status === "ready" ? "Ready when you are" : "Waiting for a question";
}

export function HudFacts({ cues, noMatch = false, status = "ready", hasQuestion = false, cueState }: { cues: HudFact[]; noMatch?: boolean; status?: HudSessionStatus; hasQuestion?: boolean; cueState?: HudCueState }) {
  const resolvedState = cueState ?? (cues.length ? "shown" : noMatch ? "no-match" : "idle");
  return <div className="hud-facts" aria-live="polite" aria-atomic="true">
    {cues.length ? cues.slice(0, 3).map((cue) => <div className="hud-fact" key={cue.factId} data-fact-id={cue.factId}>
      {cue.text.split(/(\$?\d+(?:[.,]\d+)?%?)/g).map((part, index) => /^\$?\d/.test(part) ? <strong key={index} className="hud-number">{part}</strong> : part)}
    </div>) : <p className="hud-waiting">{hudCueMessage(resolvedState, status, hasQuestion)}</p>}
  </div>;
}
