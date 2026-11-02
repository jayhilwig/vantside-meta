export function goLiveAudioHealth(elapsedMs: number, packets: number, voiced: boolean, segments: number, sinceLastPacketMs = 0): string {
  if (elapsedMs < 3_000) return "";
  if (packets === 0 || sinceLastPacketMs > 3_000) return "No playback audio received recently. If Media Player is playing, check the selected output.";
  if (segments > 0) return "";
  if (!voiced) return "Playback is arriving, but no speech was detected. Check its volume and output device.";
  return "Speech detected. Waiting for a pause to complete the question.";
}
