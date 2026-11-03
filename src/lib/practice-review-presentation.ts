export type ReviewPhase = "idle" | "finalizing" | "analyzing";

export function practiceReviewPresentation(status: string, phase: ReviewPhase) {
  return { navigationLocked: status === "reviewing",
    detail: phase === "finalizing" ? "Finishing your transcript…" : "Reviewing your responses and preparing feedback…" };
}
