import assert from "node:assert/strict";
import test from "node:test";
import { deleteOpportunity, emptyMemoryState, memoryStateSchema } from "../../backend/career-memory";
import { deleteRound, savePracticeReview, saveRound } from "./interview-rounds";
import { retainPendingFact } from "./journey-memory";

test("rounds remain with their opportunities after reload and legacy records remain readable", () => {
  const state = emptyMemoryState();
  state.opportunities = [
    { id: "job-a", company: "Company A", role: "Designer", description: "Design customer experiences", confirmedAt: "2026-10-30T00:00:00.000Z" },
    { id: "job-b", company: "Company B", role: "Researcher", description: "Research customer experiences", confirmedAt: "2026-10-30T00:00:00.000Z" },
  ];
  state.rounds = [{ id: "legacy", opportunityId: "job-b", label: "First round", status: "planned" }];
  const first = saveRound(state, "job-a", "Hiring manager", "Alex", "planned");
  const edited = saveRound(first, "job-a", "Portfolio discussion", "Design lead", "completed", first.rounds.at(-1)!.id);
  const reopened = memoryStateSchema.parse(JSON.parse(JSON.stringify(edited)));
  assert.equal(reopened.rounds.find((round) => round.opportunityId === "job-a")?.label, "Portfolio discussion");
  assert.equal(reopened.rounds.find((round) => round.opportunityId === "job-a")?.interviewer, "Design lead");
  assert.equal(reopened.rounds.find((round) => round.opportunityId === "job-a")?.status, "completed");
  assert.equal(reopened.rounds.find((round) => round.opportunityId === "job-b")?.label, "First round");
  assert.deepEqual(deleteOpportunity(reopened, "job-a").rounds.map((round) => round.id), ["legacy"]);
  assert.equal(state.rounds.length, 1);
  assert.throws(() => saveRound(state, "missing", "Recruiter", "", "planned"));
});

test("sequential rounds, optional dates and interviewer references survive reload and deletion", () => {
  const state = emptyMemoryState();
  state.opportunities = [
    { id: "job-a", company: "Company A", role: "Designer", description: "Design", confirmedAt: "2026-10-30T00:00:00.000Z" },
    { id: "job-b", company: "Company B", role: "Researcher", description: "Research", confirmedAt: "2026-10-30T00:00:00.000Z" },
  ];
  const first = saveRound(state, "job-a", "Recruiter / HR", "", "planned", undefined, { interviewDate: "2026-11-03" });
  const second = saveRound(first, "job-a", "Hiring Manager", "", "planned", undefined, {
    interviewerLinkedInUrl: "https://www.linkedin.com/in/example/", interviewerPdf: { name: "profile.pdf", text: "Public profile text" },
  });
  const separate = saveRound(second, "job-b", "Team Member", "", "planned");
  assert.equal(separate.rounds.length, 3);
  const firstId = first.rounds[0].id;
  const edited = saveRound(separate, "job-a", "Panel Interview", "", "planned", firstId, { interviewDate: "2026-11-04" });
  const reopened = memoryStateSchema.parse(JSON.parse(JSON.stringify(edited)));
  assert.equal(reopened.rounds.find((item) => item.id === firstId)?.interviewDate, "2026-11-04");
  assert.equal(reopened.rounds.find((item) => item.label === "Hiring Manager")?.interviewerPdf?.text, "Public profile text");
  assert.equal(reopened.rounds.find((item) => item.label === "Hiring Manager")?.interviewerLinkedInUrl, "https://www.linkedin.com/in/example/");
  const removed = deleteRound(reopened, "job-a", firstId);
  assert.equal(removed.rounds.length, 2);
  assert.equal(removed.rounds.find((item) => item.opportunityId === "job-b")?.label, "Team Member");
  assert.throws(() => deleteRound(reopened, "job-b", firstId));
  assert.throws(() => saveRound(state, "job-a", "Recruiter / HR", "", "planned", undefined, { interviewerLinkedInUrl: "https://example.com/in/fake" }));
});

test("latest practice review persists only on its selected opportunity and round", () => {
  const state = emptyMemoryState();
  state.opportunities = [
    { id: "job-a", company: "Company A", role: "Designer", description: "Design", confirmedAt: "2026-10-30T00:00:00.000Z" },
    { id: "job-b", company: "Company B", role: "Designer", description: "Design", confirmedAt: "2026-10-30T00:00:00.000Z" },
  ];
  const first = saveRound(saveRound(state, "job-a", "Manager", "", "planned"), "job-b", "Team", "", "planned");
  const review = { topics: [{ text: "Discussed product direction", quote: "product direction" }], strengths: [], clarity: [], areas: [], competencies: [],
    proposals: [{ title: "Launch", text: "Led a launch", source: "I led a launch" }] };
  const saved = savePracticeReview(first, "job-a", first.rounds[0].id, review);
  const reopened = memoryStateSchema.parse(JSON.parse(JSON.stringify(saved)));
  assert.equal(reopened.rounds[0].practiceReview?.topics[0].text, "Discussed product direction");
  assert.deepEqual(reopened.rounds[0].practiceReview?.proposals, []);
  assert.equal(reopened.rounds[1].practiceReview, undefined);
  assert.throws(() => savePracticeReview(first, "job-b", first.rounds[0].id, review));
});

test("deleting a round removes only its pending practice facts and leaves other rounds", () => {
  const state = emptyMemoryState();
  state.opportunities = [{ id: "job-a", company: "Company A", role: "Designer", description: "Design", confirmedAt: "2026-10-30T00:00:00.000Z" }];
  const rounds = saveRound(saveRound(state, "job-a", "Manager", "", "planned"), "job-a", "Team", "", "planned");
  const pending = retainPendingFact(rounds, { id: "pending-a", title: "Launch", text: "Led product discovery", source: "Led product discovery",
    sessionId: "session-a", opportunityId: "job-a", roundId: rounds.rounds[0].id }, "2026-10-30T00:00:00.000Z");
  const removed = deleteRound(pending, "job-a", rounds.rounds[0].id);
  assert.equal(removed.proposals.length, 0);
  assert.deepEqual(removed.rounds.map((round) => round.label), ["Team"]);
  assert.equal(removed.career.sources.length, 0);
});
