export type InterviewClock = { elapsedMs: number; runningSince: number; speechMs: number; speakingSince: number };

export const emptyInterviewClock = (): InterviewClock => ({ elapsedMs: 0, runningSince: 0, speechMs: 0, speakingSince: 0 });

export function advanceInterviewClock(clock: InterviewClock, status: string, now: number): InterviewClock {
  const next = { ...clock };
  const active = ["listening", "user-speaking", "speaking"].includes(status);
  if (status === "user-speaking" && !next.speakingSince) next.speakingSince = now;
  if (status !== "user-speaking" && next.speakingSince) { next.speechMs += now - next.speakingSince; next.speakingSince = 0; }
  if (active && !next.runningSince) next.runningSince = now;
  if (!active && next.runningSince) { next.elapsedMs += now - next.runningSince; next.runningSince = 0; }
  return next;
}

export function interviewClockSeconds(clock: InterviewClock, now: number) {
  return { elapsed: Math.floor((clock.elapsedMs + (clock.runningSince ? now - clock.runningSince : 0)) / 1000),
    speaking: Math.floor((clock.speechMs + (clock.speakingSince ? now - clock.speakingSince : 0)) / 1000) };
}

export const interviewTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const interviewEncouragement = (seconds: number) => seconds >= 1800 ? "30 minutes — your Career Memory may be richer for it."
  : seconds >= 600 ? "10 minutes — more detail can reveal richer Career Memory."
  : seconds >= 180 ? "3 minutes — keep sharing what you did and why." : "";
