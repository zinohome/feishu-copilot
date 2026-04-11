import { describe, expect, it } from 'vitest';
import { IdempotencyStore } from '../archive/src/feishu/idempotency-store';

describe('IdempotencyStore', () => {
  it('accepts first event and rejects duplicate', () => {
    const store = new IdempotencyStore();
    expect(store.tryMark('mid-1')).toBe(true);
    expect(store.tryMark('mid-1')).toBe(false);
  });
});
