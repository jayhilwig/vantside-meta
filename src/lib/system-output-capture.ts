import { Channel, invoke } from "@tauri-apps/api/core";

export type SystemOutput = { id: string; name: string; isDefault: boolean };
export type CaptureInfo = { outputId: string; outputName: string; sampleRate: 24000 };

export function listSystemOutputs(): Promise<SystemOutput[]> {
  return invoke<SystemOutput[]>("list_system_outputs");
}

export function startSystemOutputCapture(outputId: string, onAudio: (samples: Int16Array) => void,
  onError: (message: string) => void): Promise<CaptureInfo> {
  const audio = new Channel<number[]>();
  audio.onmessage = (samples) => { if (Array.isArray(samples) && samples.length <= 48_000)
    onAudio(Int16Array.from(samples)); };
  const errors = new Channel<string>();
  errors.onmessage = (message) => onError(typeof message === "string" ? message : "Windows output capture stopped.");
  return invoke<CaptureInfo>("start_system_output_capture", { outputId, onAudio: audio, onError: errors });
}

export function stopSystemOutputCapture(): Promise<void> {
  return invoke("stop_system_output_capture");
}
