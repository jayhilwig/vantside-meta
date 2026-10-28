import assert from "node:assert/strict";
import test from "node:test";
import { emptyMemoryState, memoryStateSchema } from "../../backend/career-memory";
import { approveInterviewFact, approveResumeReview, approvedProjects, confirmOpportunity,
  pendingInterviewFacts, removeCareerProject, removeOpportunity, removeResume, retainPendingFact, saveInterviewSession } from "./journey-memory";

test("removing a resume preserves independently supported interview facts", () => {
  let state = approveResumeReview(emptyMemoryState(), review, "resume.pdf", now);
  state = approveInterviewFact(state, { id: "interview-fact", title: "Interview project",
    text: "Led a design review", source: "Led a design review", answer: "I led a design review",
    sessionId: "session-1" }, now);
  const removed = removeResume(state);
  assert.equal(removed.career.materials.length, 0);
  assert.equal(removed.career.identity, null);
  assert.equal(approvedProjects(removed).length, 1);
  assert.equal(approvedProjects(removed)[0].facts[0].id, "interview-fact");
  assert.equal(removed.career.sources.some((source) => source.kind === "resume"), false);
});

const now = "2026-10-28T12:00:00.000Z";
const review = { profile: { profession: "Product designer", seniority: "Senior",
  careerSummary: "Led onboarding design and research for a product team." },
  projects: [{ projectId: "resume-project", title: "Onboarding", facts: [{ id: "resume-fact",
    text: "Led onboarding design", source: "Led onboarding design and research" }] }] };

test("approved resume round-trips through the versioned contract without PDF bytes", () => {
  const state = approveResumeReview(emptyMemoryState(), review, "resume.pdf", now);
  const reopened = memoryStateSchema.parse(JSON.parse(JSON.stringify(state)));
  assert.equal(reopened.career.identity?.profession, "Product designer");
  assert.equal(reopened.career.materials[0].label, "resume.pdf");
  assert.equal(approvedProjects(reopened)[0].facts[0].source, "Led onboarding design and research");
  assert.equal(JSON.stringify(reopened).includes("application/pdf"), false);
});

test("pending interview facts survive serialization, approval, correction-ready evidence, and deduplication", () => {
  const base = approveResumeReview(emptyMemoryState(), review, "resume.pdf", now);
  const pending = { id: "proposal-1", title: "Onboarding", text: "Worked with support on onboarding",
    source: "worked with support on onboarding", sessionId: "session-1",
    answer: "I worked with support on onboarding after speaking to customers." };
  const retained = retainPendingFact(base, pending, now);
  assert.equal(retained.career.facts.length, 1);
  assert.equal(retained.proposals.length, 1);
  const reopened = memoryStateSchema.parse(JSON.parse(JSON.stringify(retained)));
  assert.equal(pendingInterviewFacts(reopened)[0].answer, undefined);
  const approved = approveInterviewFact(reopened, pendingInterviewFacts(reopened)[0], now);
  assert.equal(approved.proposals.length, 0);
  assert.equal(approved.career.facts.length, 2);
  assert.equal(approved.career.facts[1].projectId, "resume-project");
  const repeated = { ...pending, id: "proposal-2", answer: pending.answer };
  const deduplicated = approveInterviewFact(approved, repeated, now);
  assert.equal(deduplicated.career.facts.length, 2);
  assert.equal(deduplicated.career.facts[1].sourceIds.length, 2);
});

test("opportunities and interview rounds stay isolated from global memory and deletion cascades", () => {
  let state = approveResumeReview(emptyMemoryState(), review, "resume.pdf", now);
  state = confirmOpportunity(state, { company: "Company A", role: "Designer", confidence: "clear" }, "Design an onboarding flow", now);
  state = confirmOpportunity(state, { company: "Company B", role: "Researcher", confidence: "clear" }, "Research customer needs", now);
  const firstId = state.opportunities[0].id;
  state.rounds.push({ id: "round-a", opportunityId: firstId, label: "First round", status: "planned" });
  const afterDelete = removeOpportunity(state, firstId);
  assert.equal(afterDelete.opportunities.length, 1);
  assert.equal(afterDelete.rounds.length, 0);
  assert.equal(afterDelete.career.facts.length, 1);
  const withoutProject = removeCareerProject(afterDelete, "resume-project");
  assert.equal(withoutProject.career.facts.length, 0);
  assert.equal(withoutProject.career.sources.length, 0);
  assert.equal(withoutProject.career.materials.length, 0);
  assert.equal(withoutProject.career.identity, null);
});

test("only explicitly reviewed summaries can be retained", () => {
  const saved = saveInterviewSession(emptyMemoryState(), "session-1", now, "paused");
  assert.equal(saved.sessions[0].reviewedSummary, undefined);
  assert.throws(() => memoryStateSchema.parse({ ...saved, sessions: [{ ...saved.sessions[0], reviewedSummary: "A raw unapproved summary" }] }));
});
