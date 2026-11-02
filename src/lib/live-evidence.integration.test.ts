import assert from "node:assert/strict";
import test from "node:test";
import { emptyMemoryState } from "../../backend/career-memory";
import { proposeLiveMemory } from "../../backend/live-proposals";
import { approveInterviewBatch, currentReviewBatch, pendingInterviewFacts, retainPendingFact } from "./journey-memory";
import { deduplicateLiveProposals, extractLiveEvidenceProposals, LiveEvidenceBuffer, liveEvidenceChunks } from "./live-evidence";

const examples = [
  { title: "Falcon onboarding", text: "Sole designer for Falcon access onboarding", source: "I was the sole designer for Falcon access onboarding" },
  { title: "Falcon onboarding", text: "Interviewed seven support specialists about sign-in failures", source: "I interviewed seven support specialists about sign-in failures" },
  { title: "Falcon onboarding", text: "Chose progressive disclosure for security options", source: "I chose progressive disclosure for security options" },
  { title: "Falcon onboarding", text: "Reduced onboarding time from 8 to 5 minutes", source: "We reduced onboarding time from 8 to 5 minutes" },
  { title: "Beacon billing", text: "Led billing research across three product teams", source: "I led billing research across three product teams" },
  { title: "Beacon billing", text: "Worked with engineers on invoice exceptions", source: "I worked with engineers on invoice exceptions" },
  { title: "Beacon billing", text: "Cut billing support contacts by 18%", source: "We cut billing support contacts by 18%" },
  { title: "Beacon billing", text: "Documented rollout tradeoffs for customer success", source: "I documented rollout tradeoffs for customer success" },
  { title: "Beacon billing", text: "Learned to test error recovery before visual polish", source: "I learned to test error recovery before visual polish" },
];

test("synthetic ten-minute conversation preserves multi-project details through Meta validation and pending review", async () => {
  const previous = [process.env.MODEL_API_KEY, process.env.META_API_BASE_URL, process.env.META_MODEL];
  process.env.MODEL_API_KEY = "mock"; process.env.META_API_BASE_URL = "https://example.invalid/v1"; process.env.META_MODEL = "mock";
  try {
    const evidence = new LiveEvidenceBuffer();
    const factTurns = new Map([0, 5, 13, 20, 31, 40, 48, 55, 59].map((turn, index) => [turn, examples[index].source]));
    for (let turn = 0; turn < 60; turn++) {
      const detail = factTurns.get(turn) ?? "I explained the constraints and how the team discussed the next design decision";
      const context = " I described the user problem, the options we considered, the tradeoffs, and how I worked with the team to understand what happened after launch.".repeat(2);
      assert.equal(evidence.append(`${detail}.${context} `, turn * 10_000, turn * 10_000 + 4_000), false);
    }
    assert.equal(evidence.stats().estimatedSpeechSegments, 60);
    assert.ok(liveEvidenceChunks(evidence.text()).length >= 2);
    const extracted = await extractLiveEvidenceProposals(evidence.text(), async (chunk) => {
      const result = await proposeLiveMemory({ transcript: chunk }, async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        const supplied = String(request.messages[1].content);
        const proposals = examples.filter((item) => supplied.includes(item.source));
        return Response.json({ choices: [{ message: { content: JSON.stringify({ proposals }) } }] });
      });
      assert.equal(result.status, 200);
      return (result.body as { proposals: typeof examples }).proposals;
    });
    const unique = deduplicateLiveProposals(extracted, [], []);
    assert.deepEqual(unique.candidates.map((item) => item.text), examples.map((item) => item.text));
    let state = emptyMemoryState();
    const now = "2026-11-02T12:00:00.000Z";
    for (const [index, fact] of unique.candidates.entries()) {
      state = retainPendingFact(state, { ...fact, id: `fact-${index}`, sessionId: "synthetic-session", answer: fact.source }, now);
    }
    assert.equal(state.career.facts.length, 0);
    assert.equal(pendingInterviewFacts(state).length, examples.length);
    state = approveInterviewBatch(state, currentReviewBatch(pendingInterviewFacts(state)), now);
    assert.equal(state.career.projects.length, 2);
    assert.equal(state.career.facts.length, examples.length);
    assert.ok(state.career.facts.some((fact) => fact.text.includes("18%")));
    assert.ok(state.career.facts.some((fact) => fact.text.includes("8 to 5")));
  } finally {
    for (const [index, name] of ["MODEL_API_KEY", "META_API_BASE_URL", "META_MODEL"].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});
