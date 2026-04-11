import { describe, expect, it, vi } from 'vitest';
import { activate } from '../src/extension';
import * as vscode from 'vscode';

describe('activate', () => {
  it('registers lifecycle and utility commands, and creates status bar item', async () => {
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
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.restart', expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.openSettings', expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.persistTargetChatId', expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.status', expect.any(Function));
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
  });
});
