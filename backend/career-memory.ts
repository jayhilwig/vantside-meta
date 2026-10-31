import { z } from "zod";
import { careerProfileSchema } from "../src/lib/session-schema";

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const timestamp = z.iso.datetime();
const sourceIds = z.array(id).min(1).max(8).refine((ids) => new Set(ids).size === ids.length);

export const evidenceSourceSchema = z.object({
  id,
  kind: z.enum(["resume", "interview", "user_material"]),
  originId: id,
  label: z.string().trim().min(2).max(120),
  excerpt: z.string().trim().min(5).max(500),
  capturedAt: timestamp,
}).strict();

export const careerMaterialSchema = z.object({
  id,
  kind: z.enum(["resume", "user_material"]),
  label: z.string().trim().min(2).max(120),
  addedAt: timestamp,
}).strict();

export const professionalIdentitySchema = careerProfileSchema.extend({
  sourceIds,
  approvedAt: timestamp,
}).strict();

export const approvedCareerFactSchema = z.object({
  id,
  projectId: id,
  kind: z.enum(["role", "decision", "process", "outcome", "metric", "accomplishment", "context"]),
  text: z.string().trim().min(5).max(400),
  sourceIds,
  approvedAt: timestamp,
  correctedAt: timestamp.optional(),
}).strict();

export const careerProjectSchema = z.object({
  id,
  title: z.string().trim().min(2).max(100),
  dates: z.string().trim().min(4).max(60).optional(),
  dateSource: z.string().trim().min(4).max(180).optional(),
  organization: z.string().trim().min(2).max(100).optional(),
}).strict().refine((project) => Boolean(project.dates) === Boolean(project.dateSource));

export const careerMemorySchema = z.object({
  version: z.literal(1),
  identity: professionalIdentitySchema.nullable(),
  materials: z.array(careerMaterialSchema),
  sources: z.array(evidenceSourceSchema),
  projects: z.array(careerProjectSchema),
  facts: z.array(approvedCareerFactSchema),
}).strict();

// No raw audio, transcript, or automatic summary retention belongs in this record.
export const foundationalSessionSchema = z.object({
  id,
  status: z.enum(["active", "paused", "completed", "cancelled"]),
  startedAt: timestamp,
  endedAt: timestamp.optional(),
  reviewedSummary: z.string().trim().min(5).max(650).optional(),
  summaryApprovedAt: timestamp.optional(),
}).strict().refine((session) => Boolean(session.reviewedSummary) === Boolean(session.summaryApprovedAt),
  "A retained summary requires explicit review and approval.");

export const jobOpportunitySchema = z.object({
  id,
  company: z.string().trim().min(2).max(100),
  role: z.string().trim().min(2).max(100),
  description: z.string().trim().min(5).max(15000),
  confirmedAt: timestamp,
  seniority: z.string().trim().min(2).max(80).optional(),
  sourceLabel: z.string().trim().min(1).max(2000).optional(),
  brandLogoDataUrl: z.string().regex(/^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|webp);base64,[A-Za-z0-9+/=]+$/).max(110000).optional(),
  requirements: z.array(z.object({ id, kind: z.enum(["responsibility", "required", "preferred", "domain"]), text: z.string().trim().min(5).max(220), sourceExcerpt: z.string().trim().min(5).max(300) }).strict()).max(12).optional(),
  alignment: z.object({ strengths: z.array(z.object({ requirementId: id, factId: id }).strict()).max(12), needsEvidence: z.array(id).max(12) }).strict().optional(),
  preparationQuestions: z.array(z.string().trim().min(10).max(250)).max(5).optional(),
  knownInterviewers: z.array(z.object({ id, name: z.string().trim().min(2).max(100).optional(), profileUrl: z.url().max(500) }).strict()).max(10).optional(),
}).strict();

export const interviewRoundSchema = z.object({
  id,
  opportunityId: id,
  label: z.string().trim().min(2).max(100),
  interviewer: z.string().trim().min(2).max(100).optional(),
  status: z.enum(["planned", "active", "completed", "cancelled"]),
  startedAt: timestamp.optional(),
  endedAt: timestamp.optional(),
  reviewedSummary: z.string().trim().min(5).max(650).optional(),
  summaryApprovedAt: timestamp.optional(),
}).strict().refine((round) => Boolean(round.reviewedSummary) === Boolean(round.summaryApprovedAt),
  "A retained summary requires explicit review and approval.");

export const proposedMemoryUpdateSchema = z.object({
  id,
  projectId: id,
  projectTitle: z.string().trim().min(2).max(100),
  kind: approvedCareerFactSchema.shape.kind,
  text: approvedCareerFactSchema.shape.text,
  sourceIds,
  originSessionId: id.optional(),
  opportunityId: id.optional(),
  proposedAt: timestamp,
}).strict();

export const memoryStateSchema = z.object({
  career: careerMemorySchema,
  sessions: z.array(foundationalSessionSchema),
  opportunities: z.array(jobOpportunitySchema),
  rounds: z.array(interviewRoundSchema),
  proposals: z.array(proposedMemoryUpdateSchema),
}).strict().superRefine((state, ctx) => {
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", path: [path], message: "Duplicate IDs" });
  };
  for (const [key, items] of Object.entries({ materials: state.career.materials, sources: state.career.sources, projects: state.career.projects,
    facts: state.career.facts, sessions: state.sessions, opportunities: state.opportunities,
    rounds: state.rounds, proposals: state.proposals })) unique(items.map((item) => item.id), key);
  const sources = new Set(state.career.sources.map((source) => source.id));
  const materials = new Map(state.career.materials.map((material) => [material.id, material.kind]));
  const projects = new Set(state.career.projects.map((project) => project.id));
  const sessions = new Set(state.sessions.map((session) => session.id));
  const opportunities = new Set(state.opportunities.map((opportunity) => opportunity.id));
  const checkSources = (ids: string[], path: (string | number)[]) => {
    for (const sourceId of ids) if (!sources.has(sourceId)) ctx.addIssue({ code: "custom", path, message: `Unknown source ${sourceId}` });
  };
  if (state.career.identity) checkSources(state.career.identity.sourceIds, ["career", "identity", "sourceIds"]);
  state.career.facts.forEach((fact, index) => {
    if (!projects.has(fact.projectId)) ctx.addIssue({ code: "custom", path: ["career", "facts", index, "projectId"], message: "Unknown project" });
    checkSources(fact.sourceIds, ["career", "facts", index, "sourceIds"]);
  });
  state.career.sources.forEach((source, index) => {
    if (source.kind === "interview" && !sessions.has(source.originId))
      ctx.addIssue({ code: "custom", path: ["career", "sources", index, "originId"], message: "Unknown interview session" });
    if (source.kind !== "interview" && materials.get(source.originId) !== source.kind)
      ctx.addIssue({ code: "custom", path: ["career", "sources", index, "originId"], message: "Unknown or mismatched career material" });
  });
  state.proposals.forEach((proposal, index) => {
    checkSources(proposal.sourceIds, ["proposals", index, "sourceIds"]);
    if (proposal.originSessionId && !sessions.has(proposal.originSessionId))
      ctx.addIssue({ code: "custom", path: ["proposals", index, "originSessionId"], message: "Unknown interview session" });
    if (proposal.opportunityId && !opportunities.has(proposal.opportunityId))
      ctx.addIssue({ code: "custom", path: ["proposals", index, "opportunityId"], message: "Unknown opportunity" });
  });
  state.rounds.forEach((round, index) => {
    if (!opportunities.has(round.opportunityId))
      ctx.addIssue({ code: "custom", path: ["rounds", index, "opportunityId"], message: "Unknown opportunity" });
  });
});

export type MemoryState = z.infer<typeof memoryStateSchema>;
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type ProposedMemoryUpdate = z.infer<typeof proposedMemoryUpdateSchema>;
export type CareerMaterial = z.infer<typeof careerMaterialSchema>;

export function emptyMemoryState(): MemoryState {
  return { career: { version: 1, identity: null, materials: [], sources: [], projects: [], facts: [] },
    sessions: [], opportunities: [], rounds: [], proposals: [] };
}

function checked(state: MemoryState): MemoryState { return memoryStateSchema.parse(state); }
function normalize(text: string): string { return text.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function supportedNumbers(text: string, sourceIds: string[], state: MemoryState): boolean {
  const evidence = state.career.sources.filter((source) => sourceIds.includes(source.id)).map((source) => source.excerpt).join(" ");
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).every((number) => evidence.includes(number));
}

function detachFactAlignment(state: MemoryState, factId: string): MemoryState {
  return refreshOpportunityAlignment(checked({ ...state, opportunities: state.opportunities.map((opportunity) => {
    if (!opportunity.alignment) return opportunity;
    return { ...opportunity, alignment: { ...opportunity.alignment,
      strengths: opportunity.alignment.strengths.filter((item) => item.factId !== factId) } };
  }) }));
}

export function addMaterial(state: MemoryState, material: CareerMaterial): MemoryState {
  checked(state);
  const valid = careerMaterialSchema.parse(material);
  if (state.career.materials.some((item) => item.id === valid.id)) throw new Error("Material ID already exists.");
  return checked({ ...state, career: { ...state.career, materials: [...state.career.materials, valid] } });
}

export function approveIdentity(state: MemoryState, profile: z.infer<typeof careerProfileSchema>, sources: string[], approvedAt: string): MemoryState {
  checked(state);
  const identity = professionalIdentitySchema.parse({ ...careerProfileSchema.parse(profile), sourceIds: sources, approvedAt });
  return checked({ ...state, career: { ...state.career, identity } });
}

// The caller supplies the original document text or completed answer for quote verification.
// Only the short quote is retained; the original content is not returned or stored here.
export function addEvidence(state: MemoryState, source: EvidenceSource, originalContent: string): MemoryState {
  checked(state);
  const valid = evidenceSourceSchema.parse(source);
  if (!normalize(originalContent).includes(normalize(valid.excerpt))) throw new Error("Evidence excerpt is absent from the supplied source.");
  if (state.career.sources.some((item) => item.id === valid.id)) throw new Error("Evidence ID already exists.");
  if (valid.kind === "interview" && !state.sessions.some((session) => session.id === valid.originId))
    throw new Error("Interview evidence requires a known session.");
  if (valid.kind !== "interview" && !state.career.materials.some((material) => material.id === valid.originId && material.kind === valid.kind))
    throw new Error("Document evidence requires a known matching material.");
  return checked({ ...state, career: { ...state.career, sources: [...state.career.sources, valid] } });
}

export function addProposal(state: MemoryState, proposal: ProposedMemoryUpdate): MemoryState {
  checked(state);
  const valid = proposedMemoryUpdateSchema.parse(proposal);
  if (state.proposals.some((item) => item.id === valid.id) || state.career.facts.some((item) => item.id === valid.id))
    throw new Error("Memory ID already exists.");
  return checked({ ...state, proposals: [...state.proposals, valid] });
}

export function dismissProposal(state: MemoryState, proposalId: string): MemoryState {
  checked(state);
  const proposals = state.proposals.filter((proposal) => proposal.id !== proposalId);
  const retainedSources = new Set([
    ...(state.career.identity?.sourceIds ?? []),
    ...state.career.facts.flatMap((fact) => fact.sourceIds),
    ...proposals.flatMap((proposal) => proposal.sourceIds),
  ]);
  return checked({ ...state, proposals, career: { ...state.career,
    sources: state.career.sources.filter((source) => retainedSources.has(source.id)),
  } });
}

export function refreshOpportunityAlignment(state: MemoryState): MemoryState {
  const facts = new Set(state.career.facts.map((fact) => fact.id));
  return checked({ ...state, opportunities: state.opportunities.map((opportunity) => {
    if (!opportunity.alignment) return opportunity;
    const requirementIds = new Set(opportunity.requirements?.map((item) => item.id) ?? []);
    const strengths = opportunity.alignment.strengths.filter((item) => facts.has(item.factId) && requirementIds.has(item.requirementId));
    const supported = new Set(strengths.map((item) => item.requirementId));
    return { ...opportunity, alignment: { strengths,
      needsEvidence: [...requirementIds].filter((id) => !supported.has(id)) } };
  }) });
}

// An explicit caller action is the only path from a pending proposal to an approved fact.
export function approveProposal(state: MemoryState, proposalId: string, approvedAt: string): MemoryState {
  checked(state);
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error("Proposal not found.");
  if (!supportedNumbers(proposal.text, proposal.sourceIds, state)) throw new Error("Numerical claims need supporting evidence.");
  const existingProject = state.career.projects.find((project) => project.id === proposal.projectId);
  if (existingProject && normalize(existingProject.title) !== normalize(proposal.projectTitle))
    throw new Error("Proposal project title conflicts with an approved project.");
  const duplicate = state.career.facts.find((fact) => fact.projectId === proposal.projectId && normalize(fact.text) === normalize(proposal.text));
  const projects = existingProject ? state.career.projects : [...state.career.projects, { id: proposal.projectId, title: proposal.projectTitle }];
  const facts = duplicate ? state.career.facts.map((fact) => fact.id === duplicate.id ? approvedCareerFactSchema.parse({
    ...fact, sourceIds: [...new Set([...fact.sourceIds, ...proposal.sourceIds])],
  }) : fact) : [...state.career.facts, approvedCareerFactSchema.parse({
    id: proposal.id, projectId: proposal.projectId, kind: proposal.kind, text: proposal.text,
    sourceIds: proposal.sourceIds, approvedAt,
  })];
  return checked({ ...state, career: { ...state.career, projects, facts },
    proposals: state.proposals.filter((item) => item.id !== proposalId) });
}

export function correctFact(state: MemoryState, factId: string, text: string, sourceIdsForCorrection: string[], correctedAt: string): MemoryState {
  checked(state);
  if (!state.career.facts.some((fact) => fact.id === factId)) throw new Error("Fact not found.");
  if (!supportedNumbers(text, sourceIdsForCorrection, state)) throw new Error("Numerical claims need supporting evidence.");
  const facts = state.career.facts.map((fact) => fact.id === factId ? approvedCareerFactSchema.parse({
    ...fact, text, sourceIds: sourceIdsForCorrection, correctedAt,
  }) : fact);
  if (facts.some((fact) => fact.id !== factId && fact.projectId === facts.find((item) => item.id === factId)?.projectId &&
    normalize(fact.text) === normalize(text))) throw new Error("Correction duplicates an approved fact.");
  return detachFactAlignment(checked({ ...state, career: { ...state.career, facts } }), factId);
}

export function deleteFact(state: MemoryState, factId: string): MemoryState {
  checked(state);
  const facts = state.career.facts.filter((fact) => fact.id !== factId);
  const usedSources = new Set([...(state.career.identity?.sourceIds ?? []), ...facts.flatMap((fact) => fact.sourceIds),
    ...state.proposals.flatMap((proposal) => proposal.sourceIds)]);
  return refreshOpportunityAlignment(checked({ ...state, career: { ...state.career, facts,
    sources: state.career.sources.filter((source) => usedSources.has(source.id)) } }));
}

export function deleteEvidence(state: MemoryState, sourceId: string): MemoryState {
  checked(state);
  const remaining = (ids: string[]) => ids.filter((id) => id !== sourceId);
  const identity = state.career.identity;
  return refreshOpportunityAlignment(checked({ ...state, career: { ...state.career,
    sources: state.career.sources.filter((source) => source.id !== sourceId),
    identity: identity && remaining(identity.sourceIds).length ? { ...identity, sourceIds: remaining(identity.sourceIds) } : null,
    facts: state.career.facts.filter((fact) => remaining(fact.sourceIds).length).map((fact) => ({ ...fact, sourceIds: remaining(fact.sourceIds) })),
  }, proposals: state.proposals.filter((proposal) => remaining(proposal.sourceIds).length).map((proposal) => ({
    ...proposal, sourceIds: remaining(proposal.sourceIds),
  })) }));
}

export function deleteMaterial(state: MemoryState, materialId: string): MemoryState {
  checked(state);
  const sourceIdsForMaterial = state.career.sources.filter((source) => source.originId === materialId && source.kind !== "interview").map((source) => source.id);
  const withoutEvidence = sourceIdsForMaterial.reduce(deleteEvidence, state);
  return checked({ ...withoutEvidence, career: { ...withoutEvidence.career,
    materials: withoutEvidence.career.materials.filter((material) => material.id !== materialId) } });
}

export function deleteSession(state: MemoryState, sessionId: string): MemoryState {
  checked(state);
  const sourceIdsForSession = state.career.sources.filter((source) => source.kind === "interview" && source.originId === sessionId).map((source) => source.id);
  const withoutEvidence = sourceIdsForSession.reduce(deleteEvidence, state);
  return checked({ ...withoutEvidence,
    sessions: withoutEvidence.sessions.filter((session) => session.id !== sessionId),
    proposals: withoutEvidence.proposals.filter((proposal) => proposal.originSessionId !== sessionId) });
}

export function deleteOpportunity(state: MemoryState, opportunityId: string): MemoryState {
  checked(state);
  const proposalIds = state.proposals.filter((proposal) => proposal.opportunityId === opportunityId).map((proposal) => proposal.id);
  const withoutPendingEvidence = proposalIds.reduce(dismissProposal, state);
  return checked({ ...withoutPendingEvidence, opportunities: withoutPendingEvidence.opportunities.filter((item) => item.id !== opportunityId),
    rounds: withoutPendingEvidence.rounds.filter((round) => round.opportunityId !== opportunityId),
    proposals: withoutPendingEvidence.proposals.filter((proposal) => proposal.opportunityId !== opportunityId) });
}
