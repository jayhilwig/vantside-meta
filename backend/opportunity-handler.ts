import { z } from "zod";
import { askMeta } from "./meta-request";
import { askBasetenOpportunity } from "./baseten-request";
import { opportunityAnalysisSchema, alignCareerFacts } from "../src/lib/opportunity-analysis";
import { extractJobPdfText, hasSourceQuote } from "./job-description-text";
import { fetchJobPosting } from "./job-posting-url";

const inputSchema = z.union([
  z.object({ text: z.string().trim().min(30).max(15000), careerFacts: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(4).max(400) }).strict()).max(20) }).strict(),
  z.object({ filename: z.string().trim().min(1).max(260).regex(/\.pdf$/i), data: z.string().min(20).max(5_400_000), careerFacts: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(4).max(400) }).strict()).max(20) }).strict(),
  z.object({ url: z.url().max(2000), careerFacts: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(4).max(400) }).strict()).max(20) }).strict(),
]);

export async function analyzeOpportunity(body: unknown, fetcher: typeof fetch = fetch, readUrl = fetchJobPosting) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: body && typeof body === "object" && "url" in body ? "Enter a valid HTTPS job posting URL." : body && typeof body === "object" && "filename" in body ? "Choose a PDF under 4 MB." : "Paste at least 30 characters of the job description." } };
  const input = parsed.data;
  let content: string;
  if ("text" in input) content = input.text;
  else if ("url" in input) {
    try { content = (await readUrl(input.url)).text; }
    catch (cause) { return { status: 422, body: { error: cause instanceof Error ? cause.message : "This job page could not be read. Paste the description instead." } }; }
  }
  else {
    const bytes = Buffer.from(input.data, "base64");
    if (bytes.length > 4_000_000 || bytes.subarray(0, 5).toString() !== "%PDF-")
      return { status: 400, body: { error: "This file is not a valid PDF under 4 MB." } };
    try { content = await extractJobPdfText(bytes); }
    catch (cause) { return { status: 422, body: { error: cause instanceof Error && cause.message.startsWith("We couldn't read enough") ? cause.message : "We couldn't read this PDF. Try another text-based PDF or paste the description." } }; }
  }
  const instruction = "Return JSON only: {company,role,seniority?,confidence,requirements:[{id,kind,text,sourceExcerpt}]}. Kinds: responsibility, required, preferred, domain. Extract 1 to 8 concrete responsibilities, required qualifications or skills, preferred qualifications, and domain expectations actually stated in the job description. Each sourceExcerpt must be a short verbatim quote from that description. Omit seniority unless explicitly supported. If company or role is absent or ambiguous, use an empty string for that field and uncertain confidence; the user will correct it. Never fabricate employer, role, requirements or experience. Do not perform web research, score candidates or answer an assessment. Use unique lowercase hyphenated requirement IDs.";
  // Preserve the existing direct-Meta PDF route; Baseten remains explicit for text/URL.
  const result = !("filename" in input) && process.env.OPPORTUNITY_PROVIDER === "baseten" && process.env.BASETEN_API_KEY
    ? await askBasetenOpportunity(instruction, content, fetcher, 1600) : await askMeta(instruction, content, 1600, fetcher);
  if (result.error) return { status: 502, body: { error: result.error } };
  const normalized = normalizeOpportunityResponse(result.data);
  const analysis = opportunityAnalysisSchema.safeParse(normalized);
  if (!analysis.success) {
    console.warn("Opportunity analysis schema mismatch", { mode: "filename" in input ? "pdf" : "url" in input ? "url" : "text",
      issues: analysis.error.issues.slice(0, 6).map((issue) => ({ path: issue.path.join("."), code: issue.code })) });
    return { status: 502, body: { error: "We couldn't organize this job description. Try again or use a clearer description." } };
  }
  const requirements = analysis.data.requirements;
  if (!requirements.length || new Set(requirements.map((item) => item.id)).size !== requirements.length)
    return { status: 422, body: { error: "filename" in input ? "We couldn't analyze this PDF. Try another PDF or paste the text." : "We couldn't find clear job requirements. Try another description." } };
  if (requirements.some((item) => !hasSourceQuote(content, item.sourceExcerpt)))
    return { status: 422, body: { error: "filename" in input ? "We couldn't analyze this PDF because some details could not be verified. Try again or paste the text." : "We couldn't verify some details in this description. Try again or paste the text." } };
  const grounded = {
    company: analysis.data.company && hasSourceQuote(content, analysis.data.company) ? analysis.data.company : "",
    role: analysis.data.role && hasSourceQuote(content, analysis.data.role) ? analysis.data.role : "",
    seniority: analysis.data.seniority && hasSourceQuote(content, analysis.data.seniority) ? analysis.data.seniority : undefined,
  };
  const reviewed = { ...analysis.data, ...grounded, confidence: grounded.company && grounded.role ? analysis.data.confidence : "uncertain" as const };
  return { status: 200, body: { analysis: reviewed, alignment: alignCareerFacts(reviewed, input.careerFacts),
    ...("url" in input ? { sourceText: content, sourceUrl: input.url } : {}) } };
}

function normalizeOpportunityResponse(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const item = raw.analysis && typeof raw.analysis === "object" ? raw.analysis as Record<string, unknown> : raw;
  if (!Array.isArray(item.requirements)) return item;
  return {
    company: typeof item.company === "string" ? item.company : "",
    role: typeof item.role === "string" ? item.role : "",
    ...(typeof item.seniority === "string" && item.seniority.trim() ? { seniority: item.seniority } : {}),
    confidence: item.confidence === "clear" ? "clear" : "uncertain",
    requirements: item.requirements.map((entry, index) => {
      if (!entry || typeof entry !== "object") return entry;
      const requirement = entry as Record<string, unknown>;
      const kind = String(requirement.kind ?? "").toLowerCase();
      return { id: typeof requirement.id === "string" && /^[a-z0-9-]{1,40}$/.test(requirement.id) ? requirement.id : `requirement-${index + 1}`,
        kind: kind.includes("prefer") ? "preferred" : kind.includes("respons") ? "responsibility" : kind.includes("domain") ? "domain" : kind.includes("requir") ? "required" : kind,
        text: requirement.text ?? requirement.requirement,
        sourceExcerpt: requirement.sourceExcerpt ?? requirement.source_excerpt ?? requirement.quote };
    }),
  };
}
