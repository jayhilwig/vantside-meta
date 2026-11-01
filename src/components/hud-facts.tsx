import type { HudFact } from "@/lib/interview-hud-pipeline";

export function HudFacts({ cues }: { cues: HudFact[] }) {
  return <div className="hud-facts" aria-live="polite" aria-atomic="true">
    {cues.length ? cues.slice(0, 3).map((cue) => <div className="hud-fact" key={cue.factId} data-fact-id={cue.factId}>
      {cue.text.split(/(\$?\d+(?:[.,]\d+)?%?)/g).map((part, index) => /^\$?\d/.test(part) ? <strong key={index} className="hud-number">{part}</strong> : part)}
    </div>) : <p className="hud-waiting">Waiting for a relevant practice question</p>}
  </div>;
}
