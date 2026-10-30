import assert from "node:assert/strict";
import test from "node:test";
import { hasSourceQuote } from "./job-description-text";

test("source quotes survive PDF whitespace, line splits, and soft hyphens", () => {
  assert.equal(hasSourceQuote("Design API platforms\n and conduct user research", "Design API platforms and conduct user research"), true);
  assert.equal(hasSourceQuote("Build cross-\nfunctional teams", "Build crossfunctional teams"), true);
  assert.equal(hasSourceQuote("Improve customer\u00adfacing products", "Improve customerfacing products"), true);
  assert.equal(hasSourceQuote("Experience with API / platform design", "Experience with API platform design"), true);
});

test("unrelated or reordered requirements are not treated as source quotes", () => {
  assert.equal(hasSourceQuote("Design API platforms and conduct user research", "Manage a global engineering team"), false);
  assert.equal(hasSourceQuote("Design API platforms and conduct user research", "Conduct API research and design platforms"), false);
});
