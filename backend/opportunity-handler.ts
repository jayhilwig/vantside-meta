import { z } from "zod";
import { askMeta } from "./meta-request";
import { opportunityAnalysisSchema, alignCareerFacts } from "../src/lib/opportunity-analysis";

const inputSchema = z.union([
  z.object({ text: z.string().trim().min(30).max(15000), careerFacts: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(4).max(400) }).strict()).max(20) }).strict(),
  z.object({ filename: z.string().trim().min(1).max(260).regex(/\.pdf$/i), data: z.string().min(20).max(5_400_000), careerFacts: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(4).max(400) }).strict()).max(20) }).strict(),
]);

export async function analyzeOpportunity(body: unknown, fetcher: typeof fetch = fetch) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "Paste a job description or choose a PDF under 4 MB." } };
  const input = parsed.data;
  let content: Parameters<typeof askMeta>[1];
  if ("text" in input) content = input.text;
  else {
    const bytes = Buffer.from(input.data, "base64");
    if (bytes.length > 4_000_000 || bytes.subarray(0, 5).toString() !== "%PDF-")
      return { status: 400, body: { error: "This file is not a valid PDF under 4 MB." } };
    content = [{ type: "text", text: "Analyze this job description. Quote short excerpts from the PDF for each requirement." },
      { type: "file", file: { filename: "job-description.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` } }];
  }
  const result = await askMeta("Return JSON only: {company,role,seniority?,confidence,requirements:[{id,kind,text,sourceExcerpt}]}. Kinds: responsibility, required, preferred, domain. Extract at most 12 concrete requirements from the supplied job description. Each sourceExcerpt must be a short verbatim quote from that description. Omit seniority unless explicitly supported. If company is absent, use empty string and uncertain confidence. Never fabricate employer, role, requirements or experience. Do not perform web research, score candidates or answer an assessment. Use unique lowercase hyphenated requirement IDs.", content, 1600, fetcher);
  if (result.error) return { status: 502, body: { error: result.error } };
  const analysis = opportunityAnalysisSchema.safeParse(result.data);
  if (!analysis.success) return { status: 502, body: { error: "The job description could not be read clearly. Try another PDF or paste the text." } };
  const requirements = analysis.data.requirements;
  if (new Set(requirements.map((item) => item.id)).size !== requirements.length ||
    ("text" in input && requirements.some((item) => !input.text.toLowerCase().includes(item.sourceExcerpt.toLowerCase()))))
    return { status: 502, body: { error: "Job requirements could not be verified against the supplied text." } };
  return { status: 200, body: { analysis: analysis.data, alignment: alignCareerFacts(analysis.data, input.careerFacts) } };
}
