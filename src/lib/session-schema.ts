import { z } from "zod";

export const memoryFactSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  text: z.string().trim().min(4).max(400),
  source: z.string().trim().min(3).max(300),
}).strict();

export const memoryProjectSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().trim().min(2).max(100),
  facts: z.array(memoryFactSchema).min(1).max(12),
}).strict();

export const resumeProposalSchema = z.object({ projects: z.array(memoryProjectSchema).max(8) }).strict();
export const opportunitySchema = z.object({
  company: z.string().trim().max(100),
  role: z.string().trim().max(100),
  confidence: z.enum(["clear", "uncertain"]),
}).strict();

export type MemoryProject = z.infer<typeof memoryProjectSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
