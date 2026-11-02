import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateLiveProposals, extractLiveEvidenceProposals, LiveEvidenceBuffer, liveEvidenceChunks,
  LIVE_EXTRACTION_CHARS, MAX_LIVE_EVIDENCE_CHARS } from "./live-evidence";

test("long session evidence retains early, middle, and late speech for extraction", async () => {
  const evidence = new LiveEvidenceBuffer();
  for (let turn = 0; turn < 45; turn++) {
    assert.equal(evidence.append(`Turn ${turn}: ${"described a concrete project decision and its context. ".repeat(30)}`), false);
  }
  const chunks = liveEvidenceChunks(evidence.text());
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= LIVE_EXTRACTION_CHARS));
  const requested: string[] = [];
  const proposals = await extractLiveEvidenceProposals(evidence.text(), async (chunk) => {
    requested.push(chunk);
    return [{ title: "Example", text: "User described a project decision", source: "described a concrete project decision" }];
  });
  assert.equal(requested.length, chunks.length);
  for (const marker of ["Turn 0:", "Turn 20:", "Turn 44:"]) assert.ok(requested.some((chunk) => chunk.includes(marker)));
  assert.equal(proposals.length, chunks.length);
});

test("evidence cap reports a limit instead of silently keeping only the beginning", () => {
  const evidence = new LiveEvidenceBuffer();
  assert.equal(evidence.append("a".repeat(MAX_LIVE_EVIDENCE_CHARS - 2)), false);
  assert.equal(evidence.append("end of captured speech"), true);
  assert.equal(evidence.length(), MAX_LIVE_EVIDENCE_CHARS);
  assert.equal(evidence.text().endsWith("en"), true);
});

test("transcript diagnostics count deltas and estimate segments without labeling deltas as turns", () => {
  const evidence = new LiveEvidenceBuffer();
  evidence.append("I led research", 1_000, 1_500);
  evidence.append(" with support", 1_500, 2_000);
  evidence.append("We changed the flow", 5_000, 6_000);
  assert.deepEqual(evidence.stats(), { characters: evidence.text().length, transcriptEvents: 3, estimatedSpeechSegments: 2 });
});

test("cross-chunk deduplication removes exact repeats while preserving distinct same-project facts", () => {
  const proposals = [
    { title: "Atlas", text: "Interviewed support agents", source: "I interviewed support agents" },
    { title: "Atlas", text: "Mapped escalation paths", source: "I mapped escalation paths" },
    { title: "Atlas", text: "Interviewed support agents!", source: "I interviewed support agents" },
    { title: "Atlas", text: "Improved onboarding", source: "I improved onboarding" },
    { title: "Atlas", text: "Chose a phased rollout", source: "I chose a phased rollout" },
  ];
  const result = deduplicateLiveProposals(proposals, ["Improved onboarding"], ["Chose a phased rollout"]);
  assert.deepEqual(result.candidates.map((item) => item.text), ["Interviewed support agents", "Mapped escalation paths"]);
  assert.deepEqual([result.alreadyApproved, result.alreadyPending, result.repeatedInExtraction], [1, 1, 1]);
});

test("a failed extraction chunk cannot return a partial proposal batch", async () => {
  const transcript = "A ".repeat(LIVE_EXTRACTION_CHARS);
  let calls = 0;
  await assert.rejects(extractLiveEvidenceProposals(transcript, async () => {
    if (++calls === 2) throw new Error("Temporary service failure");
    return [{ title: "Project", text: "Approved only after review", source: "Approved only after review" }];
  }), /Temporary service failure/);
  assert.equal(calls, 2);
});
