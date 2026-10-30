import assert from "node:assert/strict";
import test from "node:test";
import { extractJobPage, fetchJobPosting, isPublicAddress, parseJobUrl } from "./job-posting-url";

const job = `<html><body><nav>${"Navigation links ".repeat(50)}</nav><main><h1>Senior Product Designer</h1><p>Example is hiring a Senior Product Designer.</p><h2>Responsibilities</h2><p>${"Design customer experiences, collaborate with engineers, and improve product accessibility. ".repeat(5)}</p><h2>Qualifications</h2><p>Experience with user research and design systems.</p></main><footer>Cookies and advertising</footer></body></html>`;

test("extracts main job content without navigation or advertising", () => {
  const text = extractJobPage(job);
  assert.match(text, /Senior Product Designer/);
  assert.doesNotMatch(text, /Navigation links|Cookies and advertising/);
  assert.throws(() => extractJobPage("<html><body>Sign in to see the job.</body></html>"), /readable job description/);
  assert.throws(() => extractJobPage(`<html><body><main>${"We value your experience and privacy. ".repeat(20)}</main></body></html>`), /readable job description/);
});

test("URL intake blocks private targets, unsafe redirects, and non-HTML pages", async () => {
  for (const value of ["http://example.com/job", "https://127.0.0.1/job", "https://user:pass@example.com/job", "https://example.local/job", "https://example.com:8443/job"])
    assert.throws(() => parseJobUrl(value));
  for (const address of ["127.0.0.1", "10.1.1.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1"])
    assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  const safe = { resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    load: async () => ({ status: 200, contentType: "text/html", body: job }) };
  const result = await fetchJobPosting("https://jobs.example.com/role", safe as never);
  assert.match(result.text, /Responsibilities/);
  await assert.rejects(fetchJobPosting("https://jobs.example.com/role", {
    ...safe, load: async () => ({ status: 302, contentType: "text/html", body: "", location: "https://127.0.0.1/private" }),
  } as never));
  await assert.rejects(fetchJobPosting("https://jobs.example.com/role", {
    resolve: async () => [{ address: "169.254.169.254", family: 4 }], load: safe.load,
  } as never), /safely/);
  await assert.rejects(fetchJobPosting("https://jobs.example.com/role", {
    ...safe, load: async () => ({ status: 200, contentType: "application/pdf", body: job }),
  } as never), /could not be read/);
});
