import { z } from "zod";
import { askMeta } from "./meta-request";
import { careerProfileSchema, memoryProjectSchema } from "../src/lib/session-schema";

const contextSchema = z.object({
  profile: careerProfileSchema,
  projects: z.array(memoryProjectSchema).min(1).max(8),
}).strict();
const turnSchema = contextSchema.extend({
  question: z.string().trim().min(4).max(250),
  answer: z.string().trim().min(10).max(3000),
  summary: z.string().trim().max(650),
}).strict();
const openingSchema = z.object({ question: z.string().trim().min(10).max(250) }).strict();
const proposalSchema = z.object({
  title: z.string().trim().min(2).max(100),
  text: z.string().trim().min(5).max(300),
  source: z.string().trim().min(5).max(300),
}).strict();
const followUpSchema = z.object({
  question: z.string().trim().min(10).max(250),
  summary: z.string().trim().max(650),
  proposals: z.array(proposalSchema).max(2),
}).strict();

function approvedContext(data: z.infer<typeof contextSchema>) {
  return JSON.stringify({ profile: data.profile, approvedProjects: data.projects.map((project) => ({
    title: project.title, facts: project.facts.map((fact) => fact.text),
  })) });
}

export async function startInterview(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = contextSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Approve resume facts before starting Let's Talk." } };
  const result = await askMeta(
    "You are a concise interviewer in a consensual career-memory practice session. Ask exactly one specific opening question about the person's actual professional work, grounded in the approved resume context. Invite a concrete project, responsibility, decision, challenge, or outcome. Do not ask about a job opportunity, request confidential details, invent experience, or pose a restricted assessment. Return JSON only: {question}.",
    approvedContext(input.data), 180, fetcher, signal,
  );
  if (result.error) return { status: 502, body: { error: result.error } };
  const parsed = openingSchema.safeParse(result.data);
  return parsed.success ? { status: 200, body: { question: parsed.data.question } }
    : { status: 502, body: { error: "Meta returned an unreadable opening question." } };
}

export async function continueInterview(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = turnSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "A complete interview response is required." } };
  const { question, answer, summary } = input.data;
  const result = await askMeta(
    "You are conducting a consensual foundational career interview, independent of any job description. Use the approved resume profile and compact prior-session summary to pick one natural, specific follow-up to the latest answer. Explore a concrete decision, challenge, responsibility, project, collaboration, or supported outcome; avoid repeating earlier questions. Never invent a career fact or ask for a restricted assessment solution. Propose at most two short Career Memory facts only when directly supported by the latest answer. Each proposal.source must be a verbatim excerpt from that answer, and proposal.text must not claim more than that excerpt. If no reliable proposal exists, use []. Keep summary a compact, neutral memory of topics already explored, not a new approved fact. Return JSON only: {question,summary,proposals:[{title,text,source}]}.",
    JSON.stringify({ ...JSON.parse(approvedContext(input.data)), previousSummary: summary, latestQuestion: question, latestAnswer: answer }),
    650, fetcher, signal,
  );
  if (result.error) return { status: 502, body: { error: result.error } };
  const parsed = followUpSchema.safeParse(result.data);
  if (!parsed.success) return { status: 502, body: { error: "Meta returned an unreadable follow-up question." } };
  const knownTitles = input.data.projects.map((project) => project.title.toLowerCase());
  const proposals = parsed.data.proposals.filter((proposal) =>
    (answer.toLowerCase().includes(proposal.title.toLowerCase()) || knownTitles.includes(proposal.title.toLowerCase())) &&
    answer.toLowerCase().includes(proposal.source.toLowerCase()) &&
    (proposal.text.match(/\d+(?:[.,]\d+)*/g) ?? []).every((number) => proposal.source.includes(number)));
  return { status: 200, body: { question: parsed.data.question, summary: parsed.data.summary, proposals } };
}
