import { z } from "zod";
import { askMeta } from "./meta-request";

const inputSchema = z.object({ transcript: z.string().trim().min(10).max(24000) }).strict();
const proposalSchema = z.object({ title: z.string().trim().min(2).max(100), text: z.string().trim().min(5).max(300), source: z.string().trim().min(5).max(300) }).strict();
const outputSchema = z.object({ proposals: z.array(z.unknown()).max(32) }).strict();
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const instruction = "Return JSON only: {proposals:[{title,text,source}]}. These are candidate Career Memory facts, never approved. " +
  "Read the entire candidate-speech excerpt. Extract each distinct concrete fact from every project or role discussed: the person's contribution, design or technical decisions, research, collaboration, challenges, tradeoffs, explicitly stated measurable results, and lessons learned. " +
  "One project may support several separate facts. Do not collapse different actions or outcomes into one generic summary. Do not require any particular number of facts and do not pad sparse evidence. " +
  "For source, copy one short contiguous excerpt verbatim from the supplied candidate transcript that supports the whole fact. Preserve numbers in the form spoken in that excerpt; never convert a worded number into an unsupported digit. " +
  "Use a project or role title mentioned in the transcript, or a concise descriptive label. Never add unsupported outcomes, numbers, qualifications, or certainty. Ignore interviewer speech, hypotheticals, and restricted assessment answers. If no fact is clearly supported, return an empty array.";

export async function proposeLiveMemory(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = inputSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "No reviewable spoken answer was captured." } };
  const result = await askMeta(instruction, input.data.transcript, 3000, fetcher, signal);
  if (result.error) return { status: 502, body: { error: `Memory proposals were not prepared. ${result.error} You can retry without repeating the interview.` } };
  const output = outputSchema.safeParse(result.data);
  if (!output.success) {
    console.warn("Career Memory extraction", { stage: "validation", reason: "invalid-envelope" });
    return { status: 502, body: { error: "The conversation ended, but its memory proposals need another review." } };
  }
  const text = normalize(input.data.transcript);
  const seen = new Set<string>();
  const diagnostics = { modelCandidates: output.data.proposals.length, schemaRejected: 0, sourceRejected: 0,
    numberRejected: 0, duplicateRejected: 0, accepted: 0 };
  const proposals: z.infer<typeof proposalSchema>[] = [];
  for (const raw of output.data.proposals) {
    const parsed = proposalSchema.safeParse(raw);
    if (!parsed.success) { diagnostics.schemaRejected++; continue; }
    const proposal = parsed.data;
    const key = normalize(proposal.text);
    if (!text.includes(normalize(proposal.source))) { diagnostics.sourceRejected++; continue; }
    if (!(proposal.text.match(/\d+(?:[.,]\d+)*/g) ?? []).every((number) => proposal.source.includes(number))) {
      diagnostics.numberRejected++; continue;
    }
    if (seen.has(key)) { diagnostics.duplicateRejected++; continue; }
    seen.add(key); proposals.push(proposal);
  }
  diagnostics.accepted = proposals.length;
  console.info("Career Memory extraction", { stage: "validation", ...diagnostics });
  return { status: 200, body: { proposals, diagnostics } };
}
