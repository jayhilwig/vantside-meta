import { memoryStateSchema, type MemoryState } from "../../backend/career-memory";
import { newMemoryId } from "./journey-memory";

export function saveRound(state: MemoryState, opportunityId: string, label: string, interviewer: string,
  status: "planned" | "completed", roundId?: string): MemoryState {
  if (!state.opportunities.some((item) => item.id === opportunityId)) throw new Error("Select a saved opportunity first.");
  const existing = roundId ? state.rounds.find((item) => item.id === roundId && item.opportunityId === opportunityId) : undefined;
  if (roundId && !existing) throw new Error("This interview round is no longer available.");
  const round = { ...existing, id: existing?.id ?? newMemoryId("round"), opportunityId, label: label.trim(),
    ...(interviewer.trim() ? { interviewer: interviewer.trim() } : { interviewer: undefined }), status,
    ...(status === "completed" ? { endedAt: existing?.endedAt ?? new Date().toISOString() } : { endedAt: undefined }) };
  return memoryStateSchema.parse({ ...state, rounds: [...state.rounds.filter((item) => item.id !== round.id), round] });
}
