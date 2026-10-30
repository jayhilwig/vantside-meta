import assert from "node:assert/strict";
import test from "node:test";
import { questionToHud } from "./interview-hud-pipeline";
import { LatestQuestion } from "./latest-question";

const projects = [{ projectId: "platform", title: "Developer platform", facts: [
  { id: "api-flow", text: "Designed API platform onboarding for developers", source: "Designed API platform onboarding for developers" },
  { id: "api-docs", text: "Improved API documentation after developer interviews", source: "Improved API documentation after developer interviews" },
] }];
const opportunity = { company: "Example", role: "Platform designer", requirements: [
  { id: "api", kind: "required" as const, text: "Design API platform experiences", sourceExcerpt: "Design API platform experiences" } ] };
const question = "How did you design API platform onboarding?";

test("completed question uses Jev then Meta to select only approved, opportunity-relevant source IDs", async () => {
  const routes: string[] = [];
  const result = await questionToHud({ question, projects, opportunity, recentFactIds: [], signal: new AbortController().signal }, async (url, init) => {
    routes.push(String(url));
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.opportunity, opportunity);
    if (String(url).endsWith("/decide-hud-cue")) return Response.json({ show: true, reason: "relevant",
      cues: [{ factId: "api-flow", projectId: "platform" }] });
    assert.deepEqual(body.projects[0].facts.map((fact: { id: string }) => fact.id), ["api-flow"]);
    return Response.json({ cue: { projectId: "platform", headline: "API onboarding", cuePhrases: ["Developer flows"],
      sourceFactIds: ["api-flow"], match: "verified" } });
  });
  assert.deepEqual(routes.map((route) => route.split("/").at(-1)), ["decide-hud-cue", "cue"]);
  assert.deepEqual(result.cues, [{ factId: "api-flow", projectId: "platform", text: projects[0].facts[0].text }]);
});

test("silence, irrelevant conversation, no approved match, and repeated cues never call Meta", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ show: false, reason: "irrelevant", cues: [] }); };
  const blank = await questionToHud({ question: " ", projects, opportunity, recentFactIds: [], signal: new AbortController().signal }, fetcher);
  assert.equal(blank.reason, "no-match"); assert.equal(calls, 0);
  const casual = await questionToHud({ question: "How is the weather?", projects, opportunity, recentFactIds: [], signal: new AbortController().signal }, fetcher);
  assert.equal(casual.reason, "irrelevant"); assert.equal(calls, 1);
  const noMatch = await questionToHud({ question, projects, opportunity, recentFactIds: ["api-flow"], signal: new AbortController().signal }, async () => {
    calls++; return Response.json({ show: false, reason: "no-match", cues: [] });
  });
  assert.deepEqual(noMatch.cues, []); assert.equal(calls, 2);
  const unavailable = await questionToHud({ question, projects, opportunity, recentFactIds: [], signal: new AbortController().signal },
    async (url) => { assert.match(String(url), /decide-hud-cue$/); return Response.json({ show: false, reason: "unavailable", cues: [] }); });
  assert.equal(unavailable.reason, "unavailable");
});

test("malformed or injected Jev candidates cannot add unapproved memory", async () => {
  let metaCalls = 0;
  for (const cues of [[{ projectId: "platform", factId: "pending-only" }], "bad"] as unknown[]) {
    const result = await questionToHud({ question, projects, opportunity, recentFactIds: [], signal: new AbortController().signal }, async (url) => {
      if (String(url).endsWith("/cue")) metaCalls++;
      return Response.json({ show: true, reason: "relevant", cues });
    });
    assert.deepEqual(result.cues, []);
  }
  assert.equal(metaCalls, 0);
});

test("invalid Meta cue is rejected and cannot introduce an unsupported metric", async () => {
  await assert.rejects(questionToHud({ question, projects, opportunity, recentFactIds: [], signal: new AbortController().signal }, async (url) =>
    String(url).endsWith("/decide-hud-cue") ? Response.json({ show: true, cues: [{ projectId: "platform", factId: "api-flow" }] })
      : Response.json({ cue: { projectId: "platform", headline: "Increased revenue 90%", cuePhrases: ["Developer flows"],
        sourceFactIds: ["api-flow"], match: "verified" } })), /could not be verified/);
});

test("newer question wins; ending the session cancels late results and errors", async () => {
  const current = new LatestQuestion<string>();
  const shown: string[] = [];
  let firstResolve!: (value: string) => void;
  const first = current.run(() => new Promise((resolve) => { firstResolve = resolve; }), (value) => shown.push(value), () => shown.push("error"));
  const second = current.run(async () => "new question", (value) => shown.push(value), () => shown.push("error"));
  firstResolve("stale question");
  await Promise.all([first, second]);
  assert.deepEqual(shown, ["new question"]);
  let finalResolve!: (value: string) => void;
  const final = current.run(() => new Promise((resolve) => { finalResolve = resolve; }), (value) => shown.push(value), () => shown.push("error"));
  current.cancel(); finalResolve("after end"); await final;
  assert.deepEqual(shown, ["new question"]);
  assert.equal(current.running, false);
});
