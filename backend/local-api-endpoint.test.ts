import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real loopback endpoint routes all three modes only for an authorized local app", { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "vantside-endpoint-"));
  const port = 19000 + Math.floor(Math.random() * 20000);
  const env: NodeJS.ProcessEnv = { ...process.env, LOCALAPPDATA: root, CUE_API_PORT: String(port) };
  delete env.MODEL_API_KEY; delete env.BASETEN_API_KEY;
  const backend = spawn(process.execPath, ["--import", "tsx", "backend/server.ts"], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Local backend did not start.")), 7000);
      backend.stdout.on("data", (chunk: Buffer) => { if (chunk.toString().includes("practice API listening")) { clearTimeout(timer); resolve(); } });
      backend.on("exit", () => { clearTimeout(timer); reject(new Error("Local backend exited before listening.")); });
    });
    const token = readFileSync(join(root, "com.vantside.meta", "local-api-token"), "utf8").trim();
    const call = (origin: string, body: object, supplied = token, route = "/analyze-opportunity") => fetch(`http://127.0.0.1:${port}${route}`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-VantSide-Session": supplied }, body: JSON.stringify(body),
    });
    // Resume PDF and both Step 3 modes use this same authenticated transport.
    const resume = await call("http://tauri.localhost", { filename: "resume.pdf", data: "bad" }, token, "/extract-resume");
    assert.notEqual(resume.status, 403);
    assert.equal((await call("http://tauri.localhost", { text: "short", careerFacts: [] })).status, 400);
    const pdfAsText = await call("http://tauri.localhost", { text: "short", careerFacts: [] });
    assert.equal(pdfAsText.status, 400);
    assert.notEqual((await pdfAsText.json() as { error?: string }).error, "This practice API only accepts the local VantSide app.");
    const missingOrigin = await fetch(`http://127.0.0.1:${port}/analyze-opportunity`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-VantSide-Session": token },
      body: JSON.stringify({ text: "short", careerFacts: [] }),
    });
    assert.equal(missingOrigin.status, 400);
    const missingToken = await fetch(`http://127.0.0.1:${port}/analyze-opportunity`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "short", careerFacts: [] }),
    });
    assert.equal(missingToken.status, 403);
    assert.deepEqual(await missingToken.json(), { error: "This practice API only accepts the local VantSide app." });
    assert.equal((await call("null", { url: "http://example.com/job", careerFacts: [] })).status, 422);
    const urlImport = await call("http://tauri.localhost", { url: "http://127.0.0.1/private" }, token, "/extract-job-url");
    assert.equal(urlImport.status, 422);
    assert.notEqual((await urlImport.json() as { error?: string }).error, "This practice API only accepts the local VantSide app.");
    assert.equal((await call("https://evil.example", { url: "https://example.com/job" }, token, "/extract-job-url")).status, 403);
    assert.equal((await call("http://tauri.localhost", { filename: "bad.pdf", data: "bad", careerFacts: [] })).status, 400);
    const preflight = await fetch(`http://127.0.0.1:${port}/analyze-opportunity`, { method: "OPTIONS", headers: {
      Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-vantside-session",
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "null");
    assert.equal((await call("https://evil.example", { text: "short", careerFacts: [] })).status, 403);
    assert.equal((await call("http://tauri.localhost", { text: "short", careerFacts: [] }, "0".repeat(64))).status, 403);
  } finally {
    backend.kill();
    await new Promise((resolve) => { if (backend.exitCode !== null) resolve(undefined); else backend.once("exit", resolve); });
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
  }
});
