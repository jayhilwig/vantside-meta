import { z } from "zod";

const responseSchema = z.object({
  answers: z.object({ show_cue: z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }) }),
});

export type JevDecision = { show: boolean; reason: "relevant" | "irrelevant" | "unavailable" };

// This service classifies a question; it never receives or generates Career Memory facts.
export async function decideWithJev(question: string, context = "", fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<JevDecision> {
  if (!question.trim() || !process.env.TYPESAFE_API_KEY) return { show: false, reason: "unavailable" };
  try {
    const response = await fetcher("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: { question: question.slice(0, 500), context: context.slice(0, 500) },
        questions: { show_cue: { type: "noul", instructions: "Is this a substantive practice interview question asking the candidate to recall their own professional experience, work, decisions, or outcomes? Say no for silence, small talk, unrelated discussion, or requests for an assessment solution." } } }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1800)]) : AbortSignal.timeout(1800),
    });
    if (!response.ok) return { show: false, reason: "unavailable" };
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return { show: false, reason: "unavailable" };
    return parsed.data.answers.show_cue.noul >= 0.7
      ? { show: true, reason: "relevant" } : { show: false, reason: "irrelevant" };
  } catch { return { show: false, reason: "unavailable" }; }
}
