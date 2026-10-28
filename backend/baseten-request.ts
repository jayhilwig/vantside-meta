// Baseten is opt-in for opportunity text only. Other Meta paths remain unchanged.
export const BASETEN_MODEL = "meta-models/muse-spark-open";
const BASETEN_URL = "https://inference.baseten.co/v1/chat/completions";

export async function askBasetenOpportunity(instruction: string, content: string, fetcher: typeof fetch = fetch) {
  const key = process.env.BASETEN_API_KEY;
  if (!key) return { error: "Baseten is not configured." };
  try {
    const response = await fetcher(BASETEN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: BASETEN_MODEL, max_tokens: 220, temperature: 0,
        messages: [{ role: "developer", content: instruction }, { role: "user", content }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return { error: "Baseten could not complete the opportunity analysis. Please try again." };
    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return { error: "Baseten returned an unreadable result." };
    return { data: JSON.parse(raw) as unknown };
  } catch {
    return { error: "Baseten could not be reached or returned unreadable data." };
  }
}
