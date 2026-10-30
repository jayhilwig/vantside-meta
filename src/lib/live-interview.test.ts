import assert from "node:assert/strict";
import test from "node:test";
import { liveSpeakerStatus, startLiveInterview } from "./live-interview";

test("speaker status holds briefly between syllables and distinguishes user from interviewer", () => {
  assert.equal(liveSpeakerStatus(1000, 990, 980), "speaking");
  assert.equal(liveSpeakerStatus(1400, 990, 980), "speaking");
  assert.equal(liveSpeakerStatus(1500, 990, 1450), "user-speaking");
  assert.equal(liveSpeakerStatus(1800, 990, 1450), "user-speaking");
  assert.equal(liveSpeakerStatus(1900, 990, 1450), "listening");
});

function mockGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return () => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); };
}

test("microphone permission failure prevents a Live session request", async () => {
  const restoreNavigator = mockGlobal("navigator", { mediaDevices: { getUserMedia: async () => { throw new DOMException("Denied", "NotAllowedError"); } } });
  const restorePeer = mockGlobal("RTCPeerConnection", class {});
  try {
    let requested = false;
    await assert.rejects(startLiveInterview({ signal: new AbortController().signal,
      createSession: async () => { requested = true; return { sdp: "answer" }; },
      onStatus: () => {}, onLevel: () => {}, onError: () => {},
    }), { name: "NotAllowedError" });
    assert.equal(requested, false);
  } finally { restoreNavigator(); restorePeer(); }
});

test("failed session exchange stops microphone, peer, channel, player, and audio context", async () => {
  let stopped = 0; let peerClosed = 0; let channelClosed = 0; let contextClosed = 0;
  const track = { stop: () => { stopped++; }, enabled: true };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const restoreNavigator = mockGlobal("navigator", { mediaDevices: { getUserMedia: async () => stream } });
  const restoreWindow = mockGlobal("window", globalThis);
  const restorePeer = mockGlobal("RTCPeerConnection", class {
    iceGatheringState = "complete"; localDescription = { sdp: "v=0 mock offer" };
    createDataChannel() { return { readyState: "closed", close: () => { channelClosed++; } }; }
    addTrack() {} async createOffer() { return { sdp: "v=0 mock offer" }; }
    async setLocalDescription() {} close() { peerClosed++; }
  });
  const restoreAudio = mockGlobal("Audio", class { autoplay = false; srcObject = null; pause() {} });
  const restoreContext = mockGlobal("AudioContext", class {
    createAnalyser() { return { fftSize: 512 }; }
    createMediaStreamSource() { return { connect() {} }; }
    async close() { contextClosed++; }
  });
  try {
    await assert.rejects(startLiveInterview({ signal: new AbortController().signal,
      createSession: async () => { throw new Error("Session unavailable"); },
      onStatus: () => {}, onLevel: () => {}, onError: () => {},
    }), /Session unavailable/);
    assert.equal(stopped, 1); assert.equal(peerClosed, 1); assert.equal(channelClosed, 1); assert.equal(contextClosed, 1);
  } finally { restoreNavigator(); restoreWindow(); restorePeer(); restoreAudio(); restoreContext(); }
});
