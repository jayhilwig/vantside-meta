import { z } from "zod";
import { askMeta } from "./meta-request";
import { askBasetenOpportunity } from "./baseten-request";
import { opportunityAnalysisSchema, alignCareerFacts } from "../src/lib/opportunity-analysis";
import { extractJobPdfText, hasSourceQuote, sourceWords } from "./job-description-text";
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
    catch (cause) {
      console.warn("Job PDF extraction failed", { reason: cause instanceof Error ? cause.constructor.name : "unknown" });
      return { status: 422, body: { error: cause instanceof Error && cause.message.startsWith("We couldn't read enough") ? cause.message : "We couldn't read this PDF. Try another text-based PDF or paste the description." } };
    }
  }
  const mode = "filename" in input ? "pdf" : "url" in input ? "url" : "text";
  const provider = !("filename" in input) && process.env.OPPORTUNITY_PROVIDER === "baseten" && process.env.BASETEN_API_KEY ? "baseten" : "meta";
  const model = provider === "baseten" ? "meta-models/muse-spark-open" : process.env.META_MODEL ?? "unconfigured";
  console.info("Opportunity analysis input", { mode, characters: content.length, words: sourceWords(content).length, provider, model });
  const instruction = "Return JSON only: {company,role,seniority?,confidence,requirements:[{id,kind,text,sourceExcerpt}]}. Kinds: responsibility, required, preferred, domain. Extract 1 to 8 concrete responsibilities, required qualifications or skills, preferred qualifications, and domain expectations actually stated in the job description. Each sourceExcerpt must be a short verbatim quote from that description. Omit seniority unless explicitly supported. If company or role is absent or ambiguous, use an empty string for that field and uncertain confidence; the user will correct it. Never fabricate employer, role, requirements or experience. Do not perform web research, score candidates or answer an assessment. Use unique lowercase hyphenated requirement IDs.";
  // Preserve the existing direct-Meta PDF route; Baseten remains explicit for text/URL.
  let providerStatus: number | undefined;
  const observedFetch: typeof fetch = async (...args) => { const response = await fetcher(...args); providerStatus = response.status; return response; };
  const requestAnalysis = (prompt: string, limit: number) => {
    providerStatus = undefined;
    return provider === "baseten"
      ? askBasetenOpportunity(prompt, content, observedFetch, limit) : askMeta(prompt, content, limit, observedFetch);
  };
  let result = await requestAnalysis(instruction, 1600);
  console.info("Opportunity provider result", { provider, model, httpStatus: providerStatus ?? "no-response", parsed: !result.error, attempt: 1 });
  if (result.error) return { status: 502, body: { error: result.error } };
  const initial = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : null;
  const initialItem = initial?.analysis && typeof initial.analysis === "object" ? initial.analysis as Record<string, unknown> : initial;
  if (Array.isArray(initialItem?.requirements) && initialItem.requirements.length === 0) {
    console.warn("Opportunity provider returned zero requirements; retrying once", { mode, provider, characters: content.length, words: sourceWords(content).length });
    result = await requestAnalysis(`${instruction} The previous analysis returned an empty requirements array. Look again for explicit duties, tasks, skills, qualifications, or expectations in the supplied text, including concise role briefs without formal section headings. For every item, quote its exact source words. If none are actually stated, return an empty array.`, 1200);
    console.info("Opportunity provider result", { provider, model, httpStatus: providerStatus ?? "no-response", parsed: !result.error, attempt: 2 });
    if (result.error) return { status: 502, body: { error: result.error } };
  }
  const raw = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : null;
  const rawItem = raw?.analysis && typeof raw.analysis === "object" ? raw.analysis as Record<string, unknown> : raw;
  const rawRequirements = rawItem?.requirements;
  const normalized = normalizeOpportunityResponse(result.data);
  const normalizedRequirements = normalized && typeof normalized === "object" ? (normalized as Record<string, unknown>).requirements : undefined;
  console.info("Opportunity requirement shape", { mode, rawCount: Array.isArray(rawRequirements) ? rawRequirements.length : "missing-or-invalid",
    normalizedCount: Array.isArray(normalizedRequirements) ? normalizedRequirements.length : "missing-or-invalid" });
  const analysis = opportunityAnalysisSchema.safeParse(normalized);
  if (!analysis.success) {
    console.warn("Opportunity analysis schema mismatch", { mode, rejected: analysis.error.issues.length,
      reasons: analysis.error.issues.reduce<Record<string, number>>((counts, issue) => {
        const key = `${issue.path.join(".")}:${issue.code}`; counts[key] = (counts[key] ?? 0) + 1; return counts;
      }, {}) });
    return { status: 502, body: { error: "We couldn't organize this job description. Try again or use a clearer description." } };
  }
  const requirements = analysis.data.requirements;
  if (!requirements.length || new Set(requirements.map((item) => item.id)).size !== requirements.length) {
    console.warn("Opportunity analysis returned no usable requirements", { mode, count: requirements.length,
      reason: requirements.length ? "duplicate-ids" : "provider-returned-empty-array" });
    return { status: 422, body: { error: "The analysis returned no job requirements. Try pasting the description or another text-based PDF." } };
  }
  const ungroundedCount = requirements.filter((item) => !hasSourceQuote(content, item.sourceExcerpt)).length;
  if (ungroundedCount) {
    console.warn("Opportunity requirement validation rejected excerpts", { mode, reason: "source-quote-mismatch", count: ungroundedCount });
    return { status: 422, body: { error: "filename" in input ? "We couldn't analyze this PDF because some details could not be verified. Try again or paste the text." : "We couldn't verify some details in this description. Try again or paste the text." } };
  }
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
