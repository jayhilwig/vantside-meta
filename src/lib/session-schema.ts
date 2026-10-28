import { z } from "zod";

export const memoryFactSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  text: z.string().trim().min(4).max(400),
  source: z.string().trim().min(3).max(300),
}).strict();

export const memoryProjectSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().trim().min(2).max(100),
  dates: z.string().trim().min(4).max(60).optional(),
  facts: z.array(memoryFactSchema).min(1).max(12),
}).strict();

export const careerProfileSchema = z.object({
  profession: z.string().trim().min(2).max(100),
  seniority: z.string().trim().min(2).max(100),
  careerSummary: z.string().trim().min(10).max(500),
}).strict();
export const resumeInterviewProposalSchema = z.object({
  profile: careerProfileSchema,
  projects: z.array(memoryProjectSchema).min(1).max(8),
}).strict();
export const opportunitySchema = z.object({
  company: z.string().trim().max(100),
  role: z.string().trim().max(100),
  confidence: z.enum(["clear", "uncertain"]),
  alignedFactIds: z.array(z.string().min(1).max(80)).max(3).optional(),
}).strict();

export type MemoryProject = z.infer<typeof memoryProjectSchema>;
export type CareerProfile = z.infer<typeof careerProfileSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
