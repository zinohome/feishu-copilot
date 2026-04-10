import { describe, expect, it } from 'vitest';
import { classifyOperation } from '../src/domain/permissions';

describe('permission classification', () => {
  it('marks workspace writes as approval-required', () => {
    expect(classifyOperation({ kind: 'workspace-write' }).requireApproval).toBe(true);
  });

  it('hard-denies dangerous rm command', () => {
    const decision = classifyOperation({ kind: 'command-run', command: 'rm -rf /' });
    expect(decision.hardDenied).toBe(true);
    expect(decision.requireApproval).toBe(false);
  });

  it('hard-denies dangerous git reset command', () => {
    const decision = classifyOperation({ kind: 'command-run', command: 'git reset --hard HEAD~1' });
    expect(decision.hardDenied).toBe(true);
    expect(decision.requireApproval).toBe(false);
  });
});
