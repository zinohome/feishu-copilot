export type CardFlushReason = 'throttle' | 'final';

export interface CardRendererOptions {
  throttleMs?: number;
  onFlush?: (text: string, reason: CardFlushReason) => void;
}

export class CardRenderer {
  private readonly throttleMs: number;
  private readonly onFlush?: (text: string, reason: CardFlushReason) => void;
  private text = '';
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private isFinalized = false;

  constructor(options: CardRendererOptions = {}) {
    this.throttleMs = Math.max(0, options.throttleMs ?? 0);
    this.onFlush = options.onFlush;
  }

  pushChunk(chunk: string): void {
    if (this.isFinalized) {
      throw new Error('CardRenderer is already finalized');
    }

    if (!chunk) {
      return;
    }

    this.text += chunk;
    this.scheduleThrottleFlush();
  }

  finalize(): string {
    this.isFinalized = true;

    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    this.onFlush?.(this.text, 'final');
    return this.text;
  }

  private scheduleThrottleFlush(): void {
    if (!this.onFlush || this.throttleMs <= 0 || this.throttleTimer) {
      return;
    }

    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.onFlush?.(this.text, 'throttle');
    }, this.throttleMs);
  }
}
