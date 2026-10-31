import assert from "node:assert/strict";
import test from "node:test";
import { careerMemoryCoverage, type OpportunityAnalysis } from "./opportunity-analysis";

const requirement = (id: string, text: string) => ({ id, kind: "required" as const, text, sourceExcerpt: text });
const analysis: OpportunityAnalysis = { company: "Example", role: "Designer", confidence: "clear", requirements: [
  requirement("research", "Lead qualitative user research"), requirement("systems", "Build accessible design systems"),
] };
const facts = [{ id: "fact-research", text: "Led qualitative user research" }, { id: "fact-systems", text: "Built accessible design systems" }];
const alignment = { strengths: [{ requirementId: "research", factId: "fact-research" }, { requirementId: "systems", factId: "fact-systems" }], needsEvidence: [] };

test("coverage uses distinct requirements with approved linked facts", () => {
  assert.equal(careerMemoryCoverage(analysis, facts, alignment).percentage, 100);
  const partial = careerMemoryCoverage(analysis, facts.slice(0, 1), alignment);
  assert.deepEqual([partial.percentage, partial.supported, partial.total, partial.areas.length], [50, 1, 2, 1]);
  assert.deepEqual([careerMemoryCoverage(analysis, [], alignment).percentage, careerMemoryCoverage(analysis, [], alignment).supported], [0, 0]);
});

test("coverage has no percentage without assessable requirements or grounded alignment", () => {
  assert.equal(careerMemoryCoverage({ ...analysis, requirements: [] }, facts, alignment).percentage, null);
  assert.equal(careerMemoryCoverage(analysis, facts, null).percentage, null);
});

test("duplicate requirements and unapproved facts never inflate coverage", () => {
  const duplicate = { ...analysis, requirements: [...analysis.requirements, requirement("systems-copy", "Build accessible design systems!")] };
  const withUnapproved = { strengths: [...alignment.strengths, { requirementId: "systems-copy", factId: "pending-fact" }], needsEvidence: [] };
  const result = careerMemoryCoverage(duplicate, facts.slice(0, 1), withUnapproved);
  assert.deepEqual([result.percentage, result.supported, result.total], [50, 1, 2]);
});
