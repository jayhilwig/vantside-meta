import { memoryStateSchema, type MemoryState } from "../../backend/career-memory";
import { newMemoryId } from "./journey-memory";

export function saveRound(state: MemoryState, opportunityId: string, label: string, interviewer: string,
  status: MemoryState["rounds"][number]["status"], roundId?: string,
  details: { interviewDate?: string; interviewerLinkedInUrl?: string; interviewerPdf?: { name: string; text: string } } = {}): MemoryState {
  if (!state.opportunities.some((item) => item.id === opportunityId)) throw new Error("Select a saved opportunity first.");
  const existing = roundId ? state.rounds.find((item) => item.id === roundId && item.opportunityId === opportunityId) : undefined;
  if (roundId && !existing) throw new Error("This interview round is no longer available.");
  if (details.interviewerLinkedInUrl) {
    let url: URL;
    try { url = new URL(details.interviewerLinkedInUrl.trim()); } catch { throw new Error("Enter a valid LinkedIn profile URL."); }
    if (url.protocol !== "https:" || !["linkedin.com", "www.linkedin.com"].includes(url.hostname) || !url.pathname.startsWith("/in/"))
      throw new Error("Enter a LinkedIn profile URL beginning with https://www.linkedin.com/in/.");
  }
  const round = { ...existing, id: existing?.id ?? newMemoryId("round"), opportunityId, label: label.trim(),
    ...(interviewer.trim() ? { interviewer: interviewer.trim() } : { interviewer: undefined }), status,
    interviewDate: details.interviewDate || undefined, interviewerLinkedInUrl: details.interviewerLinkedInUrl?.trim() || undefined,
    interviewerPdf: details.interviewerPdf,
    ...(status === "completed" ? { endedAt: existing?.endedAt ?? new Date().toISOString() } : { endedAt: existing?.endedAt }) };
  return memoryStateSchema.parse({ ...state, rounds: [...state.rounds.filter((item) => item.id !== round.id), round] });
}

export function deleteRound(state: MemoryState, opportunityId: string, roundId: string): MemoryState {
  if (!state.rounds.some((round) => round.id === roundId && round.opportunityId === opportunityId))
    throw new Error("This interview round is no longer available.");
  return memoryStateSchema.parse({ ...state, rounds: state.rounds.filter((round) => round.id !== roundId) });
}
