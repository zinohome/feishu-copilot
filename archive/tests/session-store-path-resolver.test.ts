import { describe, expect, it } from 'vitest';
import { resolveSessionStorePath } from '../archive/src/session/store-path-resolver';

describe('resolveSessionStorePath', () => {
  it('prefers workspace path when workspace exists', () => {
    const result = resolveSessionStorePath({
      workspaceFolders: [{ uri: { fsPath: '/repo/app' } }],
      configuredSharedStorePath: '/tmp/custom/sessions.json',
      globalStoragePath: '/editor/global',
      allowGlobalStorageFallback: true,
    });

    expect(result.storePath).toBe('/repo/app/.feishu-copilot/sessions.json');
    expect(result.mode).toBe('workspace-shared');
  });

  it('falls back to configured absolute path when no workspace exists', () => {
    const result = resolveSessionStorePath({
      workspaceFolders: [],
      configuredSharedStorePath: '/tmp/custom/sessions.json',
      globalStoragePath: '/editor/global',
      allowGlobalStorageFallback: true,
    });

    expect(result.storePath).toBe('/tmp/custom/sessions.json');
    expect(result.mode).toBe('configured-shared');
  });

  it('falls back to global storage when allowed', () => {
    const result = resolveSessionStorePath({
      workspaceFolders: [],
      configuredSharedStorePath: '',
      globalStoragePath: '/editor/global',
      allowGlobalStorageFallback: true,
    });

    expect(result.storePath).toBe('/editor/global/sessions.json');
    expect(result.mode).toBe('editor-local-fallback');
    expect(result.warning).toContain('handoff continuity is limited');
  });

  it('throws when sharing is unavailable and fallback is disabled', () => {
    expect(() =>
      resolveSessionStorePath({
        workspaceFolders: [],
        configuredSharedStorePath: '',
        globalStoragePath: '/editor/global',
        allowGlobalStorageFallback: false,
      }),
    ).toThrowError('fallback is disabled');
  });
});