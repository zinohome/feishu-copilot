import { describe, expect, it } from 'vitest';
import { classifyOperation } from '../src/domain/permissions';
import type { BridgeConfig } from '../src/config/types';

describe('BridgeConfig shared store fields', () => {
  it('includes sharedStorePath and fallback mode fields', () => {
    const cfg: BridgeConfig = {
      ownerOpenId: 'ou_x',
      workspaceAllowlist: [],
      approvalTimeoutMs: 1000,
      cardPatchIntervalMs: 100,
      sharedStorePath: '/tmp/sessions.json',
      allowGlobalStorageFallback: true,
    };

    expect(cfg.sharedStorePath).toContain('sessions.json');
    expect(cfg.allowGlobalStorageFallback).toBe(true);
  });
});

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
