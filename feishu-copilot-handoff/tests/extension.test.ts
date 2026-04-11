import { describe, expect, it, vi } from 'vitest';
import { activate } from '../src/extension';

describe('activate', () => {
  it('registers start, stop, and status commands', async () => {
    const subscriptions: { dispose: () => void }[] = [];
    const commands = {
      registerCommand: vi.fn((_id: string, handler: () => unknown) => {
        const disposable = { dispose: () => void handler };
        subscriptions.push(disposable);
        return disposable;
      }),
      executeCommand: vi.fn(),
    };

    await activate(
      { subscriptions } as any,
      {
        commands,
        workspaceStoragePath: '/tmp/workspace-storage',
      } as any,
    );

    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.start', expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.stop', expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.status', expect.any(Function));
  });
});
