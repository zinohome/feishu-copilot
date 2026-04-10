import { describe, expect, it } from 'vitest';
import { SessionRouter } from '../src/session/session-router';

describe('SessionRouter', () => {
  it('cancels active task when new request arrives', () => {
    const router = new SessionRouter();
    const state1 = router.enqueue('u1', 'req-1');
    const state2 = router.enqueue('u1', 'req-2');

    expect(state1.cancelled).toBe(true);
    expect(state2.cancelled).toBe(false);
  });
});
