import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOpportunity } from "./opportunity-handler";
import { alignCareerFacts, opportunityAnalysisSchema } from "../src/lib/opportunity-analysis";
import { approveResumeReview, confirmOpportunity, opportunityById, retainPendingFact } from "../src/lib/journey-memory";
import { deleteOpportunity, emptyMemoryState, memoryStateSchema } from "./career-memory";

function textPdf(text: string): string {
  const lines = text.match(/.{1,80}(?:\s|$)/g) ?? [text];
  const stream = `BT /F1 12 Tf 50 700 Td ${lines.map((line) => `(${line.trim().replace(/[()\\]/g, " ")}) Tj 0 -18 Td`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}

const analysis = { company: "Example", role: "Platform designer", confidence: "clear",
  seniority: "Senior", requirements: [
    { id: "api-design", kind: "required", text: "Design API platforms", sourceExcerpt: "Design API platforms" },
    { id: "research", kind: "preferred", text: "Conduct user research", sourceExcerpt: "Conduct user research" },
  ] } as const;

test("current pasted-JD route uses Baseten only when explicitly selected, without paid fallback", async () => {
  const previous = { provider: process.env.OPPORTUNITY_PROVIDER, key: process.env.BASETEN_API_KEY };
  process.env.OPPORTUNITY_PROVIDER = "baseten"; process.env.BASETEN_API_KEY = "mock-secret";
  try {
    const text = "Example needs a Senior Platform designer. Design API platforms and Conduct user research.";
    const result = await analyzeOpportunity({ text, careerFacts: [] }, async (url, init) => {
      assert.equal(url, "https://inference.baseten.co/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "meta-models/muse-spark-open");
      assert.equal(body.max_tokens, 1600);
      return Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] });
    });
    assert.equal(result.status, 200);
    let calls = 0;
    const failed = await analyzeOpportunity({ text, careerFacts: [] }, async () => { calls++; return new Response("", { status: 403 }); });
    assert.equal(failed.status, 502);
    assert.equal(calls, 1);
  } finally {
    if (previous.provider === undefined) delete process.env.OPPORTUNITY_PROVIDER; else process.env.OPPORTUNITY_PROVIDER = previous.provider;
    if (previous.key === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous.key;
  }
});

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
    assert.equal(bad.status, 422);
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});

test("text-based PDF JD extracts actual text, validates quotes, and permits retry", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  const provider = process.env.OPPORTUNITY_PROVIDER; const basetenKey = process.env.BASETEN_API_KEY;
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  process.env.OPPORTUNITY_PROVIDER = "baseten"; process.env.BASETEN_API_KEY = "mock-secret";
  try {
    const pdf = textPdf("Example needs a Senior Platform designer. Design API platforms and Conduct user research. The team builds digital products with engineers and product managers. Candidates collaborate across teams, present designs, learn from customer research, and improve software for global customers.");
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(url, "https://example.invalid/v1/chat/completions");
      const request = JSON.parse(String(init?.body));
      assert.equal(request.max_completion_tokens, 1600);
      assert.match(JSON.stringify(request.messages), /Design API platforms/);
      assert.doesNotMatch(JSON.stringify(request.messages), /data:application\/pdf;base64/);
      return Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] });
    };
    const result = await analyzeOpportunity({ filename: "job.pdf", data: pdf, careerFacts: [] }, fetcher);
    assert.equal(result.status, 200);
    const unavailable = await analyzeOpportunity({ filename: "job.pdf", data: pdf, careerFacts: [] }, async () => new Response("", { status: 503 }));
    assert.equal(unavailable.status, 502);
    const retried = await analyzeOpportunity({ filename: "job.pdf", data: pdf, careerFacts: [] }, fetcher);
    assert.equal(retried.status, 200);
    const ungrounded = await analyzeOpportunity({ filename: "job.pdf", data: pdf, careerFacts: [] },
      async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...analysis,
        requirements: [{ id: "invented", kind: "required", text: "Manage clinical trials", sourceExcerpt: "Manage clinical trials" }] }) } }] }));
    assert.equal(ungrounded.status, 422);
    const invalid = await analyzeOpportunity({ filename: "job.pdf", data: Buffer.from("not a PDF").toString("base64"), careerFacts: [] }, fetcher);
    assert.equal(invalid.status, 400);
  } finally {
    if (provider === undefined) delete process.env.OPPORTUNITY_PROVIDER; else process.env.OPPORTUNITY_PROVIDER = provider;
    if (basetenKey === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = basetenKey;
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

test("missing company and ambiguous role remain editable rather than being invented", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL, process.env.OPPORTUNITY_PROVIDER];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "mock"; delete process.env.OPPORTUNITY_PROVIDER;
  try {
    const text = "This opportunity involves Design API platforms and Conduct user research for multiple clients.";
    const response = { ...analysis, company: "Invented Company", role: "Invented Role", confidence: "clear" };
    const result = await analyzeOpportunity({ text, careerFacts: [] }, async () => Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }));
    assert.equal(result.status, 200);
    assert.deepEqual((result.body as { analysis: { company: string; role: string; confidence: string } }).analysis,
      { company: "", role: "", confidence: "uncertain", seniority: undefined, requirements: response.requirements });
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL", "OPPORTUNITY_PROVIDER"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});

test("HTTPS job URL content enters the same grounded opportunity pipeline", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL, process.env.OPPORTUNITY_PROVIDER];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "mock"; delete process.env.OPPORTUNITY_PROVIDER;
  const text = "Example needs a Senior Platform designer. Design API platforms and Conduct user research.";
  try {
    const result = await analyzeOpportunity({ url: "https://jobs.example.com/role", careerFacts: [] },
      async (_url, init) => { assert.match(String(init?.body), /Design API platforms/); return Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] }); },
      async () => ({ text, url: "https://jobs.example.com/role" }));
    assert.equal(result.status, 200);
    assert.equal((result.body as { sourceText: string }).sourceText, text);
    const inaccessible = await analyzeOpportunity({ url: "https://jobs.example.com/role", careerFacts: [] },
      async () => { throw new Error("Inference should not run"); }, async () => { throw new Error("This page needs sign-in. Paste the description instead."); });
    assert.equal(inaccessible.status, 422);
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL", "OPPORTUNITY_PROVIDER"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});

test("opportunity analysis accepts harmless response shape variations but still checks source quotes", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL, process.env.OPPORTUNITY_PROVIDER];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock"; delete process.env.OPPORTUNITY_PROVIDER;
  try {
    const text = "Example needs a Senior Platform designer. Design API platforms and Conduct user research.";
    const response = { analysis: { company: "Example", role: "Platform designer", requirements: [
      { kind: "required_skill", requirement: "Design API platforms", source_excerpt: "Design API platforms" },
      { kind: "preferred", text: "Conduct user research", quote: "Conduct user research" } ] } };
    const result = await analyzeOpportunity({ text, careerFacts: [] }, async () => Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }));
    assert.equal(result.status, 200);
    assert.deepEqual((result.body as { analysis: { requirements: Array<{ id: string }> } }).analysis.requirements.map((item) => item.id), ["requirement-1", "requirement-2"]);
    const invented = { analysis: { ...response.analysis, requirements: [{ kind: "required", text: "Lead clinical trials", quote: "Lead clinical trials" }] } };
    assert.equal((await analyzeOpportunity({ text, careerFacts: [] }, async () => Response.json({ choices: [{ message: { content: JSON.stringify(invented) } }] }))).status, 422);
  } finally { for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL", "OPPORTUNITY_PROVIDER"].entries()) {
    if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
  } }
});

test("malformed, empty, and ungrounded responses fail without saving; a retry can succeed", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL, process.env.OPPORTUNITY_PROVIDER];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "mock"; delete process.env.OPPORTUNITY_PROVIDER;
  try {
    const input = { text: "Example needs a Senior Platform designer. Design API platforms and Conduct user research.", careerFacts: [] };
    const incomplete = await analyzeOpportunity(input, async () => Response.json({ choices: [{ message: { content: JSON.stringify({ company: "Example" }) } }] }));
    assert.equal(incomplete.status, 502);
    const empty = await analyzeOpportunity(input, async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...analysis, requirements: [] }) } }] }));
    assert.equal(empty.status, 422);
    const failed = await analyzeOpportunity(input, async () => new Response("", { status: 503 }));
    assert.equal(failed.status, 502);
    const retry = await analyzeOpportunity(input, async () => Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] }));
    assert.equal(retry.status, 200);
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL", "OPPORTUNITY_PROVIDER"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});

test("confirmed opportunity reload retains requirement provenance and selects its own Step 4 context", () => {
  const career = approveResumeReview(emptyMemoryState(), { profile: { profession: "Designer", seniority: "Senior", careerSummary: "Designed API platforms in product teams." },
    projects: [{ projectId: "project-1", title: "Platform", facts: [{ id: "fact-1", text: "I designed API platforms", source: "I designed API platforms" }] }] }, "resume.pdf", "2026-10-28T12:00:00.000Z");
  const aligned = alignCareerFacts(opportunityAnalysisSchema.parse(analysis), career.career.facts);
  const first = confirmOpportunity(career, { company: "Example", role: "Platform designer", confidence: "clear" },
    "Example needs a Senior Platform designer. Design API platforms and Conduct user research.", "2026-10-28T12:00:00.000Z", opportunityAnalysisSchema.parse(analysis), aligned, "Pasted job description");
  const second = confirmOpportunity(first, { company: "Different", role: "Researcher", confidence: "clear" },
    "Different needs product research and user interviews.", "2026-10-28T12:00:00.000Z");
  const reopened = memoryStateSchema.parse(JSON.parse(JSON.stringify(second)));
  const selected = opportunityById(reopened, first.opportunities[0].id);
  assert.deepEqual(selected?.requirements, analysis.requirements);
  assert.deepEqual(selected?.alignment?.strengths, [{ requirementId: "api-design", factId: "fact-1" }]);
  assert.match(selected?.preparationQuestions?.[0] ?? "", /conduct user research/i);
  assert.equal(opportunityById(reopened, "missing"), undefined);
  assert.equal(reopened.career.facts.length, 1);
  assert.notEqual(selected?.id, reopened.opportunities.at(-1)?.id);
  const reselected = confirmOpportunity(reopened, { company: selected!.company, role: selected!.role, confidence: "clear" },
    selected!.description, "2026-10-28T12:00:00.000Z", opportunityAnalysisSchema.parse(analysis), aligned, "Pasted job description");
  assert.equal(reselected.opportunities.at(-1)?.id, selected?.id);
  assert.equal(memoryStateSchema.parse(JSON.parse(JSON.stringify(reselected))).opportunities.at(-1)?.id, selected?.id);
});

test("single generic overlap does not claim a career strength", () => {
  const parsed = opportunityAnalysisSchema.parse(analysis);
  const alignment = alignCareerFacts(parsed, [{ id: "fact-1", text: "I supported a product platform" }]);
  assert.equal(alignment.strengths.length, 0);
  assert.deepEqual(alignment.needsEvidence, ["api-design", "research"]);
});
