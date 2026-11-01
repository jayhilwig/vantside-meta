// GPT-Live transcript punctuation is not guaranteed. Only assistant output is passed here;
// the caller must never use candidate input-transcript events for cue detection.
export function detectInterviewerQuestion(utterance: string): string | null {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (text.length < 20 || text.length > 500) return null;
  const parts = text.split(/(?<=[.!?])\s+/);
  const question = [...parts].reverse().find((part) => /\?$/.test(part) ||
    /^(?:who|what|when|where|why|how|which|can|could|would|did|do|does|have|has|is|are|were|was)\b/i.test(part) ||
    /^(?:tell me(?: more)? about|walk me through|talk me through|take me through|describe|share (?:an? )?(?:example|time)|give me an example|explain)\b/i.test(part));
  return question && question.length >= 20 ? question : null;
}
