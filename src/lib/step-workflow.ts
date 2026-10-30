export function visibleStepError(error: string, owner: number, activeStep: number): string {
  return owner === activeStep ? error : "";
}

export function isCurrentOperation(started: number, current: number, signal?: AbortSignal): boolean {
  return started === current && !signal?.aborted;
}
