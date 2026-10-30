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
  const freshCues = retrieveApprovedMemory(retrieval).filter((cue) => !recentFactIds?.includes(cue.factId));
  if (!freshCues.length) return { status: 200, body: { show: false, cues: [], reason: "no-match" } };
  const decision = await decideWithJev(retrieval.question, conversationContext, fetcher, signal);
  return { status: 200, body: { show: decision.show, cues: decision.show ? freshCues : [], reason: decision.reason } };
}
