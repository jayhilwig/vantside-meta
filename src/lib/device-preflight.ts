export type GoLivePreflight = {
  consent: boolean;
  inputMode: "microphone" | "text" | "system";
  microphoneId: string;
  speakerId: string;
  testedMicrophoneId: string | null;
  testedSpeakerId: string | null;
  microphoneTesting: boolean;
  speakerTesting: boolean;
};

export function goLiveReady(state: GoLivePreflight): boolean {
  if (state.inputMode === "system") return false;
  if (!state.consent || state.microphoneTesting) return false;
  return state.testedMicrophoneId === state.microphoneId;
}

export function systemOutputReady(consent: boolean, outputId: string, outputError: string, outputTesting: boolean): boolean {
  return consent && !!outputId && !outputError && !outputTesting;
}
