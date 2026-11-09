import assert from "node:assert/strict";
import test from "node:test";
import { advanceInterviewClock, crossedInterviewMilestone, emptyInterviewClock, interviewClockSeconds, interviewTime, MAX_INTERVIEW_SECONDS } from "./interview-timing";

test("interview timer pauses, resumes, and resets between sessions", () => {
  let clock = advanceInterviewClock(emptyInterviewClock(), "listening", 1000);
  clock = advanceInterviewClock(clock, "user-speaking", 2000);
  assert.deepEqual(interviewClockSeconds(clock, 5000), { elapsed: 4, speaking: 3 });
  clock = advanceInterviewClock(clock, "paused", 5000);
  assert.deepEqual(interviewClockSeconds(clock, 15000), { elapsed: 4, speaking: 3 });
  clock = advanceInterviewClock(clock, "listening", 15000);
  assert.deepEqual(interviewClockSeconds(clock, 17000), { elapsed: 6, speaking: 3 });
  assert.deepEqual(interviewClockSeconds(emptyInterviewClock(), 17000), { elapsed: 0, speaking: 0 });
  assert.equal(interviewTime(192), "3:12");
});

test("milestones fire only once when the active interview crosses a threshold", () => {
  assert.equal(MAX_INTERVIEW_SECONDS, 1800);
  assert.equal(crossedInterviewMilestone(0, 179), null);
  assert.match(crossedInterviewMilestone(179, 180)?.message ?? "", /Nice work/);
  assert.equal(crossedInterviewMilestone(180, 181), null);
  assert.match(crossedInterviewMilestone(599, 600)?.message ?? "", /Practice makes progress/);
  assert.equal(crossedInterviewMilestone(600, 600), null);
  assert.match(crossedInterviewMilestone(1679, 1680)?.message ?? "", /Two minutes left/);
  assert.equal(crossedInterviewMilestone(1680, 1800), null);
});
