import { z } from "zod";
import { askMeta } from "./meta-request";
import { opportunitySchema, resumeInterviewProposalSchema } from "../src/lib/session-schema";

const pdfSchema = z.object({ filename: z.string().trim().min(1).max(120).regex(/\.pdf$/i), data: z.string().min(20).max(5_400_000) }).strict();
const opportunityInputSchema = z.union([
  z.object({ text: z.string().trim().min(30).max(15_000) }).strict(),
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
  const result = await askMeta("Return JSON only: {profile:{profession,seniority,careerSummary},projects:[{projectId,title,facts:[{id,text,source}]}]}. The profile must be supported by the resume; when exact seniority is unclear use a neutral description such as 'Not specified'. Use unique lowercase hyphenated IDs. Every fact source must be a brief verbatim excerpt from the PDF. Never invent accomplishments, numbers, roles or evidence. At most 5 projects, 5 facts each. This is a proposal requiring user review, not approved memory.", content, 1550, fetcher);
  if (result.error) return { status: 502, body: { error: result.error } };
  const parsed = resumeInterviewProposalSchema.safeParse(result.data);
  if (!parsed.success || !parsed.data.projects.length) return { status: 502, body: { error: "No reviewable career facts were found. Try another PDF." } };
  const ids = parsed.data.projects.flatMap((project) => [project.projectId, ...project.facts.map((fact) => fact.id)]);
  if (new Set(ids).size !== ids.length) return { status: 502, body: { error: "Meta returned duplicate fact IDs. Please try again." } };
  return { status: 200, body: { proposal: parsed.data } };
}

export async function extractOpportunity(body: unknown, fetcher: typeof fetch = fetch) {
  const input = opportunityInputSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Paste a job description or choose a PDF under 4 MB." } };
  const content = "text" in input.data ? input.data.text : pdfContent(input.data, "Identify the company and role stated in this job description. If the company is absent or ambiguous, set confidence to uncertain and company to an empty string.");
  if (!content) return { status: 400, body: { error: "This file is not a valid PDF under 4 MB." } };
  const result = await askMeta("Return JSON only: {company,role,confidence}. confidence is clear only when the company is explicitly named in the supplied job description; otherwise uncertain. Never infer a company or interviewer identity from generic wording. Do not perform web research.", content, 220, fetcher);
  if (result.error) return { status: 502, body: { error: result.error } };
  const parsed = opportunitySchema.safeParse(result.data);
  if (!parsed.success) return { status: 502, body: { error: "Meta returned an unreadable opportunity. Please try again." } };
  return { status: 200, body: { opportunity: parsed.data } };
}
