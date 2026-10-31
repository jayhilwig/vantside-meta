import { z } from "zod";

export const requirementSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.enum(["responsibility", "required", "preferred", "domain"]),
  text: z.string().trim().min(5).max(220),
  sourceExcerpt: z.string().trim().min(5).max(300),
}).strict();

export const opportunityAnalysisSchema = z.object({
  company: z.string().trim().max(100),
  role: z.string().trim().max(100),
  seniority: z.string().trim().min(2).max(80).optional(),
  confidence: z.enum(["clear", "uncertain"]),
  requirements: z.array(requirementSchema).max(12),
}).strict();

export type OpportunityAnalysis = z.infer<typeof opportunityAnalysisSchema>;
export type OpportunityRequirement = z.infer<typeof requirementSchema>;

export function assessOpportunityEvidence(analysis: OpportunityAnalysis, facts: ReadonlyArray<{ id: string; text: string }>,
  alignment: ReturnType<typeof alignCareerFacts>) {
  const generic = new Set(["work", "team", "role", "skills", "experience", "required", "preferred", "strong", "design", "product", "using", "across"]);
  const terms = (text: string) => new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !generic.has(word)));
  return analysis.requirements.map((requirement) => {
    const strong = alignment.strengths.find((item) => item.requirementId === requirement.id);
    if (strong && facts.some((fact) => fact.id === strong.factId)) return { requirement, level: "strong" as const, factId: strong.factId };
    const words = terms(requirement.text);
    const partial = facts.find((fact) => [...words].some((word) => terms(fact.text).has(word)));
    return { requirement, level: partial ? "partial" as const : "none" as const, factId: partial?.id };
  });
}

export function careerMemoryCoverage(analysis: OpportunityAnalysis, approvedFacts: ReadonlyArray<{ id: string; text: string }>,
  alignment: ReturnType<typeof alignCareerFacts> | null) {
  const seen = new Set<string>();
  const requirements = analysis.requirements.filter((item) => {
    const key = item.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (!alignment || !requirements.length) return { percentage: null, supported: 0, total: requirements.length, strengths: [], areas: [] };
  const assessed = assessOpportunityEvidence({ ...analysis, requirements }, approvedFacts, alignment);
  const strengths = assessed.filter((item) => item.level === "strong");
  return { percentage: Math.round(strengths.length / requirements.length * 100), supported: strengths.length,
    total: requirements.length, strengths, areas: assessed.filter((item) => item.level !== "strong") };
}

export function alignCareerFacts(analysis: OpportunityAnalysis, facts: ReadonlyArray<{ id: string; text: string }>) {
  // Require at least two meaningful terms; a shared generic word is not evidence of a match.
  const stop = new Set(["with", "from", "that", "this", "their", "your", "work", "team", "experience", "skills", "ability", "strong", "required", "preferred"]);
  const words = (value: string) => new Set((value.toLowerCase().match(/[a-z]{3,}/g) ?? [])
    .map((word) => word.replace(/(ing|ed|s)$/, "")).filter((word) => word.length >= 3 && !stop.has(word)));
  const strengths = analysis.requirements.flatMap((requirement) => {
    const terms = words(requirement.text);
    const matched = facts.map((fact) => ({ fact, overlap: [...terms].filter((word) => words(fact.text).has(word)).length }))
      .sort((a, b) => b.overlap - a.overlap).find((candidate) => candidate.overlap >= 2)?.fact;
    return matched ? [{ requirementId: requirement.id, factId: matched.id }] : [];
  });
  const supported = new Set(strengths.map((item) => item.requirementId));
  return { strengths, needsEvidence: analysis.requirements.filter((item) => !supported.has(item.id)).map((item) => item.id) };
}
