import assert from "node:assert/strict";
import test from "node:test";
import { deleteOpportunity, emptyMemoryState, memoryStateSchema } from "../../backend/career-memory";
import { deleteRound, saveRound } from "./interview-rounds";

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
