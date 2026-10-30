import { personalCueSchema } from "./cue-schema";
import type { OpportunityRequirement } from "./opportunity-analysis";
import type { MemoryProject } from "./session-schema";

export type HudFact = { factId: string; projectId: string; text: string };
export type HudOpportunity = { company: string; role: string; requirements?: OpportunityRequirement[]; preparationQuestions?: string[] };
export type HudResult = { question: string; cues: HudFact[]; reason: "shown" | "no-match" | "irrelevant" | "unavailable" };

type Input = { question: string; projects: MemoryProject[]; opportunity: HudOpportunity; recentFactIds: string[]; signal: AbortSignal };

export async function questionToHud(input: Input, fetcher: typeof fetch = fetch,
  baseUrl = process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787"): Promise<HudResult> {
  const question = input.question.trim().slice(0, 500);
  if (question.length < 4) return { question, cues: [], reason: "no-match" };
  const post = async (route: string, body: object) => {
    const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: input.signal,
    });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error("Cue service is unavailable. Continue practicing or try the next question.");
    return result;
  };
  const decision = await post("/decide-hud-cue", { question, projects: input.projects,
    opportunity: input.opportunity, recentFactIds: input.recentFactIds.slice(-10) }) as {
      show?: boolean; reason?: string; cues?: Array<{ factId?: string; projectId?: string }> };
  if (!decision || !decision.show) return { question, cues: [], reason: decision?.reason === "unavailable" ? "unavailable" : decision?.reason === "irrelevant" ? "irrelevant" : "no-match" };

  const eligible = new Set((Array.isArray(decision.cues) ? decision.cues : []).slice(0, 3).flatMap((candidate) => {
    if (!candidate || typeof candidate.factId !== "string" || typeof candidate.projectId !== "string") return [];
    const project = input.projects.find((item) => item.projectId === candidate.projectId);
    return project?.facts.some((fact) => fact.id === candidate.factId && fact.source.trim()) &&
      !input.recentFactIds.includes(candidate.factId) ? [candidate.factId] : [];
  }));
  const selected = input.projects.map((project) => ({ ...project,
    facts: project.facts.filter((fact) => eligible.has(fact.id)) })).filter((project) => project.facts.length);
  if (!selected.length) return { question, cues: [], reason: "no-match" };

  const result = await post("/cue", { question, projects: selected, opportunity: input.opportunity }) as { cue?: unknown };
  const parsed = personalCueSchema(selected).safeParse(result.cue);
  if (!parsed.success) throw new Error("The cue could not be verified. Continue practicing or try another question.");
  if (parsed.data.match === "none") return { question, cues: [], reason: "no-match" };
  const cues = parsed.data.sourceFactIds.flatMap((factId) => selected.flatMap((project) =>
    project.facts.filter((fact) => fact.id === factId && project.projectId === parsed.data.projectId)
      .map((fact) => ({ factId, projectId: project.projectId,
        text: fact.text.length <= 105 ? fact.text : `${fact.text.slice(0, 102).replace(/\s+\S*$/, "")}…` })))).slice(0, 3);
  return { question, cues, reason: cues.length ? "shown" : "no-match" };
}
