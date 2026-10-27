import { z } from "zod";
import { careerExamples } from "../src/lib/career-examples";
import { cueSchema } from "../src/lib/cue-schema";

const requestSchema = z.object({ question: z.string().trim().min(4).max(500) }).strict();

export async function createCue(body: unknown, fetcher: typeof fetch = fetch) {
  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return { status: 400, body: { error: "Enter a practice question between 4 and 500 characters." } };
  }

  const apiKey = process.env.MODEL_API_KEY;
  const baseUrl = process.env.META_API_BASE_URL;
  const model = process.env.META_MODEL;
  if (!apiKey || !baseUrl || !model) {
    return { status: 503, body: { error: "The Meta Model API is not configured on the server." } };
  }

  const projectList = careerExamples
    .map((project) => `${project.projectId} (${project.title})\n${project.facts.map((fact) => `- ${fact.id}: ${fact.text}`).join("\n")}`)
    .join("\n\n");

  const payload = {
    model,
    reasoning_effort: "minimal",
    max_completion_tokens: 512,
    response_format: { type: "json_object" },
    store: false,
    messages: [
      {
        role: "developer",
        content: `Create a compact visual memory cue for a consensual practice interview. Use only the clearly synthetic examples below. Never invent facts, outcomes, numbers, or evidence. Do not answer coding assessments, legal or clinical competency questions, or other restricted evaluations. If the question is outside career-memory practice or ambiguous, return a no-match cue rather than a solution. Return one JSON object with exactly: projectId (listed ID or null), headline (short string), cuePhrases (1-3 short strings), sourceFactIds (up to 3 listed IDs), match ("verified" or "none"). If no example fits, use projectId null, sourceFactIds [], match "none", headline "No verified memory match", and cuePhrases ["Try a question about past work"]. Cite only facts from the selected project.\n\nSYNTHETIC EXAMPLES:\n${projectList}`,
      },
      { role: "user", content: parsedRequest.data.question },
    ],
  };

  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { status: 502, body: { error: "Meta could not be reached. Please try again." } };
  }
  if (!response.ok) {
    return { status: 502, body: { error: "Meta could not complete this cue. Please try again." } };
  }

  const upstream = await response.json().catch(() => null);
  const content = upstream?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return { status: 502, body: { error: "Meta returned an unreadable cue. Please try another question." } };
  }

  let generated: unknown;
  try {
    generated = JSON.parse(content);
  } catch {
    return { status: 502, body: { error: "Meta returned an unreadable cue. Please try another question." } };
  }
  const cue = cueSchema.safeParse(generated);
  if (!cue.success) {
    return { status: 502, body: { error: "Meta returned a cue that could not be verified. Please try again." } };
  }
  if (cue.data.match === "none") {
    return { status: 200, body: { cue: { ...cue.data, cuePhrases: ["Try a question about past work"] } } };
  }
  return { status: 200, body: { cue: cue.data } };
}
