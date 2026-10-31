import assert from "node:assert/strict";
import test from "node:test";
import { reviewPractice } from "./practice-review";

const request = { transcript: "I mapped the API onboarding flow. I interviewed support agents and simplified the navigation.",
  role: "Product Designer", round: "Hiring Manager", requirements: ["API platform design", "Cross-functional leadership"] };

async function withMockMeta(run: () => Promise<void>) {
  const names = ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try { await run(); } finally { names.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
  }); }
}

test("practice review retains only grounded feedback and pending proposals", async () => withMockMeta(async () => {
  const result = await reviewPractice(request, async (_url, init) => {
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.reasoning_effort, "minimal");
    assert.equal(sent.store, false);
    assert.equal(sent.messages[1].content.includes("Hiring Manager"), true);
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      topics: [{ text: "Discussed API onboarding", quote: "I mapped the API onboarding flow" },
        { text: "Discussed invented leadership", quote: "I led a team of 20" }],
      strengths: [{ text: "Explained user research", quote: "I interviewed support agents" },
        { text: "Improved conversion 40%", quote: "I interviewed support agents" }],
      clarity: [{ text: "Could explain navigation decision more clearly", quote: "simplified the navigation" }],
      areas: ["API platform design", "Executive management"],
      proposals: [{ title: "API onboarding", text: "Mapped API onboarding flow", source: "I mapped the API onboarding flow" },
        { title: "Revenue", text: "Increased revenue by 70%", source: "I mapped the API onboarding flow" }],
    }) } }] });
  });
  assert.equal(result.status, 200);
  if (!("topics" in result.body) || !result.body.topics) throw new Error("Expected a validated practice review.");
  assert.equal(result.body.topics.length, 1);
  assert.equal(result.body.strengths?.length, 1);
  assert.deepEqual(result.body.areas, ["API platform design"]);
  assert.equal(result.body.proposals.length, 1);
  assert.equal("approved" in result.body, false);
}));

test("practice review rejects sparse evidence, malformed responses, and service failures", async () => withMockMeta(async () => {
  assert.equal((await reviewPractice({ ...request, transcript: "Short" })).status, 400);
  const malformed = await reviewPractice(request, async () => Response.json({ choices: [{ message: { content: '{"topics":[]}' } }] }));
  assert.equal(malformed.status, 502);
  assert.match(malformed.body.error ?? "", /validated/);
  const unavailable = await reviewPractice(request, async () => new Response(null, { status: 503 }));
  assert.equal(unavailable.status, 502);
  assert.match(unavailable.body.error ?? "", /unavailable/);
}));
