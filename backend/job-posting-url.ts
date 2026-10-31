import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const maxBytes = 1_000_000;
const maxRedirects = 3;

export function parseJobUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid HTTPS job posting URL."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    !url.hostname.includes(".") || isIP(url.hostname) || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal"))
    throw new Error("Enter a public HTTPS job posting URL.");
  return url;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) &&
      !(a === 100 && b >= 64 && b <= 127) && !(a === 192 && b === 0) &&
      !(a === 192 && b === 88 && c === 99) && !(a === 192 && b === 0 && c === 2) &&
      !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) return /^(2|3)[0-9a-f]*:/i.test(address) &&
    !/^(2001:0:|2001:db8:|2002:)/i.test(address) && !address.includes(".");
  return false;
}

export function extractJobPage(html: string): string {
  const decoded = html.replace(/&(?:amp;)?(?:lt|gt|quot|#39);/gi, (value) => {
    const entity = value.toLowerCase().replace(/^&amp;/, "&");
    return ({ "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" } as Record<string, string>)[entity] ?? value;
  });
  const cleaned = decoded.replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|noscript|nav|header|footer|aside|form|svg)\b[^>]*>[^]*?<\/\1>/gi, " ");
  const main = cleaned.match(/<(main|article)\b[^>]*>([^]*?)<\/\1>/i)?.[2] ??
    cleaned.match(/<body\b[^>]*>([^]*?)<\/body>/i)?.[1] ?? cleaned;
  const text = main.replace(/<\/(p|li|h[1-6]|div|section|br)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, (entity) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const jobSection = /\b(responsibilit(?:y|ies)|qualifications?|requirements?|duties|about the role|what you.ll do)\b/i;
  const jobDetail = /\b(experience|skills?|role|position|candidate|applicant)\b/i;
  if (text.length < 250 || !jobSection.test(text) || !jobDetail.test(text))
    throw new Error("This page did not contain a readable job description. Paste the description instead.");
  return text.slice(0, 15_000);
}

export type Page = { status: number; contentType: string; body: string; location?: string; bytes?: Buffer };

export function pinnedJobLookup(address: string, family: 4 | 6): LookupFunction {
  return (_host, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

async function requestPage(url: URL, address: string, family: 4 | 6): Promise<Page> {
  return new Promise((resolve, reject) => {
    const connection = request(url, { method: "GET", timeout: 10_000, maxHeaderSize: 16_384,
      headers: { Accept: "application/json, text/html", "User-Agent": "VantSide/1.0 (job-description import)" },
      lookup: pinnedJobLookup(address, family),
    }, (response) => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) { connection.destroy(new Error("The job page is too large to import.")); return; } chunks.push(chunk); });
      response.on("end", () => { const bytes = Buffer.concat(chunks); resolve({ status: response.statusCode ?? 0, contentType: String(response.headers["content-type"] ?? ""),
        body: bytes.toString("utf8"), bytes, location: response.headers.location }); });
      response.on("error", reject);
    });
    connection.on("timeout", () => connection.destroy(new Error("The job page took too long to load.")));
    connection.on("error", reject);
    connection.end();
  });
}

export async function fetchPublicPage(value: string): Promise<Page> {
  const url = parseJobUrl(value);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("Unsafe public page destination.");
  const selected = addresses[0];
  const page = await requestPage(url, selected.address, selected.family as 4 | 6);
  if (page.status !== 200) throw new Error("Public page unavailable.");
  return page;
}

function publicBoardApi(url: URL): { url: URL; kind: "greenhouse" | "lever" | "ashby" } | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (["job-boards.greenhouse.io", "boards.greenhouse.io"].includes(url.hostname) &&
    parts.length === 3 && parts[1] === "jobs" && /^[a-z0-9-]+$/i.test(parts[0]) && /^\d+$/.test(parts[2]))
    return { url: new URL(`https://boards-api.greenhouse.io/v1/boards/${parts[0]}/jobs/${parts[2]}`), kind: "greenhouse" };
  if (["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname) && parts.length === 2 &&
    /^[a-z0-9-]+$/i.test(parts[0]) && /^[a-z0-9-]+$/i.test(parts[1]))
    return { url: new URL(`https://${url.hostname === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${parts[0]}/${parts[1]}`), kind: "lever" };
  if (url.hostname === "jobs.ashbyhq.com" && parts.length === 2 && /^[a-z0-9-]+$/i.test(parts[0]) && /^[a-z0-9-]+$/i.test(parts[1]))
    return { url: new URL(`https://api.ashbyhq.com/posting-api/job-board/${parts[0]}`), kind: "ashby" };
  return null;
}

function structuredJobText(body: string, kind: "greenhouse" | "lever" | "ashby", original: URL): string {
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw new Error("Job board data was unreadable."); }
  const object = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const posting = kind === "ashby" && Array.isArray(object.jobs)
    ? object.jobs.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).jobUrl === original.origin + original.pathname)
    : object;
  if (!posting || typeof posting !== "object") throw new Error("The job posting was not found on this board.");
  const item = posting as Record<string, unknown>;
  const title = kind === "lever" ? item.text : item.title;
  const description = kind === "greenhouse" ? item.content : kind === "lever" ? item.description : item.descriptionHtml ?? item.descriptionPlain;
  if (typeof title !== "string" || typeof description !== "string") throw new Error("The job board did not include a description.");
  return extractJobPage(`<main><h1>${title.replace(/</g, "&lt;")}</h1>${description}</main>`);
}

export async function fetchJobPosting(value: string, deps: {
  resolve?: typeof lookup; load?: (url: URL, address: string, family: 4 | 6) => Promise<Page>
} = {}): Promise<{ text: string; url: string }> {
  const original = parseJobUrl(value);
  const resolve = deps.resolve ?? lookup;
  const load = deps.load ?? requestPage;
  async function read(start: URL, expected: "html" | "json"): Promise<Page> {
    let url = start;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let addresses: Array<{ address: string; family: number }>;
      try { addresses = await resolve(url.hostname, { all: true }); }
      catch { throw new Error("This job page could not be reached. Paste the description instead."); }
      if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
        throw new Error("This job page could not be reached safely. Paste the description instead.");
      const selected = addresses[0];
      let page: Page;
      try { page = await load(url, selected.address, selected.family as 4 | 6); }
      catch (cause) { throw new Error(cause instanceof Error && /too large|too long/.test(cause.message) ? cause.message : "This job page could not be reached. Paste the description instead."); }
      if ([301, 302, 303, 307, 308].includes(page.status)) {
        if (!page.location || hop === maxRedirects) throw new Error("This job page redirected too many times.");
        url = parseJobUrl(new URL(page.location, url).href);
        continue;
      }
      if (page.status === 401 || page.status === 403) throw new Error("This job page needs sign-in. Paste the description instead.");
      if (page.status !== 200 || !page.contentType.toLowerCase().includes(expected === "json" ? "application/json" : "text/html"))
        throw new Error("This job page could not be read. Paste the description instead.");
      return page;
    }
    throw new Error("This job page redirected too many times.");
  }
  const api = publicBoardApi(original);
  if (api) {
    try { return { text: structuredJobText((await read(api.url, "json")).body, api.kind, original), url: original.href }; }
    catch { /* A public board may remove a listing or disable its API; try its readable page. */ }
  }
  return { text: extractJobPage((await read(original, "html")).body), url: original.href };
}
