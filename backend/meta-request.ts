export async function askMeta(
  instruction: string,
  content: string | Array<{ type: "text"; text: string } | { type: "file"; file: { filename: string; file_data: string } }>,
  maxTokens: number,
  fetcher: typeof fetch = fetch,
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
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return { error: "Meta could not complete this request. Please try again." };
    const upstream = await response.json();
    const raw = upstream?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return { error: "Meta returned an unreadable result. Please try again." };
    return { data: JSON.parse(raw) as unknown };
  } catch {
    return { error: "Meta could not be reached or returned unreadable data. Please try again." };
  }
}
