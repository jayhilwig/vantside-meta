import assert from "node:assert/strict";
import test from "node:test";
import { advanceInterviewClock, emptyInterviewClock, interviewClockSeconds, interviewEncouragement, interviewTime } from "./interview-timing";

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

test("encouragement changes at optional 3, 10, and 30 minute milestones", () => {
  assert.equal(interviewEncouragement(179), "");
  assert.match(interviewEncouragement(180), /3 minutes/);
  assert.match(interviewEncouragement(600), /10 minutes/);
  assert.match(interviewEncouragement(1800), /30 minutes/);
});
