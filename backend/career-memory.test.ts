import assert from "node:assert/strict";
import test from "node:test";
import { addEvidence, addMaterial, addProposal, approveIdentity, approveProposal, correctFact, deleteEvidence, deleteFact,
  deleteMaterial, deleteOpportunity, deleteSession, dismissProposal, emptyMemoryState, memoryStateSchema, refreshOpportunityAlignment } from "./career-memory";

const time = "2026-10-27T12:00:00.000Z";
const session = { id: "session-1", status: "paused" as const, startedAt: time };
const source = { id: "quote-1", kind: "interview" as const, originId: session.id,
  label: "Foundational interview", excerpt: "I led the onboarding redesign", capturedAt: time };
const proposal = { id: "fact-1", projectId: "onboarding", projectTitle: "Onboarding redesign",
  kind: "role" as const, text: "Led the onboarding redesign", sourceIds: [source.id],
  originSessionId: session.id, proposedAt: time };

function withEvidence() {
  const state = emptyMemoryState();
  state.sessions.push(session);
  return addEvidence(state, source, "In my last role, I led the onboarding redesign after customer research.");
}

test("proposals stay pending until explicit approval and retain source provenance", () => {
  const pending = addProposal(withEvidence(), proposal);
  assert.equal(pending.career.facts.length, 0);
  assert.equal(pending.proposals.length, 1);
  const approved = approveProposal(pending, proposal.id, time);
  assert.equal(approved.proposals.length, 0);
  assert.deepEqual(approved.career.facts[0].sourceIds, [source.id]);
  assert.equal(approved.career.facts[0].approvedAt, time);
  assert.deepEqual(pending.career.facts, []);
});

test("dismissed proposals do not reappear after restart or erase shared approved evidence", () => {
  const approved = approveProposal(addProposal(withEvidence(), proposal), proposal.id, time);
  const pending = addProposal(approved, { ...proposal, id: "pending-2", text: "Led onboarding", sourceIds: [source.id] });
  const dismissed = dismissProposal(pending, "pending-2");
  const reopened = memoryStateSchema.parse(JSON.parse(JSON.stringify(dismissed)));
  assert.equal(reopened.proposals.length, 0);
  assert.equal(reopened.career.facts.length, 1);
  assert.deepEqual(reopened.career.facts[0].sourceIds, [source.id]);
  assert.equal(reopened.career.sources.length, 1);
});

test("unsupported numeric claims cannot be promoted or inserted by correction", () => {
  const pending = addProposal(withEvidence(), { ...proposal, text: "Raised conversion 40%" });
  assert.throws(() => approveProposal(pending, proposal.id, time), /Numerical claims/);
  assert.equal(pending.career.facts.length, 0);
  const approved = approveProposal(addProposal(withEvidence(), proposal), proposal.id, time);
  assert.throws(() => correctFact(approved, proposal.id, "Raised conversion 40%", [source.id], time), /Numerical claims/);
});

test("fact correction and deletion invalidate opportunity strength references", () => {
  const approved = approveProposal(addProposal(withEvidence(), proposal), proposal.id, time);
  const job = { id: "job-1", company: "Example", role: "Designer", description: "Design onboarding", confirmedAt: time,
    requirements: [{ id: "req-1", kind: "required" as const, text: "Design onboarding experiences", sourceExcerpt: "Design onboarding experiences" }],
    alignment: { strengths: [{ requirementId: "req-1", factId: proposal.id }], needsEvidence: [] } };
  const linked = memoryStateSchema.parse({ ...approved, opportunities: [job] });
  const corrected = correctFact(linked, proposal.id, "Led a customer-informed onboarding redesign", [source.id], time);
  assert.deepEqual(corrected.opportunities[0].alignment?.strengths, []);
  assert.deepEqual(corrected.opportunities[0].alignment?.needsEvidence, ["req-1"]);
  const restoredLegacy = refreshOpportunityAlignment(memoryStateSchema.parse(JSON.parse(JSON.stringify({ ...approved,
    career: { ...approved.career, facts: [] }, opportunities: [job] }))));
  assert.equal(restoredLegacy.opportunities[0].alignment?.strengths.length, 0);
  const deleted = deleteFact(linked, proposal.id);
  assert.equal(deleted.opportunities[0].alignment?.strengths.length, 0);
  assert.equal(deleted.career.sources.length, 0);
});

test("corrections need valid evidence and preserve original approval", () => {
  const approved = approveProposal(addProposal(withEvidence(), proposal), proposal.id, time);
  const corrected = correctFact(approved, proposal.id, "Led a customer-informed onboarding redesign", [source.id], "2026-10-27T13:00:00.000Z");
  assert.equal(corrected.career.facts[0].approvedAt, time);
  assert.equal(corrected.career.facts[0].correctedAt, "2026-10-27T13:00:00.000Z");
  assert.equal(approved.career.facts[0].text, proposal.text);
  assert.throws(() => correctFact(approved, proposal.id, "Unsupported claim", ["missing"], time));
});

test("approval deduplicates normalized facts within one project", () => {
  const secondSource = { ...source, id: "quote-2", excerpt: "customer research" };
  const evidence = addEvidence(withEvidence(), secondSource, "I led the onboarding redesign after customer research.");
  const first = approveProposal(addProposal(evidence, proposal), proposal.id, time);
  const duplicate = { ...proposal, id: "fact-2", text: "  led   the ONBOARDING redesign  ", sourceIds: [secondSource.id] };
  const result = approveProposal(addProposal(first, duplicate), duplicate.id, time);
  assert.equal(result.career.facts.length, 1);
  assert.deepEqual(result.career.facts[0].sourceIds, [source.id, secondSource.id]);
  assert.equal(result.proposals.length, 0);
  const withoutFirstQuote = deleteEvidence(result, source.id);
  assert.deepEqual(withoutFirstQuote.career.facts[0].sourceIds, [secondSource.id]);
});

test("source quotes, links, and interview origin are validated", () => {
  const state = emptyMemoryState();
  assert.throws(() => addEvidence(state, source, source.excerpt), /known session/);
  state.sessions.push(session);
  assert.throws(() => addEvidence(state, source, "Different answer"), /absent/);
  assert.throws(() => addProposal(withEvidence(), { ...proposal, sourceIds: ["unknown"] }));
  assert.throws(() => memoryStateSchema.parse({ ...withEvidence(), career: {
    ...withEvidence().career, facts: [{ id: "orphan", projectId: "missing", kind: "role", text: "Unverified work", sourceIds: ["unknown"], approvedAt: time }],
  } }));
});

test("resume identity and fact evidence require a known material and disappear when it is deleted", () => {
  const resumeSource = { id: "resume-quote", kind: "resume" as const, originId: "resume-1",
    label: "Resume project section", excerpt: "Led product design for onboarding", capturedAt: time };
  assert.throws(() => addEvidence(emptyMemoryState(), resumeSource, resumeSource.excerpt), /matching material/);
  let state = addMaterial(emptyMemoryState(), { id: "resume-1", kind: "resume", label: "Resume PDF", addedAt: time });
  state = addEvidence(state, resumeSource, "Led product design for onboarding and research.");
  const profile = { profession: "Product designer", seniority: "Senior", careerSummary: "Led product design for onboarding and research." };
  assert.throws(() => approveIdentity(state, profile, ["unknown"], time));
  state = approveIdentity(state, profile, [resumeSource.id], time);
  assert.equal(state.career.identity?.profession, "Product designer");
  state = deleteMaterial(state, "resume-1");
  assert.equal(state.career.identity, null);
  assert.equal(state.career.sources.length, 0);
  assert.equal(state.career.materials.length, 0);
});

test("repeat sessions can add global facts without mixing opportunity and round context", () => {
  const state = approveProposal(addProposal(withEvidence(), proposal), proposal.id, time);
  state.sessions.push({ id: "session-2", status: "completed", startedAt: time, endedAt: time,
    reviewedSummary: "Discussed a second project.", summaryApprovedAt: time });
  state.opportunities.push({ id: "job-a", company: "Company A", role: "Designer", description: "Design an onboarding flow", confirmedAt: time });
  state.opportunities.push({ id: "job-b", company: "Company B", role: "Researcher", description: "Research customer needs", confirmedAt: time });
  state.rounds.push({ id: "round-a", opportunityId: "job-a", label: "First round", status: "completed",
    reviewedSummary: "Practiced Company A questions.", summaryApprovedAt: time });
  const checked = memoryStateSchema.parse(state);
  assert.equal(checked.career.facts.length, 1);
  assert.equal(checked.rounds[0].opportunityId, "job-a");
  assert.equal(checked.opportunities[1].company, "Company B");
  assert.throws(() => memoryStateSchema.parse({ ...state, rounds: [{ ...state.rounds[0], opportunityId: "unknown" }] }));
  assert.throws(() => memoryStateSchema.parse({ ...state, sessions: [{ ...session, reviewedSummary: "Unapproved summary" }] }));
});

test("deletion removes dependent facts and proposals; opportunity deletion removes only its rounds", () => {
  let state = approveProposal(addProposal(withEvidence(), proposal), proposal.id, time);
  state = addProposal(state, { ...proposal, id: "fact-2", text: "Supported the onboarding redesign" });
  const withoutSource = deleteEvidence(state, source.id);
  assert.equal(withoutSource.career.facts.length, 0);
  assert.equal(withoutSource.proposals.length, 0);
  assert.equal(withoutSource.career.sources.length, 0);
  assert.equal(deleteFact(state, proposal.id).career.facts.length, 0);
  state.opportunities.push({ id: "job-a", company: "Company A", role: "Designer", description: "Design an onboarding flow", confirmedAt: time });
  state.opportunities.push({ id: "job-b", company: "Company B", role: "Researcher", description: "Research customer needs", confirmedAt: time });
  state.rounds.push({ id: "round-a", opportunityId: "job-a", label: "Round one", status: "planned" });
  state.rounds.push({ id: "round-b", opportunityId: "job-b", label: "Round one", status: "planned" });
  const remaining = deleteOpportunity(state, "job-a");
  assert.deepEqual(remaining.opportunities.map((item) => item.id), ["job-b"]);
  assert.deepEqual(remaining.rounds.map((item) => item.id), ["round-b"]);
  assert.equal(remaining.career.facts.length, 1);
  const withoutSession = deleteSession(remaining, session.id);
  assert.equal(withoutSession.sessions.length, 0);
  assert.equal(withoutSession.career.sources.length, 0);
  assert.equal(withoutSession.career.facts.length, 0);
});
