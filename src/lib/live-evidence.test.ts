import assert from "node:assert/strict";
import test from "node:test";
import { extractLiveEvidenceProposals, LiveEvidenceBuffer, liveEvidenceChunks,
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

test("a failed extraction chunk cannot return a partial proposal batch", async () => {
  const transcript = "A ".repeat(LIVE_EXTRACTION_CHARS);
  let calls = 0;
  await assert.rejects(extractLiveEvidenceProposals(transcript, async () => {
    if (++calls === 2) throw new Error("Temporary service failure");
    return [{ title: "Project", text: "Approved only after review", source: "Approved only after review" }];
  }), /Temporary service failure/);
  assert.equal(calls, 2);
});
