import { z } from "zod";
import { fetchPublicPage, parseJobUrl, type Page } from "./job-posting-url";

const input = z.object({ company: z.string().trim().min(2).max(100), sourceUrl: z.string().max(2000).optional(), sourceText: z.string().max(15000).optional() }).strict();

export async function companyBrand(body: unknown, read: (url: string) => Promise<Page> = fetchPublicPage) {
  const parsed = input.safeParse(body);
  if (!parsed.success) return { status: 400, body: {} };
  try {
    const slug = parsed.data.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    const source = parsed.data.sourceUrl ? parseJobUrl(parsed.data.sourceUrl) : null;
    const job = source ? await read(source.href) : null;
    if (job && !job.contentType.includes("text/html")) return { status: 200, body: {} };
    const links = [...(job?.body ?? parsed.data.sourceText ?? "").matchAll(/https:\/\/[a-z0-9.-]+(?:\/[a-z0-9._~!$&'()*+,;=:@%\/?#-]*)?/gi)].map((item) => item[0]);
    const official = links.map((value) => { try { return parseJobUrl(value); } catch { return null; } }).find((url) =>
      url && url.hostname.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, "") === slug);
    if (!official) return { status: 200, body: {} };
    const website = new URL("/", official);
    const home = await read(website.href);
    if (!home.contentType.includes("text/html")) return { status: 200, body: {} };
    const iconHref = home.body.match(/<link\b(?=[^>]*rel=["']icon["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i)?.[1];
    const icon = parseJobUrl(new URL(iconHref || "/favicon.ico", website).href);
    const image = await read(icon.href);
    const declared = image.contentType.split(";")[0].toLowerCase();
    const mime = declared === "binary/octet-stream" && image.bytes?.subarray(0, 4).toString() === "RIFF" &&
      image.bytes?.subarray(8, 12).toString() === "WEBP" ? "image/webp" : declared;
    if (!image.bytes || image.bytes.length > 80_000 || !["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/webp"].includes(mime)) return { status: 200, body: {} };
    return { status: 200, body: { logoDataUrl: `data:${mime};base64,${image.bytes.toString("base64")}` } };
  } catch { return { status: 200, body: {} }; }
}
