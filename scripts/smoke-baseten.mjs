// Explicitly invoked only; never prints credentials or model output.
const key = process.env.BASETEN_API_KEY;
if (!key) { console.log("Baseten smoke skipped: BASETEN_API_KEY is absent."); process.exit(0); }
try {
  const response = await fetch("https://inference.baseten.co/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "meta-models/muse-spark-open", max_tokens: 12,
      messages: [{ role: "user", content: "Reply OK." }] }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (typeof data?.choices?.[0]?.message?.content !== "string") throw new Error("Missing text response");
  console.log(`Baseten smoke succeeded; prompt tokens: ${data.usage?.prompt_tokens ?? "unreported"}; completion tokens: ${data.usage?.completion_tokens ?? "unreported"}.`);
} catch (error) {
  console.error(`Baseten smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
