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
