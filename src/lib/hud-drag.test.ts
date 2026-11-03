import assert from "node:assert/strict";
import test from "node:test";
import { canDragHudHeader } from "./hud-drag";

test("HUD header drag accepts noninteractive text and empty space but not controls", () => {
  const noninteractive = { closest: () => null } as unknown as Element;
  const control = { closest: () => ({}) } as unknown as Element;
  assert.equal(canDragHudHeader(0, noninteractive), true);
  assert.equal(canDragHudHeader(0, control), false);
  assert.equal(canDragHudHeader(2, noninteractive), false);
  assert.equal(canDragHudHeader(0, null), false);
});
