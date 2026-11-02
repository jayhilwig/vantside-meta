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
  if (!apiKey || !baseUrl || !model) return { error: "Meta is not configured on the local backend.", failure: "configuration" as const };
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
      return { failure: "http" as const, error: response.status === 401 || response.status === 403 ? "Meta rejected the local API credentials. Check .env.local and restart the backend."
        : response.status === 429 ? "Meta is rate limiting requests. Wait a moment and try again."
        : response.status >= 500 ? "Meta is temporarily unavailable. Try again shortly."
        : "Meta rejected this request. Check the local backend configuration." };
    }
    let upstream: unknown;
    try { upstream = await response.json(); }
    catch { console.warn("Meta request failed", { stage: "response-json" }); return { error: "Meta returned an unreadable response. Try again.", failure: "response-json" as const }; }
    const choice = (upstream as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
    const raw = choice?.message?.content;
    const truncated = choice?.finish_reason === "length";
    if (typeof raw !== "string" || !raw.trim()) { console.warn("Meta request failed", { stage: "missing-content", truncated }); return { error: "Meta returned no answer. Try again.", failure: "malformed-content" as const, truncated }; }
    if (truncated) { console.warn("Meta request failed", { stage: "content-truncated" }); return { error: "Meta returned an incomplete answer. Try again.", failure: "malformed-content" as const, truncated }; }
    try { return { data: JSON.parse(raw) as unknown }; }
    catch { console.warn("Meta request failed", { stage: "content-json", truncated }); return { error: "Meta returned an unreadable answer. Try again.", failure: "malformed-content" as const, truncated }; }
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "unknown";
    const code = cause instanceof Error && cause.cause && typeof cause.cause === "object" && "code" in cause.cause ? String(cause.cause.code) : undefined;
    console.warn("Meta request failed", { stage: name === "TimeoutError" ? "timeout" : name === "AbortError" ? "cancelled" : "connection", code: code?.slice(0, 32) });
    return { failure: name === "TimeoutError" ? "timeout" as const : name === "AbortError" ? "cancelled" as const : "connection" as const,
      error: name === "TimeoutError" ? "Meta took too long to respond. Try again."
      : name === "AbortError" ? "Meta request was cancelled."
      : code === "ENOTFOUND" ? "The Meta server could not be found. Check your internet connection and DNS."
      : "Meta could not be reached. Check your internet connection and try again." };
  }
}
