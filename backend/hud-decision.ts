import { z } from "zod";
import { retrievalInputSchema, retrieveApprovedMemory } from "./memory-retrieval";
import { decideWithJev } from "./jev-decision";

const inputSchema = retrievalInputSchema.extend({
  question: z.string().trim().max(500),
  conversationContext: z.string().trim().max(500).optional(),
  recentFactIds: z.array(z.string().min(1).max(80)).max(10).optional(),
}).strict();

// Invoked by the future practice conversation event path, separately from audio capture.
export async function decideHudCue(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = inputSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Provide a practice question and approved Career Memory." } };
  const { conversationContext, recentFactIds, ...retrieval } = input.data;
  if (retrieval.question.length < 4) return { status: 200, body: { show: false, cues: [], reason: "no-match" } };
  const eligibleApprovedFacts = retrieval.projects.reduce((count, project) => count + project.facts.filter((fact) => fact.source.trim()).length, 0);
  const candidates = retrieveApprovedMemory(retrieval, 6);
  const freshCues = candidates.filter((cue) => !recentFactIds?.includes(cue.factId)).slice(0, 3);
  if (!freshCues.length) { console.info("Practice HUD", { stage: "decision", eligibleApprovedFacts, selectedFacts: 0,
    suppression: candidates.length ? "recent-facts" : "no-relevant-approved-fact" });
    return { status: 200, body: { show: false, cues: [], reason: "no-match" } }; }
  const decision = await decideWithJev(retrieval.question, conversationContext, fetcher, signal);
  console.info("Practice HUD", { stage: "decision", eligibleApprovedFacts, candidateFacts: candidates.length,
    selectedFacts: decision.show ? freshCues.length : 0, jev: decision.reason,
    suppression: decision.show ? "none" : "jev" });
  return { status: 200, body: { show: decision.show, cues: decision.show ? freshCues : [], reason: decision.reason } };
}
