import assert from "node:assert/strict";
import test from "node:test";
import { continueInterview, startInterview } from "./interview-handler";

test("resume-led opening and bounded follow-up retain proposals only with answer evidence", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL, model: process.env.META_MODEL };
  process.env.MODEL_API_KEY = "mock-only";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "mock-model";
  const context = { profile: { profession: "Product designer", seniority: "Senior", careerSummary: "Led product design for onboarding and research." }, projects: [{ projectId: "launch", title: "Launch", facts: [{ id: "launch-fact", text: "Led launch research", source: "resume quote" }] }] };
  try {
    const openingFetcher: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.reasoning_effort, "minimal");
      assert.equal(payload.store, false);
      assert.match(payload.messages[1].content, /Product designer/);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ question: "What decision did your launch research change?" }) } }] });
    };
    const opening = await startInterview(context, openingFetcher);
    assert.equal(opening.status, 200);

    const followUpFetcher: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      const sent = JSON.parse(payload.messages[1].content);
      assert.equal(sent.previousSummary, "Discussed launch research.");
      assert.equal(sent.latestAnswer, "I changed the onboarding flow after five customer interviews.");
      assert.equal(sent.transcript, undefined);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        question: "How did you choose which onboarding change to test first?",
        summary: "Discussed research-led onboarding decisions.",
        proposals: [
          { title: "Onboarding", text: "Changed the onboarding flow after five customer interviews", source: "changed the onboarding flow after five customer interviews" },
          { title: "Unsupported", text: "Increased revenue by 50%", source: "revenue grew" },
        ],
      }) } }] });
    };
    const followUp = await continueInterview({ ...context, question: "What decision did your launch research change?", answer: "I changed the onboarding flow after five customer interviews.", summary: "Discussed launch research." }, followUpFetcher);
    assert.equal(followUp.status, 200);
    assert.equal("proposals" in followUp.body ? followUp.body.proposals?.length : 0, 1);
  } finally {
    for (const [name, value] of [["MODEL_API_KEY", previous.key], ["META_API_BASE_URL", previous.base], ["META_MODEL", previous.model]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
