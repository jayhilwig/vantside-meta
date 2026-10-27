import assert from "node:assert/strict";
import test from "node:test";
import { createCue } from "./cue-handler";

test("cue contract preserves source validation without calling Meta", async () => {
  const previous = {
    key: process.env.MODEL_API_KEY,
    base: process.env.META_API_BASE_URL,
    model: process.env.META_MODEL,
  };
  process.env.MODEL_API_KEY = "synthetic-test-key";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "synthetic-test-model";
  try {
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.reasoning_effort, "minimal");
      assert.equal(payload.store, false);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        projectId: "atlas-onboarding",
        headline: "Onboarding friction",
        cuePhrases: ["First useful action"],
        sourceFactIds: ["atlas-handoff"],
        match: "verified",
      }) } }] });
    };
    const result = await createCue({ question: "Tell me about onboarding." }, fetcher as typeof fetch);
    assert.equal(result.status, 200);
    assert.deepEqual("cue" in result.body ? result.body.cue?.sourceFactIds : null, ["atlas-handoff"]);

    const invalidFetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify({
        projectId: "atlas-onboarding",
        headline: "Wrong source",
        cuePhrases: ["Wrong project"],
        sourceFactIds: ["relay-states"],
        match: "verified",
      }) } }],
    });
    const invalid = await createCue({ question: "short" }, invalidFetcher);
    assert.equal(invalid.status, 502);

    const inventedMetric: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify({
        projectId: "atlas-onboarding",
        headline: "Improved onboarding by 40%",
        cuePhrases: ["First useful action"],
        sourceFactIds: ["atlas-handoff"],
        match: "verified",
      }) } }],
    });
    assert.equal((await createCue({ question: "Tell me about onboarding." }, inventedMetric)).status, 502);
  } finally {
    if (previous.key === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previous.key;
    if (previous.base === undefined) delete process.env.META_API_BASE_URL; else process.env.META_API_BASE_URL = previous.base;
    if (previous.model === undefined) delete process.env.META_MODEL; else process.env.META_MODEL = previous.model;
  }
});
