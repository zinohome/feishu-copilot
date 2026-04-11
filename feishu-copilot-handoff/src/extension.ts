import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readExtensionConfig } from './config';
import { ChatCommandService } from './copilot/chat-command-service';
import { listChatSessionFiles } from './copilot/session-discovery';
import { parseChatSessionJsonl } from './copilot/session-parser';
import { getTenantAccessToken, sendFeishuText } from './feishu/client';
import { startFeishuEventSource } from './feishu/event-source';
import { BridgeController } from './handoff/bridge-controller';

export interface ActivateDeps {
  commands?: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose: () => void };
    executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  };
  workspaceStoragePath?: string;
}

// Module-level so deactivate() can clean up even without a closure
let activeEventSource: { dispose: () => void } | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let activeController: BridgeController | undefined;

function readLiveConfig(): ReturnType<typeof readExtensionConfig> {
  return readExtensionConfig(vscode.workspace.getConfiguration('feishuCopilotHandoff'));
}

function isConfigured(config: ReturnType<typeof readExtensionConfig>): boolean {
  return Boolean(config.feishuAppId && config.feishuAppSecret && config.ownerOpenId);
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const config = readLiveConfig();
  if (activeEventSource) {
    statusBarItem.text = '$(radio-tower) Feishu Handoff: Running';
    statusBarItem.tooltip = 'Feishu Copilot Handoff is running\nClick for actions';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.command = 'feishuCopilotHandoff.status';
    return;
  }

  if (isConfigured(config)) {
    if (!config.targetChatId) {
      statusBarItem.text = '$(plug) Feishu Handoff: Waiting Target Chat';
      statusBarItem.tooltip = 'Bridge can connect; waiting for first authorized inbound message to learn chat_id';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.command = 'feishuCopilotHandoff.status';
      return;
    }

    statusBarItem.text = '$(debug-pause) Feishu Handoff: Stopped';
    statusBarItem.tooltip = 'Feishu Copilot Handoff is stopped\nClick for actions';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.command = 'feishuCopilotHandoff.status';
    return;
  }

  statusBarItem.text = '$(gear) Feishu Handoff: Not Configured';
  statusBarItem.tooltip = 'Feishu Copilot Handoff is not configured\nClick for actions';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarItem.command = 'feishuCopilotHandoff.status';
}

export async function activate(
  context: vscode.ExtensionContext,
  deps?: ActivateDeps,
): Promise<void> {
  const cmds = deps?.commands ?? vscode.commands;

  // Fix #1: chatSessions/ lives at the workspace storage root, one level above the
  // extension's own private folder (context.storageUri.fsPath).
  const storagePath =
    deps?.workspaceStoragePath ??
    (context.storageUri ? path.dirname(context.storageUri.fsPath) : '');

  const commandService = new ChatCommandService(
    (command: string, ...args: unknown[]) => cmds.executeCommand(command, ...args),
  );

  // Fix #2: lazy token refresh — Feishu tokens expire in ~2 hours.
  let cachedToken = '';
  let tokenExpiresAt = 0;
  let cachedCredentialKey = '';

  async function freshToken(config: ReturnType<typeof readExtensionConfig>): Promise<string> {
    if (!config.feishuAppId || !config.feishuAppSecret) {
      return '';
    }

    const credentialKey = `${config.feishuAppId}::${config.feishuAppSecret}`;
    if (credentialKey !== cachedCredentialKey) {
      cachedCredentialKey = credentialKey;
      cachedToken = '';
      tokenExpiresAt = 0;
    }

    if (!cachedToken || Date.now() > tokenExpiresAt) {
      cachedToken = await getTenantAccessToken(config.feishuAppId, config.feishuAppSecret);
      tokenExpiresAt = Date.now() + 100 * 60 * 1000; // refresh conservatively at 100 min
    }
    return cachedToken;
  }

  async function refreshSessions(controller: BridgeController): Promise<void> {
    if (!storagePath) {
      return;
    }
    try {
      const files = await listChatSessionFiles(storagePath);
      for (const filePath of files) {
        const stat = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf8');
        const summary = parseChatSessionJsonl(path.basename(filePath), content, stat.mtimeMs);
        await controller.handleSessionUpdate(summary);
      }
    } catch {
      // storage path may not exist yet
    }
  }

  async function stopBridge(showToast = true): Promise<void> {
    if (!activeEventSource) {
      if (showToast) {
        void vscode.window.showInformationMessage('Feishu Copilot Handoff is already stopped');
      }
      updateStatusBar();
      return;
    }

    activeEventSource.dispose();
    activeEventSource = undefined;
    activeController = undefined;
    if (showToast) {
      void vscode.window.showInformationMessage('Feishu Copilot Handoff stopped');
    }
    updateStatusBar();
  }

  async function startBridge(showToast = true): Promise<void> {
    if (activeEventSource) {
      if (showToast) {
        void vscode.window.showInformationMessage('Feishu Copilot Handoff is already running');
      }
      updateStatusBar();
      return;
    }

    const config = readLiveConfig();
    if (!isConfigured(config)) {
      void vscode.window.showErrorMessage(
        'Feishu Copilot Handoff: feishuAppId, feishuAppSecret, and ownerOpenId must all be configured.',
      );
      updateStatusBar();
      return;
    }

    let runtimeTargetChatId = config.targetChatId;

    const controller = new BridgeController({
      ownerOpenId: config.ownerOpenId,
      targetChatId: runtimeTargetChatId,
      maxMirroredSessions: config.maxMirroredSessions,
      sendFeishuText: async (chatId, text) => sendFeishuText(await freshToken(config), chatId, text),
    });

    if (runtimeTargetChatId) {
      await refreshSessions(controller);
    }
    activeController = controller;
    activeEventSource = startFeishuEventSource({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      onMessage: async (message) => {
        if (message.senderOpenId !== config.ownerOpenId || !activeController) {
          return;
        }

        if (!runtimeTargetChatId) {
          runtimeTargetChatId = message.chatId;
          activeController.setTargetChatId(runtimeTargetChatId);
          await refreshSessions(activeController);
          void vscode.window.showInformationMessage(`Feishu Copilot Handoff learned target chat: ${runtimeTargetChatId}`);
          updateStatusBar();
        }

        const reply = await activeController.handleFeishuText(message.text, (text) =>
          commandService.submitToChat(text),
        );
        if (reply) {
          await sendFeishuText(await freshToken(config), runtimeTargetChatId || message.chatId, reply);
        }
      },
    });

    if (showToast) {
      void vscode.window.showInformationMessage('Feishu Copilot Handoff started');
    }
    updateStatusBar();
  }

  async function restartBridge(showToast = true): Promise<void> {
    await stopBridge(false);
    await startBridge(false);
    if (showToast) {
      void vscode.window.showInformationMessage('Feishu Copilot Handoff restarted');
    }
    updateStatusBar();
  }

  async function openSettings(): Promise<void> {
    await cmds.executeCommand('workbench.action.openSettings', 'feishuCopilotHandoff');
  }

  async function showStatusActions(): Promise<void> {
    const options: vscode.QuickPickItem[] = [
      { label: '$(play) Start Bridge', description: 'Start Feishu handoff connection' },
      { label: '$(stop) Stop Bridge', description: 'Stop Feishu handoff connection' },
      { label: '$(debug-restart) Restart Bridge', description: 'Restart Feishu handoff connection' },
      { label: '$(gear) Open Settings', description: 'Open Feishu Copilot Handoff settings' },
      { label: '$(info) Show Runtime Status', description: 'Show current mode and active target' },
    ];

    const picked = await vscode.window.showQuickPick(options, {
      placeHolder: 'Feishu Copilot Handoff actions',
      ignoreFocusOut: true,
    });

    if (!picked) {
      return;
    }

    if (picked.label.includes('Start Bridge')) {
      await startBridge();
      return;
    }

    if (picked.label.includes('Stop Bridge')) {
      await stopBridge();
      return;
    }

    if (picked.label.includes('Restart Bridge')) {
      await restartBridge();
      return;
    }

    if (picked.label.includes('Open Settings')) {
      await openSettings();
      return;
    }

    const statusText = activeController?.getStatusText() ?? 'mode: follow-latest\nsession: none';
    void vscode.window.showInformationMessage(statusText);
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('feishuCopilotHandoff')) {
        return;
      }

      updateStatusBar();
      if (activeEventSource) {
        void restartBridge(false);
      }
    }),
  );

  context.subscriptions.push(
    cmds.registerCommand('feishuCopilotHandoff.start', () => startBridge()),
    cmds.registerCommand('feishuCopilotHandoff.stop', () => stopBridge()),
    cmds.registerCommand('feishuCopilotHandoff.restart', () => restartBridge()),
    cmds.registerCommand('feishuCopilotHandoff.openSettings', () => openSettings()),
    cmds.registerCommand('feishuCopilotHandoff.status', () => showStatusActions()),
  );

  updateStatusBar();
}

// Fix #4: close the WebSocket connection when the extension is deactivated
export function deactivate(): void {
  activeEventSource?.dispose();
  activeEventSource = undefined;
  activeController = undefined;
  statusBarItem?.dispose();
  statusBarItem = undefined;
}

