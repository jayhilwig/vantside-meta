import assert from "node:assert/strict";
import test from "node:test";
import { extractOpportunity, extractResume } from "./extraction-handler";
import { createCue } from "./cue-handler";

test("resume PDF proposals, opportunity confirmation data, and personal cues stay source-linked", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL, model: process.env.META_MODEL };
  process.env.MODEL_API_KEY = "mock-only";
  process.env.META_API_BASE_URL = "https://example.invalid/v1";
  process.env.META_MODEL = "mock-model";
  try {
    const pdf = Buffer.from("%PDF-1.4\nmock test content").toString("base64");
    const resumeFetcher: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.messages[1].content[1].file.file_data.startsWith("data:application/pdf;base64,"), true);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ projects: [{ projectId: "launch", title: "Launch", facts: [{ id: "launch-fact", text: "Led launch research", source: "Led launch research" }] }] }) } }] });
    };
    const resume = await extractResume({ filename: "resume.pdf", data: pdf }, resumeFetcher);
    assert.equal(resume.status, 200);
    assert.equal((await extractResume({ filename: "fake.pdf", data: Buffer.from("not a PDF").toString("base64") }, resumeFetcher)).status, 400);

    const opportunityFetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ company: "", role: "Designer", confidence: "uncertain" }) } }] });
    const opportunity = await extractOpportunity({ text: "A designer role at a company not named in this posting." }, opportunityFetcher);
    assert.equal(opportunity.status, 200);

    const body = { question: "Tell me about launch research", projects: [{ projectId: "launch", title: "Launch", facts: [{ id: "launch-fact", text: "Led launch research", source: "resume quote" }] }], opportunity: { company: "Example", role: "Designer" } };
    const cueFetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ projectId: "launch", headline: "Launch research", cuePhrases: ["Research decisions"], sourceFactIds: ["launch-fact"], match: "verified" }) } }] });
    assert.equal((await createCue(body, cueFetcher)).status, 200);
    const badCueFetcher: typeof fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ projectId: "launch", headline: "Improved results 90%", cuePhrases: ["Research decisions"], sourceFactIds: ["launch-fact"], match: "verified" }) } }] });
    assert.equal((await createCue(body, badCueFetcher)).status, 502);
  } finally {
    for (const [name, value] of [["MODEL_API_KEY", previous.key], ["META_API_BASE_URL", previous.base], ["META_MODEL", previous.model]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
