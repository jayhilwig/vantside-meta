import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("HUD close-request lifecycle has destroy permission only in the HUD window", () => {
  const capability = (name: string) => JSON.parse(readFileSync(`src-tauri/capabilities/${name}.json`, "utf8"));
  assert.deepEqual(capability("hud").windows, ["hud"]);
  assert.ok(capability("hud").permissions.includes("core:window:allow-destroy"));
  assert.ok(!capability("default").permissions.includes("core:window:allow-destroy"));
});
