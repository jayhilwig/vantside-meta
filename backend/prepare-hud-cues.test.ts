import assert from "node:assert/strict";
import test from "node:test";
import { prepareHudCues } from "./prepare-hud-cues";

const facts = [
  { factId: "fact-one", projectId: "project-one", sourceText: "Advocated for a four digit PIN using research from field teams." },
  { factId: "fact-two", projectId: "project-one", sourceText: "Reduced onboarding time from eight weeks to two weeks." },
];
const envNames = ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"] as const;
function restoreEnv(previous: (string | undefined)[]) {
  envNames.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
}

test("Meta preparation uses a bounded batch and returns only grounded source excerpts", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  process.env.MODEL_API_KEY = "synthetic-test-key";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "synthetic-test-model";
  try {
    let calls = 0;
    const result = await prepareHudCues({ facts }, async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.reasoning_effort, "minimal");
      assert.equal(payload.store, false);
      assert.equal(payload.messages[1].content.includes("fact-one"), true);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ cues: [
        { factId: "fact-one", projectId: "project-one", text: "Advocated for a four digit PIN" },
        { factId: "fact-two", projectId: "project-one", text: "Reduced onboarding time by 90%" },
      ] }) } }] });
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 200);
    assert.deepEqual("cues" in result.body ? result.body.cues : null,
      [{ factId: "fact-one", projectId: "project-one", text: "Advocated for a four digit PIN" }]);
    assert.equal((await prepareHudCues({ facts: [...facts, facts[0]] }, async () => { throw new Error("must not call"); })).status, 400);
  } finally {
    restoreEnv(previous);
  }
});

test("malformed Meta output and provider failure return safe errors", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  process.env.MODEL_API_KEY = "synthetic-test-key";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "synthetic-test-model";
  try {
    assert.equal((await prepareHudCues({ facts }, async () => Response.json({ choices: [{ message: { content: "{" } }] }))).status, 502);
    assert.equal((await prepareHudCues({ facts }, async () => { throw new Error("timeout"); })).status, 502);
  } finally {
    restoreEnv(previous);
  }
});
