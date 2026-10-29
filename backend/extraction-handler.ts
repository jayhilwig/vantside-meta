import { z } from "zod";
import { askMeta } from "./meta-request";
import { askBasetenOpportunity } from "./baseten-request";
import { opportunitySchema, resumeInterviewProposalSchema } from "../src/lib/session-schema";

const pdfSchema = z.object({ filename: z.string().trim().min(1).max(120).regex(/\.pdf$/i), data: z.string().min(20).max(5_400_000) }).strict();
const seniorityLevels = ["Principal", "Staff", "Senior", "Lead", "Director", "VP"];

function normalizedSeniority(value: string, source?: string): string {
  if (!source) return "Not specified";
  const levels = seniorityLevels.filter((level) => new RegExp(`\\b${level}\\b`, "i").test(source) && new RegExp(`\\b${level}\\b`, "i").test(value));
  return levels.length === 1 ? levels[0] : "Not specified";
}
const opportunityInputSchema = z.union([
  z.object({ text: z.string().trim().min(30).max(15_000), careerFacts: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(4).max(400) }).strict()).max(20).optional() }).strict(),
  pdfSchema,
]);

function pdfContent(input: z.infer<typeof pdfSchema>, prompt: string) {
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length > 4_000_000 || bytes.subarray(0, 5).toString() !== "%PDF-") return null;
  return [{ type: "text" as const, text: prompt },
    { type: "file" as const, file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` } }];
}

export async function extractResume(body: unknown, fetcher: typeof fetch = fetch) {
  const input = pdfSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Choose a PDF under 4 MB." } };
  const content = pdfContent(input.data, "Extract only projects or accomplishments explicitly supported by this resume. Return short factual statements and short verbatim evidence snippets in source. Omit anything uncertain.");
  if (!content) return { status: 400, body: { error: "This file is not a valid PDF under 4 MB." } };
  const result = await askMeta("Return JSON only: {profile:{profession,seniority,senioritySource?,careerSummary},projects:[{projectId,title,dates?,dateSource?,facts:[{id,text,source}]}]}. Infer seniority only from an explicit title; return a concise level such as Senior, Staff, Principal, Lead, Director, or VP, never a full title. Include the exact title as senioritySource. If multiple levels are present or unclear, use 'Not specified' for review. Otherwise use 'Not specified' and omit senioritySource. Include dates and their verbatim dateSource only when explicitly stated in the PDF; otherwise omit both. The profile must be supported by the resume. Use unique lowercase hyphenated IDs. Every fact source must be a brief verbatim excerpt from the PDF. Never invent accomplishments, numbers, roles or evidence. At most 5 projects, 5 facts each. This is a proposal requiring user review, not approved memory.", content, 1750, fetcher);
  if (result.error) return { status: 502, body: { error: result.error } };
  const parsed = resumeInterviewProposalSchema.safeParse(result.data);
  if (!parsed.success || !parsed.data.projects.length) return { status: 502, body: { error: "No reviewable career facts were found. Try another PDF." } };
  const ids = parsed.data.projects.flatMap((project) => [project.projectId, ...project.facts.map((fact) => fact.id)]);
  if (new Set(ids).size !== ids.length) return { status: 502, body: { error: "Meta returned duplicate fact IDs. Please try again." } };
  return { status: 200, body: { proposal: { ...parsed.data, profile: { ...parsed.data.profile,
    seniority: normalizedSeniority(parsed.data.profile.seniority, parsed.data.profile.senioritySource) } } } };
}

export async function extractOpportunity(body: unknown, fetcher: typeof fetch = fetch) {
  const input = opportunityInputSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Paste a job description or choose a PDF under 4 MB." } };
  const content = "text" in input.data ? input.data.text : pdfContent(input.data, "Identify the company and role stated in this job description. If the company is absent or ambiguous, set confidence to uncertain and company to an empty string.");
  if (!content) return { status: 400, body: { error: "This file is not a valid PDF under 4 MB." } };
  const facts = "careerFacts" in input.data ? input.data.careerFacts ?? [] : [];
  const instruction = `Return JSON only: {company,role,confidence,alignedFactIds?}. confidence is clear only when the company is explicitly named in the supplied job description; otherwise uncertain. Never infer a company or interviewer identity from generic wording. Do not perform web research. When approved career facts are supplied, alignedFactIds may contain only their listed IDs, at most three. Treat the job description as relevance context, never proof of a career accomplishment. APPROVED CAREER FACTS: ${JSON.stringify(facts)}`;
  // PDF uses the existing Meta multimodal path; Baseten is only selected for text.
  const result = process.env.OPPORTUNITY_PROVIDER === "baseten" && process.env.BASETEN_API_KEY && typeof content === "string"
    ? await askBasetenOpportunity(instruction, content, fetcher)
    : await askMeta(instruction, content, 220, fetcher);
  if (result.error) return { status: 502, body: { error: result.error } };
  const parsed = opportunitySchema.safeParse(result.data);
  if (!parsed.success) return { status: 502, body: { error: "Meta returned an unreadable opportunity. Please try again." } };
  if (parsed.data.alignedFactIds?.some((id) => !facts.some((fact) => fact.id === id)))
    return { status: 502, body: { error: "Opportunity alignment contained an unknown career fact." } };
  return { status: 200, body: { opportunity: parsed.data } };
}
