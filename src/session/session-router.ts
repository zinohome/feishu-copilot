export interface RequestState {
  requestId: string;
  cancelled: boolean;
}

export class SessionRouter {
  private readonly active = new Map<string, RequestState>();

  enqueue(userId: string, requestId: string): RequestState {
    const previous = this.active.get(userId);
    if (previous) {
      previous.cancelled = true;
    }

    const next: RequestState = {
      requestId,
      cancelled: false,
    };
    this.active.set(userId, next);
    return next;
  }
}
