import assert from "node:assert/strict";
import test from "node:test";
import { decideHudCue } from "./hud-decision";

const projects = [{ projectId: "launch", title: "Product launch", facts: [{ id: "research", text: "Led launch research with customers", source: "Led launch research with customers" }] }];
const request = { question: "How did launch research shape your decisions?", projects };

test("Jev gates a relevant approved-memory cue without receiving the facts", async () => {
  const previous = process.env.TYPESAFE_API_KEY; process.env.TYPESAFE_API_KEY = "mock-secret";
  try {
    const result = await decideHudCue(request, async (url, init) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer mock-secret");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "jev-latest");
      assert.equal(body.questions.show_cue.type, "noul");
      assert.equal(JSON.stringify(body).includes("Led launch research with customers"), false);
      return Response.json({ answers: { show_cue: { type: "noul", noul: 0.94 } } });
    });
    assert.equal(result.body.show, true);
    assert.equal(result.body.cues[0]?.factId, "research");
  } finally { if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous; }
});

test("silence, unrelated questions, and recently shown facts do not call Jev", async () => {
  const unavailable: typeof fetch = async () => { throw new Error("Jev should not be called"); };
  for (const body of [{ question: "   ", projects }, { question: "What is the weather today?", projects }, { ...request, recentFactIds: ["research"] }]) {
    const result = await decideHudCue(body, unavailable);
    assert.equal(result.body.show, false);
    assert.deepEqual(result.body.cues, []);
  }
  const noMemory = await decideHudCue({ question: request.question, projects: [] }, unavailable);
  assert.equal(noMemory.body.show, false);
  assert.deepEqual(noMemory.body.cues, []);
});

test("Jev rejects casual conversation and fails closed on malformed or unavailable responses", async () => {
  const previous = process.env.TYPESAFE_API_KEY; process.env.TYPESAFE_API_KEY = "mock-secret";
  try {
    const casual = await decideHudCue(request, async () => Response.json({ answers: { show_cue: { type: "noul", noul: 0.1 } } }));
    assert.equal(casual.body.show, false);
    const malformed = await decideHudCue(request, async () => Response.json({ answers: { show_cue: { type: "noul", noul: "yes" } } }));
    assert.equal(malformed.body.show, false);
    const failed = await decideHudCue(request, async () => new Response("", { status: 529 }));
    assert.equal(failed.body.show, false);
    const timeout = await decideHudCue(request, async () => { throw new DOMException("Timed out", "TimeoutError"); });
    assert.equal(timeout.body.show, false);
  } finally { if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous; }
});
