import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentOperation, visibleStepError } from "./step-workflow";

test("an opportunity error stays owned by Step 3 across navigation", () => {
  assert.equal(visibleStepError("PDF failed", 3, 2), "");
  assert.equal(visibleStepError("PDF failed", 3, 3), "PDF failed");
});

test("cleared or superseded analysis cannot apply a late result", () => {
  const request = new AbortController();
  assert.equal(isCurrentOperation(4, 4, request.signal), true);
  request.abort();
  assert.equal(isCurrentOperation(4, 4, request.signal), false);
  assert.equal(isCurrentOperation(4, 5), false);
});
