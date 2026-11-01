import assert from "node:assert/strict";
import test from "node:test";
import { startSpeakerTest } from "./speaker-test";

function audioFixture() {
  let played = 0; let paused = 0; let cleared = 0;
  const audio = {
    onended: null as null | (() => void), onpause: null as null | (() => void), onerror: null as null | (() => void),
    async play() { played++; }, pause() { paused++; this.onpause?.(); },
    removeAttribute(name: string) { if (name === "src") cleared++; },
  };
  return { audio, counts: () => ({ played, paused, cleared }) };
}

test("speaker test completes only when playback ends and releases the audio element", async () => {
  const fixture = audioFixture();
  const session = startSpeakerTest("", () => fixture.audio as unknown as HTMLAudioElement);
  await Promise.resolve();
  fixture.audio.onended?.();
  assert.equal(await session.finished, "ended");
  assert.deepEqual(fixture.counts(), { played: 1, paused: 1, cleared: 1 });
  assert.equal(fixture.audio.onended, null);
});

test("Stop cancels playback immediately and never reports completion", async () => {
  const fixture = audioFixture();
  const session = startSpeakerTest("", () => fixture.audio as unknown as HTMLAudioElement);
  await Promise.resolve();
  session.stop();
  assert.equal(await session.finished, "cancelled");
  assert.equal(fixture.counts().played, 1);
  assert.equal(fixture.counts().cleared, 1);
});

test("Stop during output selection prevents playback", async () => {
  const fixture = audioFixture();
  let release!: () => void;
  const audio = { ...fixture.audio, setSinkId: () => new Promise<void>((resolve) => { release = resolve; }) };
  const session = startSpeakerTest("speaker-1", () => audio as unknown as HTMLAudioElement);
  session.stop(); release();
  assert.equal(await session.finished, "cancelled");
  assert.equal(fixture.counts().played, 0);
});

test("playback failure rejects and releases the audio element", async () => {
  const fixture = audioFixture();
  const audio = { ...fixture.audio, play: async () => { throw new Error("Playback blocked"); } };
  const session = startSpeakerTest("", () => audio as unknown as HTMLAudioElement);
  await assert.rejects(session.finished, /Playback blocked/);
  assert.equal(fixture.counts().cleared, 1);
});
