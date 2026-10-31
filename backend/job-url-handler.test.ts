import assert from "node:assert/strict";
import test from "node:test";
import { extractJobUrl } from "./job-url-handler";

test("URL extraction returns source text for the existing analysis path without model calls", async () => {
  let called = 0;
  const result = await extractJobUrl({ url: "https://job-boards.greenhouse.io/splice/jobs/8686138002" }, async (url) => {
    called++;
    return { text: "Splice is hiring a Senior Product Designer. Responsibilities include research and design systems.", url };
  });
  assert.equal(called, 1);
  assert.equal(result.status, 200);
  assert.match(result.body.text ?? "", /Splice is hiring/);
  assert.equal((await extractJobUrl({ url: "http://localhost/job" })).status, 422);
  assert.equal((await extractJobUrl({ url: "" })).status, 400);
});
