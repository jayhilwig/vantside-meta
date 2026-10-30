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

test("encouragement changes at elapsed milestones without promising better memory", () => {
  assert.equal(interviewEncouragement(179), "");
  for (const mark of [180, 300, 420, 600]) assert.match(interviewEncouragement(mark), new RegExp(`${mark / 60} minutes in`));
});
