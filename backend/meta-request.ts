export async function askMeta(
  instruction: string,
  content: string | Array<{ type: "text"; text: string } | { type: "file"; file: { filename: string; file_data: string } }>,
  maxTokens: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const apiKey = process.env.MODEL_API_KEY;
  const baseUrl = process.env.META_API_BASE_URL;
  const model = process.env.META_MODEL;
  if (!apiKey || !baseUrl || !model) return { error: "Meta is not configured on the local backend." };
  try {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, reasoning_effort: "minimal", max_completion_tokens: maxTokens,
        response_format: { type: "json_object" }, store: false,
        messages: [{ role: "developer", content: instruction }, { role: "user", content }] }),
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      console.warn("Meta request failed", { stage: "http", status: response.status });
      return { error: response.status === 401 || response.status === 403 ? "Meta rejected the local API credentials. Check .env.local and restart the backend."
        : response.status === 429 ? "Meta is rate limiting requests. Wait a moment and try again."
        : response.status >= 500 ? "Meta is temporarily unavailable. Try again shortly."
        : "Meta rejected this request. Check the local backend configuration." };
    }
    let upstream: unknown;
    try { upstream = await response.json(); }
    catch { console.warn("Meta request failed", { stage: "response-json" }); return { error: "Meta returned an unreadable response. Try again." }; }
    const raw = (upstream as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || !raw.trim()) { console.warn("Meta request failed", { stage: "missing-content" }); return { error: "Meta returned no answer. Try again." }; }
    try { return { data: JSON.parse(raw) as unknown }; }
    catch { console.warn("Meta request failed", { stage: "content-json" }); return { error: "Meta returned an unreadable answer. Try again." }; }
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "unknown";
    const code = cause instanceof Error && cause.cause && typeof cause.cause === "object" && "code" in cause.cause ? String(cause.cause.code) : undefined;
    console.warn("Meta request failed", { stage: name === "TimeoutError" ? "timeout" : name === "AbortError" ? "cancelled" : "connection", code: code?.slice(0, 32) });
    return { error: name === "TimeoutError" ? "Meta took too long to respond. Try again."
      : code === "ENOTFOUND" ? "The Meta server could not be found. Check your internet connection and DNS."
      : "Meta could not be reached. Check your internet connection and try again." };
  }
}
