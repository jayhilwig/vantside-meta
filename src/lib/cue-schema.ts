import { z } from "zod";
import { careerExamples } from "@/lib/career-examples";

const projectIds = careerExamples.map((example) => example.projectId) as [string, ...string[]];
const factIds = careerExamples.flatMap((example) => example.facts.map((fact) => fact.id));

export const cueSchema = z
  .object({
    projectId: z.enum(projectIds).nullable(),
    headline: z.string().trim().min(1).max(72),
    cuePhrases: z.array(z.string().trim().min(1).max(72)).min(1).max(3),
    sourceFactIds: z.array(z.enum(factIds as [string, ...string[]])).max(3),
    match: z.enum(["verified", "none"]),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.match === "none" && (cue.projectId !== null || cue.sourceFactIds.length > 0)) {
      context.addIssue({ code: "custom", message: "No-match cues cannot cite a project or facts." });
    }
    if (cue.match === "none" && cue.headline !== "No verified memory match") {
      context.addIssue({ code: "custom", message: "No-match cues need the neutral headline." });
    }
    if (cue.match === "verified" && (!cue.projectId || cue.sourceFactIds.length === 0)) {
      context.addIssue({ code: "custom", message: "Matched cues need a project and source facts." });
    }
    if (cue.projectId) {
      const project = careerExamples.find((example) => example.projectId === cue.projectId);
      const validProjectFacts = new Set<string>(project?.facts.map((fact) => fact.id) ?? []);
      if (cue.sourceFactIds.some((factId) => !validProjectFacts.has(factId))) {
        context.addIssue({ code: "custom", message: "Cited facts must belong to the selected project." });
      }
      const sourceText = project?.facts.filter((fact) => cue.sourceFactIds.includes(fact.id)).map((fact) => fact.text).join(" ") ?? "";
      const sourceNumbers = new Set(sourceText.match(/\d+(?:[.,]\d+)*/g) ?? []);
      const cueNumbers = `${cue.headline} ${cue.cuePhrases.join(" ")}`.match(/\d+(?:[.,]\d+)*/g) ?? [];
      if (cueNumbers.some((number) => !sourceNumbers.has(number))) {
        context.addIssue({ code: "custom", message: "Numerical claims need cited evidence." });
      }
    }
  });

export type VisualCue = z.infer<typeof cueSchema>;
