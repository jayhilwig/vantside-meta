import { invoke, isTauri } from "@tauri-apps/api/core";
import { emptyMemoryState, memoryStateSchema, type MemoryState } from "../../backend/career-memory";

export type StoredMemory = { state: MemoryState; revision: number | null };

export function hasDesktopStorage(): boolean {
  return typeof window !== "undefined" && isTauri();
}

export async function loadCareerMemory(): Promise<StoredMemory> {
  if (!hasDesktopStorage()) return { state: emptyMemoryState(), revision: null };
  try {
    const stored = await invoke<{ state: unknown; revision: number }>("load_career_memory");
    if (!Number.isSafeInteger(stored.revision) || stored.revision < 0) throw new Error("Invalid storage revision");
    return { state: memoryStateSchema.parse(stored.state), revision: stored.revision };
  } catch {
    throw new Error("Saved Career Memory could not be opened. No data was overwritten. Restart or restore a backup before saving again.");
  }
}

export async function saveCareerMemory(state: MemoryState, revision: number | null): Promise<number | null> {
  const valid = memoryStateSchema.parse(state);
  if (!hasDesktopStorage()) return null;
  if (revision === null) throw new Error("Career Memory was not loaded before saving.");
  try {
    return await invoke<number>("save_career_memory", { state: valid, expectedRevision: revision });
  } catch {
    throw new Error("Career Memory could not be saved. Previous saved data remains intact. Restart before retrying if another window changed it.");
  }
}
