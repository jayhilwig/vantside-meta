import { z } from "zod";

export const requirementSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.enum(["responsibility", "required", "preferred", "domain"]),
  text: z.string().trim().min(5).max(220),
  sourceExcerpt: z.string().trim().min(5).max(300),
}).strict();

export const opportunityAnalysisSchema = z.object({
  company: z.string().trim().max(100),
  role: z.string().trim().min(2).max(100),
  seniority: z.string().trim().min(2).max(80).optional(),
  confidence: z.enum(["clear", "uncertain"]),
  requirements: z.array(requirementSchema).max(12),
}).strict();

export type OpportunityAnalysis = z.infer<typeof opportunityAnalysisSchema>;
export type OpportunityRequirement = z.infer<typeof requirementSchema>;

export function alignCareerFacts(analysis: OpportunityAnalysis, facts: ReadonlyArray<{ id: string; text: string }>) {
  // A lexical match is a lead for review, never proof of qualification or a score.
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const stop = new Set(["with", "from", "that", "this", "their", "your", "work", "team", "experience", "skills", "ability"]);
  const strengths = analysis.requirements.flatMap((requirement) => {
    const terms = [...words(requirement.text)].filter((word) => !stop.has(word));
    const matched = facts.find((fact) => terms.some((word) => words(fact.text).has(word)));
    return matched ? [{ requirementId: requirement.id, factId: matched.id }] : [];
  });
  const supported = new Set(strengths.map((item) => item.requirementId));
  return { strengths, needsEvidence: analysis.requirements.filter((item) => !supported.has(item.id)).map((item) => item.id) };
}
