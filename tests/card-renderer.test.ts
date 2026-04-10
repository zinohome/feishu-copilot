import { describe, expect, it, vi } from 'vitest';
import { CardRenderer } from '../src/card/card-renderer';

describe('CardRenderer', () => {
  it('accumulates chunks and returns full text in finalize', () => {
    const renderer = new CardRenderer();

    renderer.pushChunk('Hello');
    renderer.pushChunk(', ');
    renderer.pushChunk('world');

    expect(renderer.finalize()).toBe('Hello, world');
  });

  it('supports minimal throttled flush and final flush', () => {
    vi.useFakeTimers();

    const flushSpy = vi.fn();
    const renderer = new CardRenderer({ throttleMs: 100, onFlush: flushSpy });

    renderer.pushChunk('A');
    renderer.pushChunk('B');

    expect(flushSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenNthCalledWith(1, 'AB', 'throttle');

    renderer.pushChunk('C');
    expect(renderer.finalize()).toBe('ABC');

    expect(flushSpy).toHaveBeenCalledTimes(2);
    expect(flushSpy).toHaveBeenNthCalledWith(2, 'ABC', 'final');

    vi.useRealTimers();
  });
});
