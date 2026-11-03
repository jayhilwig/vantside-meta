import { approvedHudFacts, cueFingerprint, sourceCueFallback, validPreparedCue,
  type ApprovedHudFact, type PreparedHudCue } from "./prepared-hud-cues";
import type { MemoryProject } from "./session-schema";

export type PreparedCueMap = Record<string, PreparedHudCue>;
export type PreparationResult = { cues: PreparedCueMap; usedFallback: boolean; cached: number; generated: number };
export type HudPreparationState = "preparing" | "ready" | "fallback";
export function hudPreparationAllowsStart(state: HudPreparationState): boolean { return state !== "preparing"; }
export type CueCachePort = { load(): Promise<PreparedHudCue[]>; save(cues: PreparedHudCue[]): Promise<void> };
export type CueBatchPort = (facts: ApprovedHudFact[], signal: AbortSignal) => Promise<Array<{ factId: string; projectId: string; text: string }>>;

export class HudCuePreparer {
  private inFlight = new Map<string, Promise<PreparationResult>>();
  private sessionCache = new Map<string, PreparedHudCue>();
  private failed = new Set<string>();

  constructor(private readonly cache: CueCachePort, private readonly generate: CueBatchPort) {}

  async prepare(projects: MemoryProject[]): Promise<PreparationResult> {
    const facts = await Promise.all(approvedHudFacts(projects).map(async (fact) => ({ ...fact, fingerprint: await cueFingerprint(fact) })));
    if (!facts.length) return { cues: {}, usedFallback: false, cached: 0, generated: 0 };
    const key = facts.map((fact) => fact.fingerprint).sort().join(":");
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const run = this.prepareFacts(facts);
    this.inFlight.set(key, run);
    try { return await run; } finally { if (this.inFlight.get(key) === run) this.inFlight.delete(key); }
  }

  private async prepareFacts(facts: Array<ApprovedHudFact & { fingerprint: string }>): Promise<PreparationResult> {
    const cues: PreparedCueMap = {};
    let cached = 0; let generated = 0;
    let stored: PreparedHudCue[];
    try { stored = await this.cache.load(); } catch { stored = []; }
    const available = new Map([...stored, ...this.sessionCache.values()].map((cue) => [cue.factId, cue]));
    const missing = facts.filter((fact) => {
      const candidate = available.get(fact.factId);
      if (!candidate || !validPreparedCue(candidate, fact, fact.fingerprint)) return true;
      cues[fact.factId] = candidate; cached++;
      return false;
    });
    const pending = missing.filter((fact) => !this.failed.has(fact.fingerprint));
    const signal = AbortSignal.timeout(25_000);
    for (let offset = 0; offset < pending.length; offset += 12) {
      const batch = pending.slice(offset, offset + 12);
      if (signal.aborted) break;
      let candidates: Awaited<ReturnType<CueBatchPort>>;
      try { candidates = await this.generate(batch, signal); }
      catch { break; }
      const byId = new Map(candidates.map((cue) => [cue.factId, cue]));
      const accepted = batch.flatMap((fact) => {
        const candidate = byId.get(fact.factId);
        if (!candidate || candidate.projectId !== fact.projectId) return [];
        const cue = { ...fact, text: candidate.text };
        return validPreparedCue(cue, fact, fact.fingerprint) ? [cue] : [];
      });
      for (const cue of accepted) { cues[cue.factId] = cue; this.sessionCache.set(cue.factId, cue); generated++; }
      if (accepted.length) try { await this.cache.save(accepted); } catch { /* Keep validated cues for this app session. */ }
    }
    for (const fact of missing) if (!cues[fact.factId]) this.failed.add(fact.fingerprint);
    const fallback = facts.filter((fact) => !cues[fact.factId]);
    for (const fact of fallback) cues[fact.factId] = { ...fact, text: sourceCueFallback(fact.sourceText) };
    return { cues, usedFallback: fallback.length > 0, cached, generated };
  }
}
