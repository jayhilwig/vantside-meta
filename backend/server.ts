import { createServer } from "node:http";
import { createCue } from "./cue-handler";

const host = "127.0.0.1";
const port = Number(process.env.CUE_API_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CUE_API_PORT must be a valid local port.");
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]);
const maxBodyBytes = 2048;
const maxPerMinute = 10;
const maxPerDay = 100;
const recentRequests: number[] = [];
let day = new Date().toISOString().slice(0, 10);
let dailyCount = 0;
let inFlight = 0;

function send(response: import("node:http").ServerResponse, status: number, body: object) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (!origin || !allowedOrigins.has(origin)) {
    send(response, 403, { error: "This practice API only accepts the local VantSide app." });
    return;
  }
  if (request.method === "OPTIONS" && request.url === "/cue") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/cue") {
    send(response, 404, { error: "Not found." });
    return;
  }
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    send(response, 415, { error: "Send JSON." });
    return;
  }
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) { day = today; dailyCount = 0; }
  while (recentRequests.length && recentRequests[0] < now - 60_000) recentRequests.shift();
  if (recentRequests.length >= maxPerMinute || dailyCount >= maxPerDay || inFlight >= 1) {
    send(response, 429, { error: "Practice request limit reached. Please try again later." });
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        send(response, 413, { error: "Practice question is too long." });
        return;
      }
      chunks.push(chunk);
    }
  } catch {
    send(response, 400, { error: "Could not read the question." });
    return;
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
  recentRequests.push(now);
  dailyCount++;
  inFlight++;
  try {
    const result = await createCue(body);
    send(response, result.status, result.body);
  } catch {
    send(response, 502, { error: "Cue generation failed. Please try again." });
  } finally {
    inFlight--;
  }
});

server.requestTimeout = 35_000;
server.listen(port, host, () => {
  console.log(`VantSide practice API listening on http://${host}:${port}`);
});
