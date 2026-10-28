import { addEvidence, addProposal, approveProposal, deleteMaterial, deleteOpportunity,
  memoryStateSchema, type MemoryState } from "../../backend/career-memory";
import type { CareerProfile, MemoryProject, Opportunity } from "./session-schema";

export type ResumeReview = { profile: CareerProfile; projects: MemoryProject[] };
export type PendingInterviewFact = { id: string; title: string; text: string; source: string; sessionId: string; answer?: string };

export const newMemoryId = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

export function approvedProjects(state: MemoryState): MemoryProject[] {
  const sources = new Map(state.career.sources.map((source) => [source.id, source.excerpt]));
  return state.career.projects.map((project) => ({
    projectId: project.id, title: project.title,
    facts: state.career.facts.filter((fact) => fact.projectId === project.id).map((fact) => ({
      id: fact.id, text: fact.text, source: sources.get(fact.sourceIds[0]) ?? "",
    })),
  })).filter((project) => project.facts.length > 0);
}

export function pendingInterviewFacts(state: MemoryState): PendingInterviewFact[] {
  const sources = new Map(state.career.sources.map((source) => [source.id, source.excerpt]));
  return state.proposals.map((proposal) => ({ id: proposal.id, title: proposal.projectTitle,
    text: proposal.text, source: sources.get(proposal.sourceIds[0]) ?? "", sessionId: proposal.originSessionId ?? "" }));
}

export function approveResumeReview(state: MemoryState, review: ResumeReview, filename: string, now: string): MemoryState {
  let next = state.career.materials.filter((material) => material.kind === "resume")
    .reduce((current, material) => deleteMaterial(current, material.id), state);
  next = { ...next, career: { ...next.career,
    projects: next.career.projects.filter((project) => next.career.facts.some((fact) => fact.projectId === project.id)) } };
  const materialId = newMemoryId("resume");
  const sources: MemoryState["career"]["sources"] = [];
  const facts: MemoryState["career"]["facts"] = [];
  const projects: MemoryState["career"]["projects"] = [];
  for (const project of review.projects) {
    const keptFacts = project.facts.filter((fact) => fact.text.trim().length >= 5 && fact.source.trim().length >= 5);
    if (!keptFacts.length || project.title.trim().length < 2) continue;
    projects.push({ id: project.projectId, title: project.title.trim() });
    for (const fact of keptFacts) {
      const sourceId = newMemoryId("quote");
      sources.push({ id: sourceId, kind: "resume", originId: materialId,
        label: `${filename.slice(0, 90)} excerpt`, excerpt: fact.source.trim(), capturedAt: now });
      facts.push({ id: fact.id, projectId: project.projectId, kind: "context", text: fact.text.trim(),
        sourceIds: [sourceId], approvedAt: now });
    }
  }
  if (!facts.length) throw new Error("Keep at least one reviewed fact with a source excerpt of five or more characters.");
  // PDF bytes are not retained. These model-proposed quotes have been shown to the user for review;
  // exact quote verification against PDF text needs a future local text-extraction path.
  return memoryStateSchema.parse({ ...next, career: { ...next.career,
    materials: [...next.career.materials, { id: materialId, kind: "resume", label: filename.slice(0, 120), addedAt: now }],
    sources: [...next.career.sources, ...sources], projects: [...next.career.projects, ...projects],
    facts: [...next.career.facts, ...facts], identity: { ...review.profile, sourceIds: sources.slice(0, 8).map((source) => source.id), approvedAt: now },
  } });
}

function ensureSession(state: MemoryState, sessionId: string, now: string): MemoryState {
  if (state.sessions.some((session) => session.id === sessionId)) return state;
  return { ...state, sessions: [...state.sessions, { id: sessionId, status: "paused", startedAt: now }] };
}

export function retainPendingFact(state: MemoryState, pending: PendingInterviewFact, now: string): MemoryState {
  if (state.proposals.some((proposal) => proposal.id === pending.id)) {
    return memoryStateSchema.parse({ ...state, proposals: state.proposals.map((proposal) =>
      proposal.id === pending.id ? { ...proposal, text: pending.text.trim() } : proposal) });
  }
  if (!pending.sessionId) throw new Error("This memory proposal has no interview session.");
  let next = ensureSession(state, pending.sessionId, now);
  const sourceId = newMemoryId("quote");
  next = addEvidence(next, { id: sourceId, kind: "interview", originId: pending.sessionId,
    label: "Foundational interview answer", excerpt: pending.source.trim(), capturedAt: now }, pending.answer ?? pending.source);
  const existingProject = next.career.projects.find((project) => project.title.toLowerCase() === pending.title.trim().toLowerCase());
  next = addProposal(next, { id: pending.id, projectId: existingProject?.id ?? newMemoryId("project"), projectTitle: existingProject?.title ?? pending.title.trim(),
    kind: "accomplishment", text: pending.text.trim(), sourceIds: [sourceId],
    originSessionId: pending.sessionId, proposedAt: now });
  return next;
}

export function saveInterviewSession(state: MemoryState, sessionId: string, now: string, status: "paused" | "cancelled"): MemoryState {
  const withSession = ensureSession(state, sessionId, now);
  return memoryStateSchema.parse({ ...withSession, sessions: withSession.sessions.map((session) =>
    session.id === sessionId ? { ...session, status, ...(status === "cancelled" ? { endedAt: now } : {}) } : session) });
}

export function approveInterviewFact(state: MemoryState, pending: PendingInterviewFact, now: string): MemoryState {
  return approveProposal(retainPendingFact(state, pending, now), pending.id, now);
}

export function approveManualInterviewFact(state: MemoryState, title: string, quote: string, answer: string, sessionId: string, now: string): MemoryState {
  return approveInterviewFact(state, { id: newMemoryId("fact"), title, text: quote, source: quote, answer, sessionId }, now);
}

export function removeCareerProject(state: MemoryState, projectId: string): MemoryState {
  const facts = state.career.facts.filter((fact) => fact.projectId !== projectId);
  const stillUsedByFacts = new Set(facts.flatMap((fact) => fact.sourceIds));
  const identitySources = state.career.identity?.sourceIds.filter((id) => stillUsedByFacts.has(id)) ?? [];
  const identity = state.career.identity && identitySources.length ? { ...state.career.identity, sourceIds: identitySources } : null;
  const usedSources = new Set([...facts.flatMap((fact) => fact.sourceIds), ...state.proposals.flatMap((item) => item.sourceIds), ...identitySources]);
  const sources = state.career.sources.filter((source) => usedSources.has(source.id));
  const usedMaterials = new Set(sources.filter((source) => source.kind !== "interview").map((source) => source.originId));
  return memoryStateSchema.parse({ ...state, career: { ...state.career,
    identity,
    sources,
    materials: state.career.materials.filter((material) => usedMaterials.has(material.id)),
    projects: state.career.projects.filter((project) => project.id !== projectId),
    facts,
  } });
}

export function confirmOpportunity(state: MemoryState, opportunity: Opportunity, description: string, now: string): MemoryState {
  const company = opportunity.company.trim();
  const role = opportunity.role.trim();
  const existing = state.opportunities.find((item) => item.company === company && item.role === role && item.description === description.trim());
  if (existing) return state;
  return memoryStateSchema.parse({ ...state, opportunities: [...state.opportunities,
    { id: newMemoryId("job"), company, role, description: description.trim(), confirmedAt: now }] });
}

export function removeOpportunity(state: MemoryState, opportunityId: string): MemoryState {
  return deleteOpportunity(state, opportunityId);
}
