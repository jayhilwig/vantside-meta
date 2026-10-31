import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000",
  "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]);

export function localTokenPath() {
  const root = process.platform === "win32" ? process.env.LOCALAPPDATA
    : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
      : process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  if (!root) throw new Error("App-local data directory is unavailable.");
  return join(root, "com.vantside.meta", "local-api-token");
}

export function loadLocalToken(path = localTokenPath()): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { writeFileSync(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Local API token is invalid. Restart the backend after repairing app-local data.");
  return token;
}

export function authorized(origin: string | undefined, supplied: string | undefined, token: string): boolean {
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const acceptedOrigin = origin === undefined || origin === "null" || allowedOrigins.has(origin);
  return acceptedOrigin && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}

export function authorizationFailure(origin: string | undefined, supplied: string | undefined, token: string): "untrusted-origin" | "missing-token" | "invalid-token" | null {
  if (origin !== undefined && origin !== "null" && !allowedOrigins.has(origin)) return "untrusted-origin";
  if (!supplied) return "missing-token";
  return authorized(origin, supplied, token) ? null : "invalid-token";
}

export function preflightOrigin(origin: string | undefined): boolean {
  return !!origin && (origin === "null" || allowedOrigins.has(origin));
}

export function validLoopbackHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
