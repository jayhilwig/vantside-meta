export type SpeakerTest = { finished: Promise<"ended" | "cancelled">; stop(): void };

export function startSpeakerTest(outputId = "", createAudio: () => HTMLAudioElement = () => new Audio("/speaker-test.mp3")): SpeakerTest {
  const audio = createAudio();
  let stopped = false;
  let settle!: (result: "ended" | "cancelled") => void;
  let fail!: (cause: Error) => void;
  const playback = new Promise<"ended" | "cancelled">((resolve, reject) => { settle = resolve; fail = reject; });
  void playback.catch(() => undefined);
  audio.onended = () => settle("ended");
  audio.onpause = () => settle("cancelled");
  audio.onerror = () => fail(new Error("Speaker test audio could not play."));
  const finished = (async () => {
    try {
      if (outputId) {
        if (typeof audio.setSinkId !== "function") throw new Error("Output selection is unavailable in this desktop WebView. Use the system output.");
        await audio.setSinkId(outputId);
      }
      if (stopped) return "cancelled" as const;
      await audio.play();
      if (stopped) return "cancelled" as const;
      return await playback;
    } finally {
      audio.pause(); audio.removeAttribute("src");
      audio.onended = null; audio.onpause = null; audio.onerror = null;
    }
  })();
  return { finished, stop() { if (stopped) return; stopped = true; audio.pause(); settle("cancelled"); } };
}
