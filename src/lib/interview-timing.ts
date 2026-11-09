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
export const MAX_INTERVIEW_SECONDS = 30 * 60;

export const interviewMilestones = [
  { seconds: 3 * 60, message: "✨ Nice work! Keep the stories coming." },
  { seconds: 10 * 60, message: "💪 Practice makes progress." },
  { seconds: 28 * 60, message: "⏳ Two minutes left. We'll wrap up at 30." },
] as const;

// Emit a milestone once as the clock crosses it, never throughout the remaining session.
export function crossedInterviewMilestone(previous: number, current: number): typeof interviewMilestones[number] | null {
  return interviewMilestones.find((milestone) => previous < milestone.seconds && current >= milestone.seconds) ?? null;
}
