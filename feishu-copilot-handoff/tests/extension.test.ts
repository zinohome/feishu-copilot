import { describe, expect, it, vi, beforeEach } from 'vitest';
import { activate, deactivate } from '../src/extension';
import * as vscode from 'vscode';

vi.mock('../src/feishu/event-source', () => ({
  startFeishuEventSource: vi.fn(() => ({ dispose: vi.fn() })),
}));

describe('activate', () => {
  beforeEach(() => {
    deactivate();
    (vscode as any).__resetMockConfigStore?.();
    vi.clearAllMocks();
  });

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

  it('auto-enables copilot debug logging when starting bridge', async () => {
    const subscriptions: { dispose: () => void }[] = [];
    const commandHandlers = new Map<string, () => Promise<void> | void>();
    const commands = {
      registerCommand: vi.fn((id: string, handler: () => Promise<void> | void) => {
        commandHandlers.set(id, handler);
        const disposable = { dispose: () => {} };
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

    await commandHandlers.get('feishuCopilotHandoff.start')?.();

    const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
    expect(copilotConfig.get('agentDebugLog.fileLogging.enabled', false)).toBe(true);
    expect(copilotConfig.get('agentDebugLog.fileLogging.flushIntervalMs', 0)).toBe(500);
  });

  it('auto-starts on activation when required feishu settings exist', async () => {
    await vscode.workspace.getConfiguration('feishuCopilotHandoff').update('feishuAppId', 'app_id', true);
    await vscode.workspace.getConfiguration('feishuCopilotHandoff').update('feishuAppSecret', 'app_secret', true);
    await vscode.workspace.getConfiguration('feishuCopilotHandoff').update('ownerOpenId', 'ou_owner', true);

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

    const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
    expect(copilotConfig.get('agentDebugLog.fileLogging.enabled', false)).toBe(true);
    expect(copilotConfig.get('agentDebugLog.fileLogging.flushIntervalMs', 0)).toBe(500);
  });
});
