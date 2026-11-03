import assert from "node:assert/strict";
import test from "node:test";
import { HudCuePreparer, hudPreparationAllowsStart, type CueCachePort } from "./hud-cue-preparation";
import { cueFingerprint, currentCueText, groundedCueText, sourceCueFallback, type PreparedHudCue } from "./prepared-hud-cues";
import type { MemoryProject } from "./session-schema";

function projects(count: number): MemoryProject[] {
  return [{ projectId: "platform", title: "Platform", facts: Array.from({ length: count }, (_, index) => ({
    id: `fact-${index}`, text: `Designed API onboarding flow ${index} with the platform team.`,
    source: `Interview evidence for flow ${index}`,
  })) }];
}

test("prepares in bounded batches, caches across entry modes, and invalidates one edited fact", async () => {
  const saved = new Map<string, PreparedHudCue>();
  const cache: CueCachePort = { load: async () => [...saved.values()], save: async (entries) => { for (const entry of entries) saved.set(entry.factId, entry); } };
  let calls = 0;
  const preparer = new HudCuePreparer(cache, async (batch) => {
    calls++;
    assert.ok(batch.length <= 12);
    return batch.map((fact) => ({ factId: fact.factId, projectId: fact.projectId,
      text: fact.sourceText.slice(0, fact.sourceText.indexOf(" with the platform team")) }));
  });
  const original = projects(13);
  const first = await preparer.prepare(original);
  assert.equal(calls, 2);
  assert.equal(first.generated, 13);
  assert.equal(first.usedFallback, false);
  const second = await preparer.prepare(original);
  assert.equal(calls, 2);
  assert.equal(second.cached, 13);
  const reopened = new HudCuePreparer(cache, async () => { calls++; assert.fail("Restart should load the saved cue cache"); });
  assert.equal((await reopened.prepare(original)).cached, 13);
  assert.equal(calls, 2);
  const edited = projects(13);
  edited[0].facts[0].text = "Designed a new API onboarding flow with a security partner.";
  const third = await preparer.prepare(edited);
  assert.equal(calls, 3);
  assert.equal(third.generated, 1);
  assert.equal(third.cached, 12);
  assert.equal(third.cues["fact-0"].sourceText, edited[0].facts[0].text);
  const deleted = await preparer.prepare([{ ...edited[0], facts: edited[0].facts.slice(1) }]);
  assert.equal(deleted.cues["fact-0"], undefined);
});

test("rejects unsupported claims, uses a complete source fallback, and suppresses repeat provider failures", async () => {
  assert.equal(hudPreparationAllowsStart("preparing"), false);
  assert.equal(hudPreparationAllowsStart("ready"), true);
  assert.equal(hudPreparationAllowsStart("fallback"), true);
  const source = "Advocated for a four digit PIN using field research. Security reviewed the decision.";
  assert.equal(groundedCueText("Increased revenue by 80%", source), false);
  assert.equal(groundedCueText("Led the rollout", "Did not lead the rollout."), false);
  assert.equal(sourceCueFallback(source), "Advocated for a four digit PIN using field research.");
  assert.equal(sourceCueFallback("Advocated to product and security teams for a four-digit PIN instead of six digits, citing research that 3–5% of associates forgot their PIN monthly and discussing the cost of recovery across several teams."),
    "Advocated to product and security teams for a four-digit PIN instead of six digits");
  const fact = { factId: "fact-1", projectId: "platform", sourceText: source };
  const fingerprint = await cueFingerprint(fact);
  assert.equal(currentCueText({ ...fact, fingerprint, text: "Invented a 90% improvement" }, fact, fingerprint), sourceCueFallback(source));
  let calls = 0;
  const preparer = new HudCuePreparer({ load: async () => [], save: async () => {} }, async () => { calls++; throw new Error("timeout"); });
  const data: MemoryProject[] = [{ projectId: "platform", title: "Platform", facts: [{ id: "fact-1", text: source, source: "Interview evidence" }] }];
  const first = await preparer.prepare(data);
  const second = await preparer.prepare(data);
  assert.equal(calls, 1);
  assert.equal(first.usedFallback, true);
  assert.equal(second.cues["fact-1"].text, sourceCueFallback(source));
});

test("malformed generated cues are never cached or shown", async () => {
  let writes = 0;
  const data = projects(1);
  const preparer = new HudCuePreparer({ load: async () => [], save: async () => { writes++; } },
    async () => [{ factId: "fact-0", projectId: "platform", text: "Increased revenue by 75%" }]);
  const result = await preparer.prepare(data);
  assert.equal(result.generated, 0);
  assert.equal(result.usedFallback, true);
  assert.equal(writes, 0);
  assert.equal(result.cues["fact-0"].text, data[0].facts[0].text);
});
