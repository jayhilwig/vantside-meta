import assert from "node:assert/strict";
import test from "node:test";
import { askBasetenOpportunity, BASETEN_MODEL } from "./baseten-request";
import { extractOpportunity } from "./extraction-handler";

test("optional Baseten request uses documented model and does not expose credentials in errors", async () => {
  const previous = process.env.BASETEN_API_KEY;
  const provider = process.env.OPPORTUNITY_PROVIDER;
  process.env.BASETEN_API_KEY = "mock-secret";
  process.env.OPPORTUNITY_PROVIDER = "baseten";
  try {
    const fetcher: typeof fetch = async (input, init) => {
      assert.equal(input, "https://inference.baseten.co/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, BASETEN_MODEL);
      assert.equal(body.max_tokens, 220);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer mock-secret");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ company: "Example", role: "Designer", confidence: "clear", alignedFactIds: ["fact-1"] }) } }] });
    };
    const response = await extractOpportunity({ text: "Example seeks a designer with research experience.", careerFacts: [{ id: "fact-1", text: "Led research projects" }] }, fetcher);
    assert.equal(response.status, 200);
    assert.deepEqual((response.body as { opportunity: { alignedFactIds: string[] } }).opportunity.alignedFactIds, ["fact-1"]);
    const failed = await askBasetenOpportunity("JSON", "test", async () => new Response("", { status: 403 }));
    assert.equal(JSON.stringify(failed).includes("mock-secret"), false);
  } finally { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous;
    if (provider === undefined) delete process.env.OPPORTUNITY_PROVIDER; else process.env.OPPORTUNITY_PROVIDER = provider; }
});

test("unconfigured Baseten leaves existing direct Meta opportunity route available", async () => {
  const previous = process.env.BASETEN_API_KEY;
  const provider = process.env.OPPORTUNITY_PROVIDER;
  const meta = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  delete process.env.BASETEN_API_KEY;
  process.env.OPPORTUNITY_PROVIDER = "baseten";
  process.env.MODEL_API_KEY = "mock-meta"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock-model";
  try {
    const response = await extractOpportunity({ text: "Example seeks a designer with research experience." },
      async (_input, init) => {
        assert.match(String(init?.body), /mock-model/);
        return Response.json({ choices: [{ message: { content: '{"company":"Example","role":"Designer","confidence":"clear"}' } }] });
      });
    assert.equal(response.status, 200);
  } finally {
    if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous;
    if (provider === undefined) delete process.env.OPPORTUNITY_PROVIDER; else process.env.OPPORTUNITY_PROVIDER = provider;
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"].entries()) {
      if (meta[index] === undefined) delete process.env[name]; else process.env[name] = meta[index];
    }
  }
});
