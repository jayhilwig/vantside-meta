import assert from "node:assert/strict";
import test from "node:test";
import { practiceReviewPresentation } from "./practice-review-presentation";

test("review navigation remains locked through transcript finalization and analysis, then unlocks", () => {
  const finalizing = practiceReviewPresentation("reviewing", "finalizing");
  const analyzing = practiceReviewPresentation("reviewing", "analyzing");
  assert.equal(finalizing.navigationLocked, true);
  assert.match(finalizing.detail, /Finishing your transcript/);
  assert.equal(analyzing.navigationLocked, true);
  assert.match(analyzing.detail, /preparing feedback/);
  assert.equal(practiceReviewPresentation("ended", "idle").navigationLocked, false);
  assert.equal(practiceReviewPresentation("error", "idle").navigationLocked, false);
});
