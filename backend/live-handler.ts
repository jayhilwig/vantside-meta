import { z } from "zod";
import { careerProfileSchema, memoryProjectSchema } from "../src/lib/session-schema";

const inputSchema = z.object({
  sdp: z.string().min(20).max(100_000),
  profile: careerProfileSchema,
  projects: z.array(memoryProjectSchema).min(1).max(40),
}).strict();
const answerSchema = z.object({ session: z.object({ id: z.string().min(1) }), transport: z.object({ type: z.literal("webrtc"), sdp: z.string().min(20) }) });

export function liveSessionRequest(input: z.infer<typeof inputSchema>) {
  const facts = input.projects.flatMap((project) => project.facts.map((fact) => ({ role: project.title, fact: fact.text }))).slice(0, 35);
  const greeting = "Greet the candidate briefly, introduce yourself as their practice interviewer, and ask one specific opening question grounded in the approved background. Then pause and listen.";
  return { session: {
    model: "gpt-live-1", store: false,
    instructions: "You are VantSide's consensual practice interviewer. Speak naturally, warmly and briefly. Ask one question at a time about real projects, decisions, responsibilities, tradeoffs and outcomes. Follow up on the candidate's actual answers; avoid repetitive questions. Ask for specific examples and measurable impact only when they may exist. Never invent experience, assume an unapproved claim is true, request confidential information, or help with a restricted assessment. This is practice, not a real interview. Backchannel policy: use occasional brief acknowledgments without interrupting the answer. Interruption policy: stop speaking when the candidate interrupts and listen to their correction. Delegation policy: there are no backend tools for this conversation; handle ordinary interview questions directly without requesting backend work.",
    input: [{ role: "developer", content: [{ type: "input_text", text: `${greeting} Approved background for question selection only: ${JSON.stringify({ profile: input.profile, facts })}` }] }],
  }, transport: { type: "webrtc", sdp: input.sdp } };
}

export async function createLiveSession(body: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const input = inputSchema.safeParse(body);
  if (!input.success) return { status: 400, body: { error: "Approve resume facts before starting the voice interview." } };
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { status: 503, body: { error: "OpenAI voice is not configured on the local backend." } };
  try {
    const response = await fetcher("https://api.openai.com/v1/live/sessions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(liveSessionRequest(input.data)),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { status: 502, body: { error: response.status === 401 || response.status === 403
      ? "OpenAI rejected the local voice credentials. Check .env.local and restart the backend."
      : response.status === 429 ? "Voice sessions are rate limited. Wait a moment and try again."
      : "The voice session could not start. Try again shortly." } };
    const parsed = answerSchema.safeParse(await response.json());
    if (!parsed.success) return { status: 502, body: { error: "OpenAI returned an unreadable voice session." } };
    return { status: 200, body: { sessionId: parsed.data.session.id, sdp: parsed.data.transport.sdp } };
  } catch (cause) {
    return { status: 502, body: { error: cause instanceof Error && cause.name === "TimeoutError"
      ? "The voice connection timed out. Try again." : "The voice service could not be reached. Check your connection." } };
  }
}
