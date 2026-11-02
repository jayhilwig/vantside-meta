// Candidate speech only. This buffer never writes audio or transcripts to storage.
export const MAX_LIVE_EVIDENCE_CHARS = 120_000;
export const LIVE_EXTRACTION_CHARS = 16_000;
const CHUNK_OVERLAP = 300;
const SPEECH_SEGMENT_GAP_MS = 1_500;

export type LiveEvidenceStats = { characters: number; transcriptEvents: number; estimatedSpeechSegments: number };

export class LiveEvidenceBuffer {
  private fragments: string[] = [];
  private count = 0;
  private capped = false;
  private transcriptEvents = 0;
  private estimatedSpeechSegments = 0;
  private lastTimedEnd: number | null = null;

  append(delta: string, startMs?: number, endMs?: number): boolean {
    if (!delta || this.capped) return this.capped;
    this.transcriptEvents++;
    // GPT-Live deltas do not mark completed turns. Timeline gaps only estimate speech segments.
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs! >= startMs!) {
      if (this.lastTimedEnd === null || startMs! - this.lastTimedEnd >= SPEECH_SEGMENT_GAP_MS) this.estimatedSpeechSegments++;
      this.lastTimedEnd = Math.max(this.lastTimedEnd ?? 0, endMs!);
    }
    const remaining = MAX_LIVE_EVIDENCE_CHARS - this.count;
    const retained = delta.slice(0, remaining);
    if (retained) { this.fragments.push(retained); this.count += retained.length; }
    this.capped = retained.length < delta.length || this.count === MAX_LIVE_EVIDENCE_CHARS;
    return this.capped;
  }

  text(): string { return this.fragments.join(""); }
  length(): number { return this.count; }
  stats(): LiveEvidenceStats { return { characters: this.count, transcriptEvents: this.transcriptEvents,
    estimatedSpeechSegments: this.estimatedSpeechSegments }; }
}

export type LiveEvidenceDeduplication = { candidates: LiveEvidenceProposal[]; alreadyApproved: number;
  alreadyPending: number; repeatedInExtraction: number };

const normalizedFact = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function deduplicateLiveProposals(proposals: LiveEvidenceProposal[], approved: string[], pending: string[]): LiveEvidenceDeduplication {
  const approvedKeys = new Set(approved.map(normalizedFact));
  const pendingKeys = new Set(pending.map(normalizedFact));
  const seen = new Set<string>();
  const result: LiveEvidenceDeduplication = { candidates: [], alreadyApproved: 0, alreadyPending: 0, repeatedInExtraction: 0 };
  for (const proposal of proposals) {
    const key = normalizedFact(proposal.text);
    if (approvedKeys.has(key)) result.alreadyApproved++;
    else if (pendingKeys.has(key)) result.alreadyPending++;
    else if (seen.has(key)) result.repeatedInExtraction++;
    else { seen.add(key); result.candidates.push(proposal); }
  }
  return result;
}

export function liveEvidenceChunks(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const limit = Math.min(start + LIVE_EXTRACTION_CHARS, text.length);
    let end = limit;
    if (limit < text.length) {
      const boundary = text.lastIndexOf(" ", limit - 1);
      if (boundary > start + LIVE_EXTRACTION_CHARS * .75) end = boundary + 1;
    }
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

export type LiveEvidenceProposal = { title: string; text: string; source: string };

export async function extractLiveEvidenceProposals(text: string,
  requestChunk: (chunk: string) => Promise<LiveEvidenceProposal[]>): Promise<LiveEvidenceProposal[]> {
  const proposals: LiveEvidenceProposal[] = [];
  for (const chunk of liveEvidenceChunks(text)) proposals.push(...await requestChunk(chunk));
  return proposals;
}
