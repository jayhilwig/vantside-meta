import type { HudFact } from "@/lib/interview-hud-pipeline";
import type { HudSessionStatus } from "@/lib/hud-window";

export function HudFacts({ cues, noMatch = false, status = "ready", hasQuestion = false }: { cues: HudFact[]; noMatch?: boolean; status?: HudSessionStatus; hasQuestion?: boolean }) {
  return <div className="hud-facts" aria-live="polite" aria-atomic="true">
    {cues.length ? cues.slice(0, 3).map((cue) => <div className="hud-fact" key={cue.factId} data-fact-id={cue.factId}>
      {cue.text.split(/(\$?\d+(?:[.,]\d+)?%?)/g).map((part, index) => /^\$?\d/.test(part) ? <strong key={index} className="hud-number">{part}</strong> : part)}
    </div>) : <p className="hud-waiting">{noMatch ? "No relevant Career Memory for this question." : status === "stopped" ? "Session stopped" : status === "processing" ? hasQuestion ? "Checking Career Memory…" : "Preparing to listen…" : status === "ready" ? "Ready when you are" : "Waiting for a relevant question"}</p>}
  </div>;
}
