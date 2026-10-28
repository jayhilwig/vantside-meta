export type AnswerRecorder = { finish: () => string; discard: () => void };

export async function startAnswerRecording(signal: AbortSignal, deviceId?: string): Promise<AnswerRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is not available in this Windows WebView.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
  if (signal.aborted) { stream.getTracks().forEach((track) => track.stop()); throw new Error("Recording stopped."); }
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    await context.resume();
    if (signal.aborted) throw new Error("Recording stopped.");
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    let total = 0;
    let stopped = false;
    processor.onaudioprocess = (event) => {
      if (stopped) return;
      const samples = event.inputBuffer.getChannelData(0);
      if (total + samples.length <= context!.sampleRate * 60) { chunks.push(new Float32Array(samples)); total += samples.length; }
    };
    source.connect(processor);
    processor.connect(context.destination);

    function close() {
      if (stopped) return false;
      stopped = true;
      processor.onaudioprocess = null;
      processor.disconnect(); source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context?.close();
      return true;
    }
    signal.addEventListener("abort", () => { close(); chunks.length = 0; }, { once: true });

    return {
      discard: () => { close(); chunks.length = 0; },
      finish: () => {
        if (!close() || total < context!.sampleRate / 2) { chunks.length = 0; throw new Error("Record at least half a second, then finish your answer."); }
        const input = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
        chunks.length = 0;
        const targetRate = 16_000;
        const count = Math.floor(input.length * targetRate / context!.sampleRate);
        const wav = new ArrayBuffer(44 + count * 2);
        const view = new DataView(wav);
        const write = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
        write(0, "RIFF"); view.setUint32(4, wav.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data");
        view.setUint32(40, count * 2, true);
        for (let i = 0; i < count; i++) {
          const position = i * context!.sampleRate / targetRate;
          const index = Math.floor(position);
          const sample = input[index] + (input[Math.min(index + 1, input.length - 1)] - input[index]) * (position - index);
          view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
        }
        input.fill(0);
        const bytes = new Uint8Array(wav);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32_768) binary += String.fromCharCode(...bytes.subarray(i, i + 32_768));
        return btoa(binary);
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    if (context) void context.close();
    throw error;
  }
}
