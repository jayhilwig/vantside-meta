import assert from "node:assert/strict";
import test from "node:test";
import { deleteOpportunity, emptyMemoryState, memoryStateSchema } from "../../backend/career-memory";
import { saveRound } from "./interview-rounds";

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
