import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readExtensionConfig } from './config';
import { ChatCommandService } from './copilot/chat-command-service';
import { listChatSessionFiles } from './copilot/session-discovery';
import { parseChatSessionJson, parseChatSessionJsonl } from './copilot/session-parser';
import { getTenantAccessToken, sendFeishuMirrorMessage, sendFeishuText } from './feishu/client';
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
let learnedTargetChatId: string | undefined;
let sessionRefreshTimer: NodeJS.Timeout | undefined;

async function ensureCopilotDebugLogEnabled(): Promise<void> {
  const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
  const enabled = copilotConfig.get<boolean>('agentDebugLog.fileLogging.enabled', false);
  const flushInterval = copilotConfig.get<number>('agentDebugLog.fileLogging.flushIntervalMs', 1000);

  if (!enabled) {
    await copilotConfig.update(
      'agentDebugLog.fileLogging.enabled',
      true,
      vscode.ConfigurationTarget.Global,
    );
    console.log('[feishu-copilot-handoff] enabled github.copilot.chat.agentDebugLog.fileLogging.enabled');
  }

  if (flushInterval > 500) {
    await copilotConfig.update(
      'agentDebugLog.fileLogging.flushIntervalMs',
      500,
      vscode.ConfigurationTarget.Global,
    );
    console.log('[feishu-copilot-handoff] set github.copilot.chat.agentDebugLog.fileLogging.flushIntervalMs to 500');
  }
}

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
  let storagePath =
    deps?.workspaceStoragePath ??
    (context.storageUri ? path.dirname(context.storageUri.fsPath) : '');

  // Fallback: if storagePath is empty or doesn't contain chatSessions, try globalStorageUri
  if (!storagePath && context.globalStorageUri) {
    storagePath = path.dirname(context.globalStorageUri.fsPath);
  }

  console.log('[feishu-copilot-handoff] initialized with storagePath:', storagePath);
  console.log('[feishu-copilot-handoff] context.storageUri:', context.storageUri?.fsPath);
  console.log('[feishu-copilot-handoff] context.globalStorageUri:', context.globalStorageUri?.fsPath);

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
      console.warn('[feishu-copilot-handoff] refreshSessions: storagePath is empty, cannot load chat sessions');
      return;
    }
    try {
      const files = await listChatSessionFiles(storagePath);
      const now = new Date().toISOString().slice(11, 19);
      console.log(`[feishu-copilot-handoff] ${now} refreshSessions: found ${files.length} files`, storagePath);
      if (files.length === 0) {
        console.debug('[feishu-copilot-handoff] refreshSessions: no chat session files found at', storagePath);
        // List directory contents for debugging
        try {
          const entries = await fs.readdir(storagePath, { withFileTypes: true });
          console.log('[feishu-copilot-handoff] storagePath contents:', entries.map(e => `${e.name}${e.isDirectory() ? '/' : ''}`));
        } catch (e) {
          console.warn('[feishu-copilot-handoff] cannot list storagePath:', e instanceof Error ? e.message : String(e));
        }
        return;
      }
      for (const filePath of files) {
        try {
          const stat = await fs.stat(filePath);
          const content = await fs.readFile(filePath, 'utf8');
          const fileName = path.basename(filePath);
          const lines = content.split('\n').length - 1;
          console.log('[feishu-copilot-handoff]   file:', fileName, `(${content.length}B, ${lines} lines, mtime: ${new Date(stat.mtimeMs).toISOString()})`);

          // Choose parser based on file extension
          const summary = fileName.endsWith('.json')
            ? parseChatSessionJson(fileName, content, stat.mtimeMs)
            : parseChatSessionJsonl(fileName, content, stat.mtimeMs);

          console.log('[feishu-copilot-handoff]   parsed:', `${summary.turns.length} turns, title: ${summary.title.slice(0, 30)}...`);
          await controller.handleSessionUpdate(summary);
        } catch (fileErr) {
          const fileErrMsg = fileErr instanceof Error ? fileErr.message : String(fileErr);
          console.warn('[feishu-copilot-handoff]   ERROR:', filePath, fileErrMsg);
        }
      }
    } catch (err) {
      // storage path may not exist yet, or chatSessions dir doesn't exist
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('[feishu-copilot-handoff] refreshSessions error:', errorMsg, 'path:', storagePath);
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
    if (sessionRefreshTimer) {
      clearInterval(sessionRefreshTimer);
      sessionRefreshTimer = undefined;
    }
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

    try {
      await ensureCopilotDebugLogEnabled();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('[feishu-copilot-handoff] failed to enable copilot debug log settings:', errMsg);
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
    learnedTargetChatId = runtimeTargetChatId || learnedTargetChatId;

    const controller = new BridgeController({
      ownerOpenId: config.ownerOpenId,
      targetChatId: runtimeTargetChatId,
      maxMirroredSessions: config.maxMirroredSessions,
      sendFeishuText: async (chatId, text, meta) =>
        sendFeishuMirrorMessage(await freshToken(config), chatId, text, meta),
    });

    console.log('[feishu-copilot-handoff] startBridge: initialized with targetChatId:', runtimeTargetChatId || 'pending');
    if (runtimeTargetChatId) {
      console.log('[feishu-copilot-handoff] startBridge: loading existing sessions');
      await refreshSessions(controller);
    }
    activeController = controller;
    if (sessionRefreshTimer) {
      clearInterval(sessionRefreshTimer);
    }
    // Poll chat session files so VS Code side updates are mirrored continuously.
    console.log('[feishu-copilot-handoff] starting session refresh poll (1.5s interval)');
    sessionRefreshTimer = setInterval(() => {
      if (activeController) {
        void refreshSessions(activeController);
      }
    }, 1500);

    activeEventSource = startFeishuEventSource({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      onMessage: async (message) => {
        try {
          if (message.senderOpenId !== config.ownerOpenId || !activeController) {
            return;
          }

          // Track the chat ID from the most recent inbound message.
          // This allows users to switch target chats in Feishu dynamically.
          if (!runtimeTargetChatId) {
            runtimeTargetChatId = message.chatId;
            learnedTargetChatId = runtimeTargetChatId;
            activeController.setTargetChatId(runtimeTargetChatId);
            await refreshSessions(activeController);
            void vscode.window.showInformationMessage(`Feishu Copilot Handoff learned target chat: ${runtimeTargetChatId}`);
            updateStatusBar();
          } else if (message.chatId !== runtimeTargetChatId) {
            // User switched to a different Feishu chat. Update target and sync current session.
            runtimeTargetChatId = message.chatId;
            learnedTargetChatId = runtimeTargetChatId;
            activeController.setTargetChatId(runtimeTargetChatId);
            await refreshSessions(activeController);
            void vscode.window.showInformationMessage(`Feishu Copilot Handoff switched to new chat: ${runtimeTargetChatId}`);
            updateStatusBar();
          }

          const reply = await activeController.handleFeishuText(message.text, (text) =>
            commandService.submitToChat(text),
          );
          if (reply) {
            await sendFeishuText(await freshToken(config), runtimeTargetChatId || message.chatId, reply);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[feishu-copilot-handoff] onMessage failed:', errMsg);
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

  async function persistLearnedTargetChatId(): Promise<void> {
    if (!learnedTargetChatId) {
      void vscode.window.showWarningMessage('Feishu Copilot Handoff: No learned target chat yet. Send one authorized message first.');
      return;
    }

    await vscode.workspace.getConfiguration('feishuCopilotHandoff').update('targetChatId', learnedTargetChatId, true);
    void vscode.window.showInformationMessage(`Feishu Copilot Handoff saved targetChatId: ${learnedTargetChatId}`);
  }

  async function showStatusActions(): Promise<void> {
    const options: vscode.QuickPickItem[] = [
      { label: '$(play) Start Bridge', description: 'Start Feishu handoff connection' },
      { label: '$(stop) Stop Bridge', description: 'Stop Feishu handoff connection' },
      { label: '$(debug-restart) Restart Bridge', description: 'Restart Feishu handoff connection' },
      { label: '$(gear) Open Settings', description: 'Open Feishu Copilot Handoff settings' },
      { label: '$(save) Save Learned Target Chat ID', description: 'Persist the auto-learned chat_id into settings' },
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

    if (picked.label.includes('Save Learned Target Chat ID')) {
      await persistLearnedTargetChatId();
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
    cmds.registerCommand('feishuCopilotHandoff.persistTargetChatId', () => persistLearnedTargetChatId()),
    cmds.registerCommand('feishuCopilotHandoff.status', () => showStatusActions()),
  );

  updateStatusBar();

  // Auto-start on activation when required credentials are present.
  if (isConfigured(readLiveConfig())) {
    void startBridge(false).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[feishu-copilot-handoff] auto-start failed:', errMsg);
      updateStatusBar();
    });
  }
}

// Fix #4: close the WebSocket connection when the extension is deactivated
export function deactivate(): void {
  activeEventSource?.dispose();
  activeEventSource = undefined;
  activeController = undefined;
  learnedTargetChatId = undefined;
  if (sessionRefreshTimer) {
    clearInterval(sessionRefreshTimer);
    sessionRefreshTimer = undefined;
  }
  statusBarItem?.dispose();
  statusBarItem = undefined;
}

