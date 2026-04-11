import { describe, expect, it } from 'vitest';
import { SessionRouter } from '../archive/src/session/session-router';

describe('SessionRouter', () => {
  it('cancels active task when new request arrives', () => {
    const router = new SessionRouter();
    const state1 = router.enqueue('u1', 'req-1');
    const state2 = router.enqueue('u1', 'req-2');

    expect(state1.cancelled).toBe(true);
    expect(state2.cancelled).toBe(false);
  });

  it('clears active task on complete', () => {
    const router = new SessionRouter();
    const state1 = router.enqueue('u1', 'req-1');

    router.complete('u1', 'req-1');

    const state2 = router.enqueue('u1', 'req-2');
    expect(state1.cancelled).toBe(false);
    expect(state2.cancelled).toBe(false);
  });

  it('does not clear newer task when completing stale request id', () => {
    const router = new SessionRouter();
    const state1 = router.enqueue('u1', 'req-1');
    const state2 = router.enqueue('u1', 'req-2');

    router.complete('u1', 'req-1');

    const state3 = router.enqueue('u1', 'req-3');
    expect(state1.cancelled).toBe(true);
    expect(state2.cancelled).toBe(true);
    expect(state3.cancelled).toBe(false);
  });
});
