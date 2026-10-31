// Keep PDF bytes in the desktop process. The extracted text follows the same
// opportunity request as a description pasted by the user.
export async function readJobPdfText(file: File): Promise<string> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof window !== "undefined") pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
    const { extractJobPdfText } = await import("../../backend/job-description-text");
    return await extractJobPdfText(new Uint8Array(await file.arrayBuffer()), (stats) => {
      console.info("Job PDF text extracted", stats);
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("We couldn't read enough text")) throw cause;
    throw new Error("We couldn't read this PDF locally. Try another text-based PDF or paste the description.");
  }
}
