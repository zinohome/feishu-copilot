export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export class ApprovalGate {
  private readonly states = new Map<string, ApprovalStatus>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  request(id: string, timeoutMs?: number): void {
    this.clearTimer(id);
    this.states.set(id, 'pending');

    if (timeoutMs === undefined) {
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(id);
      if (this.states.get(id) === 'pending') {
        this.states.set(id, 'denied');
      }
    }, timeoutMs);
    this.timers.set(id, timer);
  }

  approve(id: string): void {
    this.clearTimer(id);
    this.states.set(id, 'approved');
  }

  deny(id: string): void {
    this.clearTimer(id);
    this.states.set(id, 'denied');
  }

  status(id: string): ApprovalStatus | undefined {
    return this.states.get(id);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.timers.delete(id);
  }
}
