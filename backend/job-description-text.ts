import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Compare words rather than byte-for-byte spacing: PDF text items often split a line
// across separate drawing commands, and wrapped lines may include a soft hyphen.
export function sourceWords(value: string): string[] {
  return (value.normalize("NFKC").replace(/\u00ad/g, "").replace(/-\s*\n\s*/g, "")
    .toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

export function hasSourceQuote(content: string, excerpt: string): boolean {
  const haystack = sourceWords(content);
  const quote = sourceWords(excerpt);
  if (!quote.length) return false;
  return haystack.some((word, start) => word === quote[0] && quote.every((part, index) => haystack[start + index] === part));
}

export async function extractJobPdfText(bytes: Uint8Array, onExtract?: (stats: { pages: number; characters: number; words: number }) => void): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true });
  const document = await task.promise;
  try {
    if (document.numPages > 30) throw new Error("This PDF is too long to analyze.");
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      let previousY: number | undefined;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (previousY !== undefined && Math.abs(y - previousY) > 2) text += "\n";
        else if (text && !text.endsWith("\n")) text += " ";
        text += item.str;
        if (item.hasEOL) text += "\n";
        previousY = item.hasEOL ? undefined : y;
      }
      pages.push(text.trim());
    }
    const extracted = pages.join("\n").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    const words = sourceWords(extracted).length;
    onExtract?.({ pages: document.numPages, characters: extracted.length, words });
    if (words < 30) throw new Error("We couldn't read enough text from this PDF. Try a text-based PDF or paste the description.");
    return extracted.slice(0, 15_000);
  } finally { await task.destroy(); }
}
