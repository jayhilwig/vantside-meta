import assert from "node:assert/strict";
import test from "node:test";
import { extractJobPage, fetchJobPosting, isPublicAddress, parseJobUrl, pinnedJobLookup } from "./job-posting-url";

const job = `<html><body><nav>${"Navigation links ".repeat(50)}</nav><main><h1>Senior Product Designer</h1><p>Example is hiring a Senior Product Designer.</p><h2>Responsibilities</h2><p>${"Design customer experiences, collaborate with engineers, and improve product accessibility. ".repeat(5)}</p><h2>Qualifications</h2><p>Experience with user research and design systems.</p></main><footer>Cookies and advertising</footer></body></html>`;

test("pinned DNS lookup returns the shape requested by Node HTTPS", async () => {
  const lookup = pinnedJobLookup("8.8.8.8", 4);
  const addresses = await new Promise((resolve, reject) => lookup("example.com", { all: true }, (error, value) => error ? reject(error) : resolve(value)));
  const address = await new Promise((resolve, reject) => lookup("example.com", { all: false }, (error, value) => error ? reject(error) : resolve(value)));
  assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
  assert.equal(address, "8.8.8.8");
});

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

test("Greenhouse public API supplies a posting without page navigation or credentials", async () => {
  const calls: string[] = [];
  const result = await fetchJobPosting("https://job-boards.greenhouse.io/splice/jobs/8686138002?utm_source=chatgpt.com", {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    load: async (url: URL) => {
      calls.push(url.href);
      return { status: 200, contentType: "application/json", body: JSON.stringify({ title: "Senior Product Designer",
        content: `&lt;h2&gt;Responsibilities&lt;/h2&gt;&lt;p&gt;${"Design user experiences and collaborate with engineers. ".repeat(8)}&lt;/p&gt;&lt;h2&gt;Qualifications&lt;/h2&gt;&lt;p&gt;Experience with research and design systems.&lt;/p&gt;` }) };
    },
  } as never);
  assert.deepEqual(calls, ["https://boards-api.greenhouse.io/v1/boards/splice/jobs/8686138002"]);
  assert.equal(result.url, "https://job-boards.greenhouse.io/splice/jobs/8686138002?utm_source=chatgpt.com");
  assert.match(result.text, /Senior Product Designer[^]*Responsibilities/);
  assert.doesNotMatch(result.text, /&lt;|<p>/);
});

test("Lever and Ashby public postings use structured content and fall back to readable HTML", async () => {
  const description = `<h2>Responsibilities</h2><p>${"Design product workflows and collaborate with research teams. ".repeat(8)}</p><h2>Qualifications</h2><p>Experience with design systems.</p>`;
  const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
  const lever = await fetchJobPosting("https://jobs.lever.co/example/abc-123", { resolve,
    load: async () => ({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Product Designer", description }) }),
  } as never);
  assert.match(lever.text, /Product Designer/);
  const ashby = await fetchJobPosting("https://jobs.ashbyhq.com/example/abc-123", { resolve,
    load: async () => ({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs: [{ title: "Product Designer", jobUrl: "https://jobs.ashbyhq.com/example/abc-123", descriptionHtml: description }] }) }),
  } as never);
  assert.match(ashby.text, /Qualifications/);
  const calls: string[] = [];
  const fallback = await fetchJobPosting("https://job-boards.greenhouse.io/example/jobs/123", { resolve,
    load: async (url: URL) => { calls.push(url.hostname); return url.hostname === "boards-api.greenhouse.io"
      ? { status: 404, contentType: "application/json", body: "" }
      : { status: 200, contentType: "text/html", body: job }; },
  } as never);
  assert.deepEqual(calls, ["boards-api.greenhouse.io", "job-boards.greenhouse.io"]);
  assert.match(fallback.text, /Senior Product Designer/);
});
