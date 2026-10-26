import { NextResponse } from "next/server";
import { z } from "zod";
import { careerExamples } from "@/lib/career-examples";
import { cueSchema } from "@/lib/cue-schema";

export const runtime = "nodejs";

const requestSchema = z.object({
  question: z.string().trim().min(4).max(500),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedRequest = requestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json({ error: "Enter a practice question between 4 and 500 characters." }, { status: 400 });
  }

  const apiKey = process.env.MODEL_API_KEY;
  const baseUrl = process.env.META_API_BASE_URL;
  const model = process.env.META_MODEL;

  if (!apiKey || !baseUrl || !model) {
    return NextResponse.json({ error: "The Meta Model API is not configured on the server." }, { status: 503 });
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
        content: `Create a compact visual memory cue for a consensual mock interview. Use only the clearly synthetic examples below. Never invent facts, outcomes, numbers, or evidence. Return one JSON object with exactly: projectId (listed ID or null), headline (short string), cuePhrases (1-3 short strings), sourceFactIds (up to 3 listed IDs), match ("verified" or "none"). If no example fits, use projectId null, sourceFactIds [], match "none", and headline "No verified memory match". Cite only facts from the selected project.\n\nSYNTHETIC EXAMPLES:\n${projectList}`,
      },
      { role: "user", content: parsedRequest.data.question },
    ],
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json({ error: "Meta could not be reached. Please try again." }, { status: 502 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Meta could not complete this cue. Please try again." }, { status: 502 });
  }

  const upstream = await response.json().catch(() => null);
  const content = upstream?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Meta returned an unreadable cue. Please try another question." }, { status: 502 });
  }

  let generated: unknown;
  try {
    generated = JSON.parse(content);
  } catch {
    return NextResponse.json({ error: "Meta returned an unreadable cue. Please try another question." }, { status: 502 });
  }

  const cue = cueSchema.safeParse(generated);
  if (!cue.success) {
    return NextResponse.json({ error: "Meta returned a cue that could not be verified. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ cue: cue.data });
}
