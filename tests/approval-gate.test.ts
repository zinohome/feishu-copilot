import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../src/approval/approval-gate';

describe('ApprovalGate', () => {
  it('transitions from pending to approved', () => {
    const gate = new ApprovalGate();

    gate.request('a1');
    gate.approve('a1');

    expect(gate.status('a1')).toBe('approved');
  });

  it('transitions from pending to denied', () => {
    const gate = new ApprovalGate();

    gate.request('a2');
    gate.deny('a2');

    expect(gate.status('a2')).toBe('denied');
  });

  it('auto-denies pending request on timeout', () => {
    vi.useFakeTimers();

    const gate = new ApprovalGate();
    gate.request('a-timeout', 100);

    expect(gate.status('a-timeout')).toBe('pending');

    vi.advanceTimersByTime(100);

    expect(gate.status('a-timeout')).toBe('denied');
    vi.useRealTimers();
  });
});
