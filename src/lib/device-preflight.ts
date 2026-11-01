export type GoLivePreflight = {
  consent: boolean;
  inputMode: "microphone" | "text";
  microphoneId: string;
  speakerId: string;
  testedMicrophoneId: string | null;
  testedSpeakerId: string | null;
  microphoneTesting: boolean;
  speakerTesting: boolean;
};

export function goLiveReady(state: GoLivePreflight): boolean {
  if (!state.consent || state.microphoneTesting || state.speakerTesting) return false;
  return state.testedMicrophoneId === state.microphoneId && state.testedSpeakerId === state.speakerId;
}
