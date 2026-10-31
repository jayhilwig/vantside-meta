import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizationFailure, authorized, loadLocalToken, preflightOrigin, validLoopbackHost } from "./local-api-auth";

test("Tauri origins and opaque Tauri requests need the per-install token", () => {
  const dir = mkdtempSync(join(tmpdir(), "vantside-local-auth-"));
  try {
    const token = loadLocalToken(join(dir, "local-api-token"));
    assert.equal(loadLocalToken(join(dir, "local-api-token")), token);
    assert.equal(authorized("http://tauri.localhost", token, token), true);
    assert.equal(authorized("http://localhost:3000", token, token), true);
    assert.equal(authorized("null", token, token), true);
    assert.equal(authorized(undefined, token, token), true);
    assert.equal(authorized("https://evil.example", token, token), false);
    assert.equal(authorized("null", undefined, token), false);
    assert.equal(authorized("http://tauri.localhost", "0".repeat(64), token), false);
    assert.equal(authorizationFailure(undefined, undefined, token), "missing-token");
    assert.equal(authorizationFailure(undefined, "0".repeat(64), token), "invalid-token");
    assert.equal(authorizationFailure(undefined, token, token), null);
    assert.equal(authorizationFailure("https://evil.example", token, token), "untrusted-origin");
    assert.equal(preflightOrigin("https://evil.example"), false);
    assert.equal(preflightOrigin("null"), true);
    assert.equal(validLoopbackHost("127.0.0.1:8787", 8787), true);
    assert.equal(validLoopbackHost("evil.example:8787", 8787), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
