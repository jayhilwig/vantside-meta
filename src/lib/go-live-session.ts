import type { HudSessionStatus } from "./hud-window";

export type GoLiveHudAction = "start" | "pause" | "resume" | "stop" | "close";
export type QuestionOutcome = "processing" | "cue" | "no-cue" | "no-match" | "unavailable" | "interrupted";
export type SessionQuestion = { id: number; question: string; outcome: QuestionOutcome };
const MAX_SESSION_QUESTIONS = 20;

export function canRunGoLiveHudAction(action: GoLiveHudAction, status: HudSessionStatus, startAllowed: boolean): boolean {
  if (action === "close") return true;
  if (action === "start") return status === "ready" && startAllowed;
  if (action === "pause") return status === "listening";
  if (action === "resume") return status === "paused";
  return status === "listening" || status === "paused" || status === "processing";
}

export async function dispatchGoLiveHudAction(action: GoLiveHudAction, status: HudSessionStatus, startAllowed: boolean,
  handlers: Record<GoLiveHudAction, () => void | Promise<void>>): Promise<boolean> {
  if (!canRunGoLiveHudAction(action, status, startAllowed)) return false;
  await handlers[action]();
  return true;
}

export function addSessionQuestion(items: SessionQuestion[], id: number, question: string): SessionQuestion[] {
  const trimmed = question.trim().slice(0, 500);
  if (!trimmed || items.some((item) => item.id === id)) return items;
  return [...items, { id, question: trimmed, outcome: "processing" as const }].slice(-MAX_SESSION_QUESTIONS);
}

export function settleSessionQuestion(items: SessionQuestion[], id: number, outcome: QuestionOutcome): SessionQuestion[] {
  return items.map((item) => item.id === id && item.outcome === "processing" ? { ...item, outcome } : item);
}

export function interruptSessionQuestions(items: SessionQuestion[]): SessionQuestion[] {
  return items.map((item) => item.outcome === "processing" ? { ...item, outcome: "interrupted" } : item);
}
