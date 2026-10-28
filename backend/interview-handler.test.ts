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

test("follow-up uses compact history and drops unsupported memory proposals", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL, model: process.env.META_MODEL };
  process.env.MODEL_API_KEY = "mock-only";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "mock-model";
  const context = { profile: { profession: "Product designer", seniority: "Senior", careerSummary: "Led product design for onboarding and research." },
    projects: [{ projectId: "launch", title: "Launch", facts: [{ id: "launch-fact", text: "Led launch research", source: "resume quote" }] }] };
  try {
    const fetcher: typeof fetch = async (_input, init) => {
      const sent = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      assert.equal(sent.previousSummary, "We covered launch research and collaborators.");
      assert.equal(sent.latestAnswer, "I worked with support to understand the signup issue.");
      assert.equal(sent.transcript, undefined);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        question: "What did support tell you about the signup issue?",
        summary: "Discussed support collaboration on signup.",
        proposals: [{ title: "Launch", text: "Improved signup by 50%", source: "improved signup by 50%" }],
      }) } }] });
    };
    const result = await continueInterview({ ...context, question: "Who helped investigate signup?",
      answer: "I worked with support to understand the signup issue.", summary: "We covered launch research and collaborators." }, fetcher);
    assert.equal(result.status, 200);
    assert.equal("question" in result.body ? result.body.question : "", "What did support tell you about the signup issue?");
    assert.deepEqual("proposals" in result.body ? result.body.proposals : [], []);
  } finally {
    for (const [name, value] of [["MODEL_API_KEY", previous.key], ["META_API_BASE_URL", previous.base], ["META_MODEL", previous.model]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("cancelled and failed conversation requests return recoverable errors without proposals", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL, model: process.env.META_MODEL };
  process.env.MODEL_API_KEY = "mock-only";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "mock-model";
  const context = { profile: { profession: "Product designer", seniority: "Senior", careerSummary: "Led product design for onboarding and research." },
    projects: [{ projectId: "launch", title: "Launch", facts: [{ id: "launch-fact", text: "Led launch research", source: "resume quote" }] }] };
  try {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await startInterview(context, async (_input, init) => {
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException("Cancelled", "AbortError");
    }, controller.signal);
    assert.equal(cancelled.status, 502);
    assert.equal("proposals" in cancelled.body, false);
    const failed = await continueInterview({ ...context, question: "What happened during launch?",
      answer: "I led research with the design team.", summary: "" }, async () => new Response("private upstream body", { status: 503 }));
    assert.equal(failed.status, 502);
    assert.equal("proposals" in failed.body, false);
    assert.equal(JSON.stringify(failed.body).includes("private upstream body"), false);
  } finally {
    for (const [name, value] of [["MODEL_API_KEY", previous.key], ["META_API_BASE_URL", previous.base], ["META_MODEL", previous.model]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
