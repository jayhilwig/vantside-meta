import { z } from "zod";
import { askMeta } from "./meta-request";
import { askBasetenOpportunity } from "./baseten-request";
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
  const instruction = "Return JSON only: {company,role,seniority?,confidence,requirements:[{id,kind,text,sourceExcerpt}]}. Kinds: responsibility, required, preferred, domain. Extract 1 to 12 concrete responsibilities, required qualifications or skills, preferred qualifications, and domain expectations actually stated in the job description. Each sourceExcerpt must be a short verbatim quote from that description. Omit seniority unless explicitly supported. If company or role is absent or ambiguous, use an empty string for that field and uncertain confidence; the user will correct it. Never fabricate employer, role, requirements or experience. Do not perform web research, score candidates or answer an assessment. Use unique lowercase hyphenated requirement IDs.";
  // Explicit opt-in applies to pasted text only; PDF remains on Meta's multimodal route.
  const result = typeof content === "string" && process.env.OPPORTUNITY_PROVIDER === "baseten" && process.env.BASETEN_API_KEY
    ? await askBasetenOpportunity(instruction, content, fetcher, 1600) : await askMeta(instruction, content, 1600, fetcher);
  if (result.error) return { status: 502, body: { error: result.error } };
  const analysis = opportunityAnalysisSchema.safeParse(result.data);
  if (!analysis.success) return { status: 502, body: { error: "The job description could not be read clearly. Try another PDF or paste the text." } };
  const requirements = analysis.data.requirements;
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!requirements.length || new Set(requirements.map((item) => item.id)).size !== requirements.length ||
    ("text" in input && requirements.some((item) => !normalize(input.text).includes(normalize(item.sourceExcerpt)))))
    return { status: 502, body: { error: "Job requirements could not be verified against the supplied text." } };
  const grounded = "text" in input ? {
    company: analysis.data.company && normalize(input.text).includes(normalize(analysis.data.company)) ? analysis.data.company : "",
    role: analysis.data.role && normalize(input.text).includes(normalize(analysis.data.role)) ? analysis.data.role : "",
    seniority: analysis.data.seniority && normalize(input.text).includes(normalize(analysis.data.seniority)) ? analysis.data.seniority : undefined,
  } : { company: analysis.data.company, role: analysis.data.role, seniority: analysis.data.seniority };
  const reviewed = { ...analysis.data, ...grounded, confidence: grounded.company && grounded.role ? analysis.data.confidence : "uncertain" as const };
  return { status: 200, body: { analysis: reviewed, alignment: alignCareerFacts(reviewed, input.careerFacts) } };
}
