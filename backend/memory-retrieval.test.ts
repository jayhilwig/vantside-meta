import assert from "node:assert/strict";
import test from "node:test";
import { retrieveApprovedMemory, retrieveCues, retrieveFromCareerMemory } from "./memory-retrieval";
import { createCue } from "./cue-handler";
import { approveResumeReview, approvedProjects, confirmOpportunity, removeCareerProject, retainPendingFact } from "../src/lib/journey-memory";
import { emptyMemoryState } from "./career-memory";

const projects = [
  { projectId: "platform", title: "Developer platform", facts: [
    { id: "api-flow", text: "Designed API platform onboarding flows for enterprise developers", source: "Designed API platform onboarding flows for enterprise developers" },
    { id: "api-docs", text: "Improved API documentation after developer interviews", source: "Improved API documentation after developer interviews" },
  ] },
  { projectId: "research", title: "Healthcare research", facts: [
    { id: "clinicians", text: "Led usability research with hospital clinicians", source: "Led usability research with hospital clinicians" },
  ] },
  { projectId: "billing", title: "Billing", facts: [
    { id: "support", text: "Reduced support tickets by 20% after redesigning billing flow", source: "Reduced support tickets by 20% after redesigning billing flow" },
  ] },
];
const opportunity = { company: "Example", role: "Platform designer", requirements: [
  { id: "api-platform", kind: "required" as const, text: "Design API platform experiences", sourceExcerpt: "Design API platform experiences" } ],
  preparationQuestions: ["How have you designed API platform onboarding for developers?"] };

test("realistic practice questions retrieve only relevant approved facts with provenance", () => {
  const cues = retrieveApprovedMemory({ question: "Tell me about your API platform design work", projects, opportunity });
  assert.ok(cues.length > 0 && cues.length <= 3);
  assert.equal(cues[0].factId, "api-flow");
  assert.equal(cues[0].source, projects[0].facts[0].source);
  assert.ok(cues.every((cue) => projects.some((project) => project.projectId === cue.projectId && project.facts.some((fact) => fact.id === cue.factId))));
  assert.ok(cues.every((cue) => cue.phrase.length <= 96));
  const clinical = retrieveApprovedMemory({ question: "Describe your research with hospital clinicians", projects });
  assert.equal(clinical[0].factId, "clinicians");
});

test("unrelated, empty, and restricted assessments return no cue", () => {
  assert.deepEqual(retrieveApprovedMemory({ question: "Tell me about payroll compliance", projects }), []);
  assert.deepEqual(retrieveApprovedMemory({ question: "Tell me about API design", projects: [] }), []);
  assert.deepEqual(retrieveApprovedMemory({ question: "Write code for an API algorithm assessment", projects }), []);
  assert.deepEqual(retrieveCues({ question: "Tell me about payroll compliance", projects }).body,
    { cues: [], match: "none" });
});

test("Career Memory entry point excludes pending proposals and uses the selected opportunity", () => {
  const time = "2026-10-28T12:00:00.000Z";
  let state = approveResumeReview(emptyMemoryState(), { profile: { profession: "Designer", seniority: "Senior",
    careerSummary: "Designed enterprise platform products." }, projects: [projects[0]] }, "resume.pdf", time);
  state = confirmOpportunity(state, { company: "Example", role: "Platform designer", confidence: "clear" },
    "Design API platform experiences for developers.", time, undefined, undefined);
  state = retainPendingFact(state, { id: "pending-only", title: "Payroll", text: "Built payroll systems",
    source: "Built payroll systems", answer: "Built payroll systems", sessionId: "session-1" }, time);
  assert.deepEqual(retrieveFromCareerMemory(state, "Tell me about payroll systems", state.opportunities[0].id), []);
  const cues = retrieveFromCareerMemory(state, "Tell me about API platform onboarding", state.opportunities[0].id);
  assert.equal(cues[0].factId, "api-flow");
});

test("deleted Career Memory never reaches the HUD cue path", async () => {
  const time = "2026-10-28T12:00:00.000Z";
  const approved = approveResumeReview(emptyMemoryState(), { profile: { profession: "Designer", seniority: "Senior",
    careerSummary: "Designed enterprise platform products." }, projects: [projects[0], projects[1]] }, "resume.pdf", time);
  const removed = removeCareerProject(approved, "platform");
  assert.deepEqual(retrieveFromCareerMemory(removed, "Tell me about API platform onboarding"), []);
  const result = await createCue({ question: "Tell me about API platform onboarding", projects: approvedProjects(removed), opportunity },
    async () => { throw new Error("Deleted data should not trigger model inference"); });
  assert.equal(result.status, 200);
  assert.equal((result.body as { cue: { match: string } }).cue.match, "none");
  assert.equal(removed.career.sources.some((source) => source.excerpt.includes("API platform")), false);
});

test("Meta cue request is limited to retrieved facts and does not call Meta for no match", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const noMatch = await createCue({ question: "Tell me about payroll compliance", projects, opportunity },
      async () => { throw new Error("Should not call Meta"); });
    assert.equal(noMatch.status, 200);
    assert.equal((noMatch.body as { cue: { match: string } }).cue.match, "none");
    const matched = await createCue({ question: "Tell me about your API platform design work", projects, opportunity },
      async (_url, init) => {
        const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages);
        assert.match(prompt, /api-flow/);
        assert.doesNotMatch(prompt, /clinicians/);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ projectId: "platform", headline: "API onboarding", cuePhrases: ["Developer flows"], sourceFactIds: ["api-flow"], match: "verified" }) } }] });
      });
    assert.equal(matched.status, 200);
    assert.deepEqual((matched.body as { cue: { sourceFactIds: string[] } }).cue.sourceFactIds, ["api-flow"]);
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});
