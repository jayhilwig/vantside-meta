import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { hasDesktopStorage } from "./career-memory-storage";
import { localApiHeaders } from "./local-api-auth";
import { HudCuePreparer, type CueBatchPort, type CueCachePort } from "./hud-cue-preparation";
import type { PreparedHudCue } from "./prepared-hud-cues";

const cueSchema = z.object({ factId: z.string(), projectId: z.string(), sourceText: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), text: z.string() }).strict();
const batchSchema = z.object({ cues: z.array(z.object({ factId: z.string(), projectId: z.string(), text: z.string() }).strict()).max(12) }).strict();
const browserCache = new Map<string, PreparedHudCue>();
const cache: CueCachePort = {
  async load() {
    if (!hasDesktopStorage()) return [...browserCache.values()];
    return z.array(cueSchema).parse(await invoke("load_prepared_hud_cues"));
  },
  async save(cues) {
    if (!hasDesktopStorage()) { for (const cue of cues) browserCache.set(cue.factId, cue); return; }
    await invoke("save_prepared_hud_cues", { entries: cues });
  },
};
const generate: CueBatchPort = async (facts, signal) => {
  const response = await fetch(`${(process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "")}/prepare-hud-cues`, {
    method: "POST", headers: await localApiHeaders(), body: JSON.stringify({ facts }), signal,
  });
  if (!response.ok) throw new Error("Cue preparation unavailable");
  return batchSchema.parse(await response.json()).cues;
};

export const hudCuePreparer = new HudCuePreparer(cache, generate);
/** QA switch only; the normal path uses local prepared cues after Jev. */
export const liveMetaCueQa = process.env.NEXT_PUBLIC_HUD_LIVE_CUE_QA === "1";
