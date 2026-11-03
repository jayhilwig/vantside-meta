import { z } from "zod";
import { validGeneratedCue } from "../src/lib/prepared-hud-cues";

const factSchema = z.object({
  factId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  projectId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  sourceText: z.string().trim().min(4).max(400),
}).strict();
const requestSchema = z.object({ facts: z.array(factSchema).min(1).max(12) }).strict();
const outputSchema = z.object({ cues: z.array(z.object({
  factId: factSchema.shape.factId,
  projectId: factSchema.shape.projectId,
  text: z.string().trim().min(1).max(200),
}).strict()).max(12) }).strict();

export async function prepareHudCues(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = requestSchema.safeParse(body);
  if (!input.success || new Set(input.data.facts.map((fact) => fact.factId)).size !== input.data.facts.length)
    return { status: 400, body: { error: "Provide a small batch of distinct approved facts." } };
  const key = process.env.MODEL_API_KEY;
  const base = process.env.META_API_BASE_URL;
  const model = process.env.META_MODEL;
  if (!key || !base || !model) return { status: 503, body: { error: "Cue preparation is unavailable. Approved fact excerpts remain available." } };
  const payload = {
    model, reasoning_effort: "minimal", max_completion_tokens: 1000,
    response_format: { type: "json_object" }, store: false,
    messages: [
      { role: "developer", content: "Prepare short visual reminders from approved Career Memory. Return one JSON object with cues: an array of {factId, projectId, text}. For each supplied fact, choose one naturally readable, contiguous excerpt of about 10–25 words when possible. Preserve exact names, numbers, outcomes, and negation. Do not paraphrase, combine facts, write answers, or add claims. Omit a fact if no suitable excerpt exists. Return only IDs from the supplied facts." },
      { role: "user", content: JSON.stringify(input.data.facts) },
    ],
  };
  let response: Response;
  try {
    response = await fetcher(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    });
  } catch {
    return { status: 502, body: { error: "Cue preparation could not reach Meta. Approved fact excerpts remain available." } };
  }
  if (!response.ok) return { status: 502, body: { error: "Cue preparation was unavailable. Approved fact excerpts remain available." } };
  const upstream = await response.json().catch(() => null);
  const content = upstream?.choices?.[0]?.message?.content;
  let parsed: unknown;
  try { parsed = typeof content === "string" ? JSON.parse(content) : null; } catch { parsed = null; }
  const output = outputSchema.safeParse(parsed);
  if (!output.success) return { status: 502, body: { error: "Cue preparation returned unreadable data. Approved fact excerpts remain available." } };
  const sources = new Map(input.data.facts.map((fact) => [fact.factId, fact]));
  const seen = new Set<string>();
  const cues = output.data.cues.filter((cue) => {
    const fact = sources.get(cue.factId);
    if (!fact || seen.has(cue.factId) || cue.projectId !== fact.projectId || !validGeneratedCue(cue.text, fact.sourceText)) return false;
    seen.add(cue.factId);
    return true;
  });
  return { status: 200, body: { cues } };
}
