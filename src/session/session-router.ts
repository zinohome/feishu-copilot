export interface RequestState {
  requestId: string;
  cancelled: boolean;
  abortController: AbortController;
}

export class SessionRouter {
  private readonly active = new Map<string, RequestState>();

  enqueue(userId: string, requestId: string): RequestState {
    const previous = this.active.get(userId);
    if (previous) {
      previous.cancelled = true;
      previous.abortController.abort();
    }

    const next: RequestState = {
      requestId,
      cancelled: false,
      abortController: new AbortController(),
    };
    this.active.set(userId, next);
    return next;
  }

  complete(userId: string, requestId: string): void {
    const current = this.active.get(userId);
    if (current && current.requestId === requestId) {
      this.active.delete(userId);
    }
  }
}
