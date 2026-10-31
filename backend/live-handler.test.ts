import assert from "node:assert/strict";
import test from "node:test";
import { createLiveSession, liveSessionRequest } from "./live-handler";
import { proposeLiveMemory } from "./live-proposals";

test("a finished interview with no grounded new facts returns an empty review", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const result = await proposeLiveMemory({ transcript: "I don't have a specific example to share right now." },
      async () => Response.json({ choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }] }));
    assert.equal(result.status, 200);
    assert.deepEqual((result.body as { proposals: unknown[] }).proposals, []);
  } finally { for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"].entries()) {
    if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
  } }
});

const context = { sdp: "v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\n", profile: { profession: "Designer", seniority: "Senior", careerSummary: "Designed a product launch with customer research." },
  projects: [{ projectId: "launch", title: "Launch", facts: [{ id: "research", text: "Led customer research", source: "Led customer research" }] }] };

test("practice opening uses only the selected opportunity and round while Step 2 stays foundational", () => {
  const foundational = liveSessionRequest(context);
  assert.match(foundational.session.input[0].content[0].text, /approved background/);
  assert.doesNotMatch(foundational.session.input[0].content[0].text, /Atlas/);
  const practice = liveSessionRequest({ ...context, practice: { company: "Atlas", role: "Product Designer", round: "Hiring Manager",
    description: "Design an API platform", requirements: ["API platform design"], strengths: ["User research"], areas: ["API platform design"] } });
  const prompt = practice.session.input[0].content[0].text;
  assert.match(prompt, /Atlas.*Hiring Manager/);
  assert.match(prompt, /API platform design/);
  assert.match(prompt, /Led customer research/);
  assert.doesNotMatch(prompt, /Other Company/);
});

test("live session keeps key server-side and sends approved context with WebRTC offer", async () => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "mock-only";
  try {
    const result = await createLiveSession(context, async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/live/sessions");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer mock-only");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.session.model, "gpt-live-1"); assert.equal(body.session.store, false);
      assert.equal(body.transport.type, "webrtc"); assert.equal(body.transport.sdp, context.sdp);
      assert.match(body.session.input[0].content[0].text, /Led customer research/);
      return Response.json({ session: { id: "live_mock" }, transport: { type: "webrtc", sdp: "v=0\r\no=- 321 654 IN IP4 127.0.0.1\r\n" } }, { status: 201 });
    });
    assert.equal(result.status, 200);
    assert.equal("sessionId" in result.body ? result.body.sessionId : "", "live_mock");
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test("live startup handles missing key, invalid input, authorization, malformed response, and timeout", async () => {
  const previous = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal((await createLiveSession(context)).status, 503);
    process.env.OPENAI_API_KEY = "mock-only";
    assert.equal((await createLiveSession({ ...context, sdp: "bad" })).status, 400);
    assert.equal((await createLiveSession({ sdp: context.sdp, projects: context.projects })).status, 400);
    const auth = await createLiveSession(context, async () => new Response("private error", { status: 401 }));
    assert.match(auth.body.error ?? "", /credentials/); assert.doesNotMatch(auth.body.error ?? "", /private error/);
    assert.equal((await createLiveSession(context, async () => Response.json({ session: { id: "bad" } }))).status, 502);
    assert.match((await createLiveSession(context, async () => { throw new DOMException("Timeout", "TimeoutError"); })).body.error ?? "", /timed out/);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test("spoken facts remain proposals only when a verbatim user excerpt supports them", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL, model: process.env.META_MODEL };
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const transcript = "I led customer research for the launch and interviewed six people.";
    const result = await proposeLiveMemory({ transcript }, async () => Response.json({ choices: [{ message: { content: JSON.stringify({ proposals: [
      { title: "Launch", text: "Led customer research for the launch", source: "led customer research for the launch" },
      { title: "Launch", text: "Increased conversion by 40%", source: "increased conversion by 40%" },
    ] }) } }] }));
    assert.equal(result.status, 200);
    assert.equal("proposals" in result.body ? result.body.proposals?.length : 0, 1);
    assert.equal("approved" in result.body, false);
  } finally {
    for (const [name, value] of [["MODEL_API_KEY", previous.key], ["META_API_BASE_URL", previous.base], ["META_MODEL", previous.model]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("proposal failures surface a safe Meta reason without losing the retry path", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL, model: process.env.META_MODEL };
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const result = await proposeLiveMemory({ transcript: "I led customer research for the launch." }, async () => new Response(null, { status: 429 }));
    assert.equal(result.status, 502);
    assert.match(result.body.error ?? "", /rate limiting/);
    assert.match(result.body.error ?? "", /retry without repeating/);
    assert.doesNotMatch(result.body.error ?? "", /customer research|mock/);
  } finally {
    for (const [name, value] of [["MODEL_API_KEY", previous.key], ["META_API_BASE_URL", previous.base], ["META_MODEL", previous.model]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("rich spoken interview keeps distinct grounded details and filters duplicates and invented outcomes", async () => {
  const previous = { key: process.env.MODEL_API_KEY, base: process.env.META_API_BASE_URL, model: process.env.META_MODEL };
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const transcript = "I led the Atlas redesign. I interviewed support agents. I mapped their escalation workflow. I chose a simpler navigation model. I worked with engineering on the rollout. We reduced handling time by 12%.";
    const facts = [
      ["Atlas", "Led the Atlas redesign", "I led the Atlas redesign"],
      ["Atlas", "Interviewed support agents", "I interviewed support agents"],
      ["Atlas", "Mapped the escalation workflow", "I mapped their escalation workflow"],
      ["Atlas", "Chose a simpler navigation model", "I chose a simpler navigation model"],
      ["Atlas", "Worked with engineering on the rollout", "I worked with engineering on the rollout"],
      ["Atlas", "Reduced handling time by 12%", "We reduced handling time by 12%"],
      ["Atlas", "Led the Atlas redesign!", "I led the Atlas redesign"],
      ["Atlas", "Improved conversion by 40%", "I led the Atlas redesign"],
    ].map(([title, text, source]) => ({ title, text, source }));
    const result = await proposeLiveMemory({ transcript }, async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.ok(request.max_completion_tokens > 700);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ proposals: facts }) } }] });
    });
    assert.equal(result.status, 200);
    assert.equal("proposals" in result.body ? result.body.proposals?.length : 0, 6);
  } finally {
    for (const [name, value] of [["MODEL_API_KEY", previous.key], ["META_API_BASE_URL", previous.base], ["META_MODEL", previous.model]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
