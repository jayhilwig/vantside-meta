import { z } from "zod";
import { memoryProjectSchema } from "../src/lib/session-schema";
import { requirementSchema } from "../src/lib/opportunity-analysis";
import { memoryStateSchema, type MemoryState } from "./career-memory";

export const retrievalInputSchema = z.object({
  question: z.string().trim().min(4).max(500),
  projects: z.array(memoryProjectSchema).max(40),
  opportunity: z.object({
    company: z.string().trim().min(2).max(100),
    role: z.string().trim().min(2).max(100),
    requirements: z.array(requirementSchema).max(12).optional(),
    preparationQuestions: z.array(z.string().trim().min(10).max(250)).max(5).optional(),
  }).strict().optional(),
}).strict();

export type RetrievalInput = z.infer<typeof retrievalInputSchema>;
export type RetrievedCue = { projectId: string; projectTitle: string; factId: string; phrase: string; factText: string; source: string; score: number };

const ignored = new Set(["tell", "about", "time", "when", "your", "you", "what", "have", "done", "with", "that", "this", "from", "were", "would", "could", "interview", "project", "work", "experience", "example", "role", "company", "team", "past"]);
function terms(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? [])
    .map((word) => word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("ing") && word.length > 6 ? word.slice(0, -3) : word.endsWith("ed") && word.length > 5 ? word.slice(0, -2) : word.endsWith("s") && word.length > 5 ? word.slice(0, -1) : word)
    .filter((word) => !ignored.has(word)));
}

const restricted = /\b(write|solve|complete|implement)\b.{0,35}\b(code|algorithm|assessment|test)\b|\b(diagnose|treat)\b.{0,35}\b(patient|clinical case)\b|\b(answer|solve)\b.{0,35}\b(legal|clinical|licensing)\b.{0,25}\b(question|exam|assessment)\b/i;

export function retrieveApprovedMemory(input: RetrievalInput): RetrievedCue[] {
  const checked = retrievalInputSchema.parse(input);
  if (restricted.test(checked.question)) return [];
  const questionTerms = terms(checked.question);
  if (!questionTerms.size) return [];
  const context = checked.opportunity;
  const requirements = context?.requirements ?? [];
  const candidates = checked.projects.flatMap((project) => project.facts.map((fact) => {
    const factTerms = terms(`${project.title} ${fact.text}`);
    const direct = [...questionTerms].filter((word) => factTerms.has(word)).length;
    const requirementMatches = requirements.filter((requirement) =>
      [...questionTerms].some((word) => terms(requirement.text).has(word)) &&
      [...terms(requirement.text)].some((word) => factTerms.has(word))).length;
    const preparationMatches = (context?.preparationQuestions ?? []).filter((prompt) =>
      [...questionTerms].some((word) => terms(prompt).has(word)) &&
      [...terms(prompt)].some((word) => factTerms.has(word))).length;
    // Opportunity context can order a direct match; it cannot create one.
    const score = direct * 3 + (direct ? Math.min(requirementMatches + preparationMatches, 2) : 0);
    return { projectId: project.projectId, projectTitle: project.title, factId: fact.id,
      phrase: fact.text.length <= 96 ? fact.text : `${fact.text.slice(0, 93).replace(/\s+\S*$/, "")}…`,
      factText: fact.text, source: fact.source, score };
  })).filter((item) => item.score >= 3 && item.source.trim().length >= 3);
  return candidates.sort((a, b) => b.score - a.score || a.projectId.localeCompare(b.projectId) || a.factId.localeCompare(b.factId)).slice(0, 3);
}

export function retrieveCues(body: unknown) {
  const parsed = retrievalInputSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "Provide a simulated practice question and approved Career Memory." } };
  const cues = retrieveApprovedMemory(parsed.data);
  return { status: 200, body: { cues, match: cues.length ? "verified" : "none" } };
}

export function retrieveFromCareerMemory(state: MemoryState, question: string, opportunityId?: string): RetrievedCue[] {
  const checked = memoryStateSchema.parse(state);
  const sourceText = new Map(checked.career.sources.map((source) => [source.id, source.excerpt]));
  const projects = checked.career.projects.map((project) => ({ projectId: project.id, title: project.title,
    facts: checked.career.facts.filter((fact) => fact.projectId === project.id).flatMap((fact) => {
      const source = fact.sourceIds.map((id) => sourceText.get(id)).find(Boolean);
      return source ? [{ id: fact.id, text: fact.text, source }] : [];
    }) })).filter((project) => project.facts.length);
  const opportunity = checked.opportunities.find((item) => item.id === opportunityId);
  return retrieveApprovedMemory({ question, projects, opportunity: opportunity ? {
    company: opportunity.company, role: opportunity.role, requirements: opportunity.requirements,
    preparationQuestions: opportunity.preparationQuestions,
  } : undefined });
}
