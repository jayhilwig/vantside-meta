// Candidate speech only. This buffer never writes audio or transcripts to storage.
export const MAX_LIVE_EVIDENCE_CHARS = 120_000;
export const LIVE_EXTRACTION_CHARS = 16_000;
const CHUNK_OVERLAP = 300;

export class LiveEvidenceBuffer {
  private fragments: string[] = [];
  private count = 0;
  private capped = false;

  append(delta: string): boolean {
    if (!delta || this.capped) return this.capped;
    const remaining = MAX_LIVE_EVIDENCE_CHARS - this.count;
    const retained = delta.slice(0, remaining);
    if (retained) { this.fragments.push(retained); this.count += retained.length; }
    this.capped = retained.length < delta.length || this.count === MAX_LIVE_EVIDENCE_CHARS;
    return this.capped;
  }

  text(): string { return this.fragments.join(""); }
  length(): number { return this.count; }
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
