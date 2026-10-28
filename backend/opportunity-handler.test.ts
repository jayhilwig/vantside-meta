import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOpportunity } from "./opportunity-handler";
import { alignCareerFacts, opportunityAnalysisSchema } from "../src/lib/opportunity-analysis";
import { approveResumeReview, confirmOpportunity, retainPendingFact } from "../src/lib/journey-memory";
import { deleteOpportunity, emptyMemoryState } from "./career-memory";

const analysis = { company: "Example", role: "Platform designer", confidence: "clear",
  seniority: "Senior", requirements: [
    { id: "api-design", kind: "required", text: "Design API platforms", sourceExcerpt: "Design API platforms" },
    { id: "research", kind: "preferred", text: "Conduct user research", sourceExcerpt: "Conduct user research" },
  ] } as const;

test("pasted JD requirements retain quoted source and reject invented excerpts", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const text = "Example needs a Senior Platform designer. Design API platforms and Conduct user research.";
    const fetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] });
    const result = await analyzeOpportunity({ text, careerFacts: [{ id: "fact-1", text: "I designed API platforms" }] }, fetcher);
    assert.equal(result.status, 200);
    assert.deepEqual((result.body as { alignment: { strengths: unknown[]; needsEvidence: string[] } }).alignment.needsEvidence, ["research"]);
    const bad = await analyzeOpportunity({ text: "Example needs a Senior Platform designer with many skills.", careerFacts: [] }, fetcher);
    assert.equal(bad.status, 502);
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});

test("PDF JD uses actual file bytes, direct Meta, and preserves source label", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const pdf = Buffer.from("%PDF-1.4\nmock job description").toString("base64");
    const fetcher: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.max_completion_tokens, 1600);
      assert.match(JSON.stringify(request.messages), /data:application\/pdf;base64/);
      return Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] });
    };
    const result = await analyzeOpportunity({ filename: "job.pdf", data: pdf, careerFacts: [] }, fetcher);
    assert.equal(result.status, 200);
    const invalid = await analyzeOpportunity({ filename: "job.pdf", data: Buffer.from("not a PDF").toString("base64"), careerFacts: [] }, fetcher);
    assert.equal(invalid.status, 400);
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});

test("alignment distinguishes supported leads from missing evidence and stores targeted questions", () => {
  const parsed = opportunityAnalysisSchema.parse(analysis);
  const alignment = alignCareerFacts(parsed, [{ id: "fact-1", text: "I designed API platforms" }]);
  assert.deepEqual(alignment.strengths, [{ requirementId: "api-design", factId: "fact-1" }]);
  const career = approveResumeReview(emptyMemoryState(), { profile: { profession: "Designer", seniority: "Senior", careerSummary: "Designed API platforms in product teams." },
    projects: [{ projectId: "project-1", title: "Platform", facts: [{ id: "fact-1", text: "I designed API platforms", source: "I designed API platforms" }] }] }, "resume.pdf", "2026-10-28T12:00:00.000Z");
  const saved = confirmOpportunity(career, { company: "Example", role: "Platform designer", confidence: "clear" },
    "Example needs a Senior Platform designer. Design API platforms and Conduct user research.", "2026-10-28T12:00:00.000Z", parsed, alignment, "Pasted job description");
  assert.equal(saved.opportunities[0].requirements?.length, 2);
  assert.match(saved.opportunities[0].preparationQuestions?.[0] ?? "", /conduct user research/i);
  assert.equal(saved.career.facts.length, 1);
});

test("job-specific answer stays pending and is removed with its opportunity", () => {
  const job = confirmOpportunity(emptyMemoryState(), { company: "Example", role: "Designer", confidence: "clear" },
    "A role involving product design.", "2026-10-28T12:00:00.000Z");
  const withProposal = retainPendingFact(job, { id: "pending-1", title: "Platform", text: "I designed APIs",
    source: "I designed APIs", answer: "I designed APIs", sessionId: "session-1", opportunityId: job.opportunities[0].id },
    "2026-10-28T12:00:00.000Z");
  assert.equal(withProposal.proposals.length, 1);
  assert.equal(withProposal.career.facts.length, 0);
  const deleted = deleteOpportunity(withProposal, job.opportunities[0].id);
  assert.equal(deleted.proposals.length, 0);
  assert.equal(deleted.career.sources.length, 0);
});
