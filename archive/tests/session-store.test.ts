import { describe, expect, it } from 'vitest';
import { SessionStore } from '../archive/src/session/session-store';

describe('SessionStore', () => {
  it('uses injected storePath instead of globalStorage default', () => {
    const store = new SessionStore(
      { globalStorageUri: { fsPath: '/editor/global' } } as any,
      {
        storePath: '/shared/project/.feishu-copilot/sessions.json',
        storeMode: 'workspace-shared',
      },
    );

    expect((store as any).storePath).toBe('/shared/project/.feishu-copilot/sessions.json');
    expect(store.getStorageInfo()).toMatchObject({
      storePath: '/shared/project/.feishu-copilot/sessions.json',
      storeMode: 'workspace-shared',
    });
  });

  it('reuses the existing active session for the same feishu key', () => {
    const store = new SessionStore(
      { globalStorageUri: { fsPath: '/editor/global' } } as any,
      {
        storePath: '/tmp/sessions.json',
      },
    );

    const first = store.getOrCreate('chat-1', 'A');
    const second = store.getOrCreate('chat-1', 'B');

    expect(first.id).toBe(second.id);
  });
});