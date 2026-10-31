import { z } from "zod";
import { fetchJobPosting } from "./job-posting-url";

const inputSchema = z.object({ url: z.string().trim().min(1).max(2000) }).strict();

export async function extractJobUrl(body: unknown, readUrl = fetchJobPosting) {
  const input = inputSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Enter a valid HTTPS job posting URL." } };
  try {
    const result = await readUrl(input.data.url);
    return { status: 200, body: { text: result.text, url: input.data.url } };
  } catch (cause) {
    return { status: 422, body: { error: cause instanceof Error ? cause.message : "This job page could not be read. Paste the description instead." } };
  }
}
