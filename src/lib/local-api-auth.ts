import { invoke, isTauri } from "@tauri-apps/api/core";

let cachedToken: Promise<string> | null = null;

export async function localApiHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined" || !isTauri()) throw new Error("Open VantSide in the desktop app to use the local AI backend.");
  cachedToken ??= invoke<string>("read_local_api_token").catch(() => {
    cachedToken = null;
    throw new Error("Start or restart the local backend, then try again.");
  });
  return { "Content-Type": "application/json", "X-VantSide-Session": await cachedToken };
}
