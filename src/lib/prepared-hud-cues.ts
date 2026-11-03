import type { MemoryProject } from "./session-schema";

export const HUD_CUE_VERSION = "1";
export type ApprovedHudFact = { factId: string; projectId: string; sourceText: string };
export type PreparedHudCue = ApprovedHudFact & { fingerprint: string; text: string };

export function approvedHudFacts(projects: MemoryProject[]): ApprovedHudFact[] {
  return projects.flatMap((project) => project.facts.filter((fact) => fact.source.trim()).map((fact) => ({
    factId: fact.id, projectId: project.projectId, sourceText: fact.text,
  })));
}

export async function cueFingerprint(fact: ApprovedHudFact): Promise<string> {
  const input = JSON.stringify([fact.factId, fact.projectId, fact.sourceText, HUD_CUE_VERSION]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalized(text: string): string { return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

/** Extractive validation keeps names, numbers, negation, and causal claims in the approved fact. */
export function groundedCueText(cue: string, sourceText: string): boolean {
  const phrase = normalized(cue);
  if (!phrase || (/\b(?:not|never|without|no)\b/i.test(sourceText) && !/\b(?:not|never|without|no)\b/i.test(cue))) return false;
  return sourceText.split(/[.!?;]+/).some((clause) => (` ${normalized(clause)} `).includes(` ${phrase} `));
}

export function validGeneratedCue(cue: string, sourceText: string): boolean {
  const text = cue.trim();
  const words = text.match(/\b[\p{L}\p{N}]+\b/gu) ?? [];
  return text.length <= 200 && words.length >= 3 && words.length <= 30 &&
    !/[;,:-]\s*$/.test(text) && groundedCueText(text, sourceText);
}

export function sourceCueFallback(sourceText: string): string {
  const text = sourceText.trim();
  const firstSentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  const words = (value: string) => value.trim().split(/\s+/).length;
  if (words(firstSentence) <= 25 && firstSentence.length <= 200) return firstSentence;
  const clause = firstSentence.split(/[,;]/, 1)[0].trim();
  return words(clause) >= 7 && words(clause) <= 25 && clause.length <= 180 ? clause : firstSentence;
}

export function validPreparedCue(cue: PreparedHudCue, fact: ApprovedHudFact, fingerprint: string): boolean {
  return cue.factId === fact.factId && cue.projectId === fact.projectId &&
    cue.sourceText === fact.sourceText && cue.fingerprint === fingerprint &&
    validGeneratedCue(cue.text, fact.sourceText);
}

export function currentCueText(cue: PreparedHudCue | undefined, fact: ApprovedHudFact, fingerprint: string): string {
  if (cue?.factId === fact.factId && cue.projectId === fact.projectId &&
    cue.sourceText === fact.sourceText && cue.fingerprint === fingerprint &&
    (validGeneratedCue(cue.text, fact.sourceText) || cue.text === sourceCueFallback(fact.sourceText))) return cue.text;
  return sourceCueFallback(fact.sourceText);
}
