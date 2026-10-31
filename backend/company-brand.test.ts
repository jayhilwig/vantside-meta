import assert from "node:assert/strict";
import test from "node:test";
import { companyBrand } from "./company-brand";
import { emptyMemoryState, memoryStateSchema } from "./career-memory";

test("Greenhouse posting uses an explicitly linked employer favicon, never the board icon", async () => {
  const calls: string[] = [];
  const result = await companyBrand({ company: "Splice", sourceUrl: "https://job-boards.greenhouse.io/splice/jobs/123" }, async (url) => {
    calls.push(url);
    if (url.includes("greenhouse.io")) return { status: 200, contentType: "text/html", body: '<link rel="icon" href="/greenhouse.ico"><a href="https://splice.com/about">About Splice</a>' };
    if (url === "https://splice.com/") return { status: 200, contentType: "text/html", body: '<link rel="icon" href="/favicon.png">' };
    return { status: 200, contentType: "image/png", body: "", bytes: Buffer.from([137, 80, 78, 71]) };
  });
  assert.deepEqual(calls, ["https://job-boards.greenhouse.io/splice/jobs/123", "https://splice.com/", "https://splice.com/favicon.png"]);
  assert.match(result.body.logoDataUrl ?? "", /^data:image\/png;base64,/);
  const state = emptyMemoryState();
  state.opportunities.push({ id: "splice", company: "Splice", role: "Designer", description: "Design product experiences", confirmedAt: "2026-10-30T00:00:00.000Z", brandLogoDataUrl: result.body.logoDataUrl });
  assert.equal(memoryStateSchema.parse(JSON.parse(JSON.stringify(state))).opportunities[0].brandLogoDataUrl, result.body.logoDataUrl);
});

test("missing or invalid employer logo falls back without blocking opportunity saving", async () => {
  const absent = await companyBrand({ company: "Splice", sourceUrl: "https://job-boards.greenhouse.io/splice/jobs/123" }, async () =>
    ({ status: 200, contentType: "text/html", body: '<link rel="icon" href="/greenhouse.ico">' }));
  assert.deepEqual(absent, { status: 200, body: {} });
  const failure = await companyBrand({ company: "Splice", sourceUrl: "https://job-boards.greenhouse.io/splice/jobs/123" }, async () => { throw new Error("offline"); });
  assert.deepEqual(failure, { status: 200, body: {} });
});
