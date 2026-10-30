export function microphoneSample(level: number, streak: number): number {
  // Four consecutive 80 ms samples above the threshold avoid declaring a click or spike a pass.
  return level >= 9 ? streak + 1 : 0;
}

export function microphonePassed(streak: number): boolean { return streak >= 4; }

export function speakerPlaybackCompleted(result: "ended" | "cancelled" | "error"): boolean { return result === "ended"; }
