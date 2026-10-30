import { z } from "zod";
import { askMeta } from "./meta-request";

const inputSchema = z.object({ transcript: z.string().trim().min(10).max(24000) }).strict();
const proposalSchema = z.object({ title: z.string().trim().min(2).max(100), text: z.string().trim().min(5).max(300), source: z.string().trim().min(5).max(300) }).strict();
const outputSchema = z.object({ proposals: z.array(proposalSchema).max(16) }).strict();
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export async function proposeLiveMemory(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = inputSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "No reviewable spoken answer was captured." } };
  const result = await askMeta("Return JSON only: {proposals:[{title,text,source}]}. These are candidate Career Memory facts, never approved. Extract each distinct, concrete first-person fact supported by the user's spoken words: projects and responsibilities, decisions and methods, problems solved, collaboration or leadership, tools, constraints and tradeoffs, and explicitly stated outcomes. Several distinct facts may belong to one project. Prefer standalone specifics over broad summaries; do not pad sparse answers. source must be a brief verbatim excerpt of the user's words supporting the entire fact. Keep titles grounded in that excerpt. Never add unsupported outcomes, numbers, qualifications, or certainty. Ignore interviewer speech, hypotheticals, and restricted assessment answers. If there is no clear support, return an empty array.", input.data.transcript, 1800, fetcher, signal);
  if (result.error) return { status: 502, body: { error: `Memory proposals were not prepared. ${result.error} You can retry without repeating the interview.` } };
  const output = outputSchema.safeParse(result.data);
  if (!output.success) return { status: 502, body: { error: "The conversation ended, but its memory proposals need another review." } };
  const text = normalize(input.data.transcript);
  const seen = new Set<string>();
  const proposals = output.data.proposals.filter((proposal) => {
    const key = normalize(proposal.text);
    if (seen.has(key) || !text.includes(normalize(proposal.source)) ||
      !(proposal.text.match(/\d+(?:[.,]\d+)*/g) ?? []).every((number) => proposal.source.includes(number))) return false;
    seen.add(key); return true;
  });
  return { status: 200, body: { proposals } };
}
