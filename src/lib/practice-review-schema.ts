import { z } from "zod";

const item = z.object({ text: z.string().trim().min(5).max(180), quote: z.string().trim().min(5).max(220) }).strict();
export const practiceReviewSchema = z.object({
  topics: z.array(item).max(5), strengths: z.array(item).max(4), clarity: z.array(item).max(3),
  areas: z.array(z.string().trim().min(5).max(180)).max(4),
  competencies: z.array(z.object({ requirement: z.string().trim().min(5).max(220),
    assessment: z.enum(["Strong", "Develop Further", "Not Demonstrated"]), explanation: z.string().trim().min(5).max(180),
    quote: z.string().trim().max(220), suggestion: z.string().trim().max(180) }).strict()).max(8),
  proposals: z.array(z.object({ title: z.string().trim().min(2).max(100), text: z.string().trim().min(5).max(300),
    source: z.string().trim().min(5).max(300) }).strict()).max(8),
}).strict();
export type PracticeReview = z.infer<typeof practiceReviewSchema>;
