import { personalCueSchema } from "./cue-schema";
import { localApiHeaders } from "./local-api-auth";
import type { OpportunityRequirement } from "./opportunity-analysis";
import type { MemoryProject } from "./session-schema";
import { cueFingerprint, currentCueText, groundedCueText, sourceCueFallback, type PreparedHudCue } from "./prepared-hud-cues";
export { groundedCueText } from "./prepared-hud-cues";

export type HudFact = { factId: string; projectId: string; text: string };
export type HudOpportunity = { company: string; role: string; requirements?: OpportunityRequirement[]; preparationQuestions?: string[] };
export type HudResult = { question: string; cues: HudFact[]; reason: "shown" | "no-match" | "irrelevant" | "unavailable" };

export type HudPipelineStage = { stage: "approved" | "jev" | "eligible" | "prepared" | "meta"; count?: number; decision?: string };
type Input = { question: string; projects: MemoryProject[]; opportunity: HudOpportunity; recentFactIds: string[]; signal: AbortSignal;
  preparedCues?: Record<string, PreparedHudCue>; onStage?: (event: HudPipelineStage) => void };

export async function questionToHud(input: Input, fetcher: typeof fetch = fetch,
  baseUrl = process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787"): Promise<HudResult> {
  const question = input.question.trim().slice(0, 500);
  if (question.length < 4) return { question, cues: [], reason: "no-match" };
  const approvedCount = input.projects.reduce((count, project) => count + project.facts.filter((fact) => fact.source.trim()).length, 0);
  input.onStage?.({ stage: "approved", count: approvedCount });
  if (!approvedCount) return { question, cues: [], reason: "no-match" };
  // Round labels belong to the session UI; the strict cue endpoint accepts only opportunity memory.
  const opportunity: HudOpportunity = { company: input.opportunity.company, role: input.opportunity.role,
    requirements: input.opportunity.requirements, preparationQuestions: input.opportunity.preparationQuestions };
  const post = async (route: string, body: object) => {
    const headers = typeof window === "undefined" ? { "Content-Type": "application/json" } : await localApiHeaders();
    const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${route}`, {
      method: "POST", headers, body: JSON.stringify(body), signal: input.signal,
    });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error("Cue service is unavailable. Continue practicing or try the next question.");
    return result;
  };
  const decision = await post("/decide-hud-cue", { question, projects: input.projects,
    opportunity, recentFactIds: input.recentFactIds.slice(-10) }) as {
      show?: boolean; reason?: string; cues?: Array<{ factId?: string; projectId?: string }> };
  input.onStage?.({ stage: "jev", decision: decision?.show ? "show" : decision?.reason ?? "no cue" });
  if (!decision || !decision.show) return { question, cues: [], reason: decision?.reason === "unavailable" ? "unavailable" : decision?.reason === "irrelevant" ? "irrelevant" : "no-match" };

  const eligible = new Set((Array.isArray(decision.cues) ? decision.cues : []).slice(0, 3).flatMap((candidate) => {
    if (!candidate || typeof candidate.factId !== "string" || typeof candidate.projectId !== "string") return [];
    const project = input.projects.find((item) => item.projectId === candidate.projectId);
    return project?.facts.some((fact) => fact.id === candidate.factId && fact.source.trim()) &&
      !input.recentFactIds.includes(candidate.factId) ? [candidate.factId] : [];
  }));
  const selected = input.projects.map((project) => ({ ...project,
    facts: project.facts.filter((fact) => eligible.has(fact.id)) })).filter((project) => project.facts.length);
  input.onStage?.({ stage: "eligible", count: eligible.size });
  if (!selected.length) return { question, cues: [], reason: "no-match" };

  if (input.preparedCues) {
    const cues = await Promise.all((Array.isArray(decision.cues) ? decision.cues : []).slice(0, 3).flatMap((candidate) => {
      if (!candidate?.factId || !candidate.projectId || !eligible.has(candidate.factId)) return [];
      const project = selected.find((item) => item.projectId === candidate.projectId);
      const fact = project?.facts.find((item) => item.id === candidate.factId);
      return project && fact ? [{ project, fact }] : [];
    }).filter((item, index, items) => items.findIndex((other) => other.fact.id === item.fact.id) === index)
      .map(async ({ project, fact }) => {
        const approved = { factId: fact.id, projectId: project.projectId, sourceText: fact.text };
        const fingerprint = await cueFingerprint(approved);
        return { factId: fact.id, projectId: project.projectId,
          text: currentCueText(input.preparedCues?.[fact.id], approved, fingerprint) };
      }));
    input.onStage?.({ stage: "prepared", count: cues.length });
    return { question, cues, reason: cues.length ? "shown" : "no-match" };
  }

  const result = await post("/cue", { question, projects: selected, opportunity }) as { cue?: unknown };
  const parsed = personalCueSchema(selected).safeParse(result.cue);
  if (!parsed.success) throw new Error("The cue could not be verified. Continue practicing or try another question.");
  input.onStage?.({ stage: "meta", decision: parsed.data.match });
  if (parsed.data.match === "none") return { question, cues: [], reason: "no-match" };
  const project = selected.find((item) => item.projectId === parsed.data.projectId);
  const citedFacts = [...new Set(parsed.data.sourceFactIds)].flatMap((factId) => project?.facts.filter((fact) => fact.id === factId) ?? []);
  const phrases = [...parsed.data.cuePhrases];
  const cues = citedFacts.slice(0, 3).map((fact) => {
    const index = phrases.findIndex((phrase) => groundedCueText(phrase, fact.text) &&
      citedFacts.filter((candidate) => groundedCueText(phrase, candidate.text)).length === 1);
    const text = index < 0 ? sourceCueFallback(fact.text) : phrases.splice(index, 1)[0];
    return { factId: fact.id, projectId: project!.projectId, text };
  });
  return { question, cues, reason: cues.length ? "shown" : "no-match" };
}
