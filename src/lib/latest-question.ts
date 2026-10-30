export class LatestQuestion<T> {
  private sequence = 0;
  private controller: AbortController | null = null;

  get running() { return this.controller !== null; }

  cancel() {
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
  }

  async run(work: (signal: AbortSignal) => Promise<T>, onResult: (result: T) => void,
    onFailure: (error: unknown) => void) {
    this.cancel();
    const sequence = this.sequence;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const result = await work(controller.signal);
      if (this.sequence === sequence && !controller.signal.aborted) onResult(result);
    } catch (error) {
      if (this.sequence === sequence && !controller.signal.aborted) onFailure(error);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}
