import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readExtensionConfig } from './config';
import { ChatCommandService } from './copilot/chat-command-service';
import { listChatSessionFiles } from './copilot/session-discovery';
import { SessionMonitor } from './copilot/session-monitor';
import { getTenantAccessToken, sendFeishuText, sendFeishuMirrorMessage, updateFeishuMirrorMessage } from './feishu/client';
import { startFeishuEventSource } from './feishu/event-source';

export interface ActivateDeps {
  commands?: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose: () => void };
    executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  };
  workspaceStoragePath?: string;
}

let activeEventSource: { dispose: () => void } | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let activeMonitor: SessionMonitor | undefined;
let learnedTargetChatId: string | undefined;
let sessionRefreshTimer: NodeJS.Timeout | undefined;
let runtimeTargetChatId: string | undefined;
let contextStoragePath: string | undefined;
let outputChannel: vscode.OutputChannel | undefined;
const SESSION_REFRESH_INTERVAL_MS = 350;
const FEISHU_TEXT_CHUNK_SIZE = 2400;

function log(message: string): void {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] ${message}`;
  outputChannel?.appendLine(line);
  console.log(message);
}

function splitTextForFeishu(text: string, chunkSize = FEISHU_TEXT_CHUNK_SIZE): string[] {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }
  return chunks;
}

async function ensureCopilotDebugLogEnabled(): Promise<void> {
  const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat');
  const enabled = copilotConfig.get<boolean>('agentDebugLog.fileLogging.enabled', false);
  const flushInterval = copilotConfig.get<number>('agentDebugLog.fileLogging.flushIntervalMs', 1000);
  if (!enabled) {
    await copilotConfig.update('agentDebugLog.fileLogging.enabled', true, vscode.ConfigurationTarget.Global);
    console.log('[feishu-copilot-handoff] enabled github.copilot.chat.agentDebugLog.fileLogging.enabled');
  }
  if (flushInterval > 500) {
    await copilotConfig.update('agentDebugLog.fileLogging.flushIntervalMs', 500, vscode.ConfigurationTarget.Global);
    console.log('[feishu-copilot-handoff] set github.copilot.chat.agentDebugLog.fileLogging.flushIntervalMs to 500');
  }
}

function readLiveConfig() {
  return readExtensionConfig(vscode.workspace.getConfiguration('feishuCopilotHandoff'));
}

function isConfigured(config: ReturnType<typeof readLiveConfig>): boolean {
  return Boolean(config.feishuAppId && config.feishuAppSecret && config.ownerOpenId);
}

function updateStatusBar(): void {
  if (!statusBarItem) return;
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

let cachedToken = '';
let tokenExpiresAt = 0;
let cachedCredentialKey = '';

async function freshToken(config: ReturnType<typeof readLiveConfig>): Promise<string> {
  if (!config.feishuAppId || !config.feishuAppSecret) return '';
  const credentialKey = `${config.feishuAppId}::${config.feishuAppSecret}`;
  if (credentialKey !== cachedCredentialKey) {
    cachedCredentialKey = credentialKey;
    cachedToken = '';
    tokenExpiresAt = 0;
  }
  if (!cachedToken || Date.now() > tokenExpiresAt) {
    cachedToken = await getTenantAccessToken(config.feishuAppId, config.feishuAppSecret);
    tokenExpiresAt = Date.now() + 100 * 60 * 1000;
  }
  return cachedToken;
}

async function createFeishuMessage(text: string, meta?: { role: 'user' | 'assistant' }): Promise<string | undefined> {
  if (!runtimeTargetChatId) return undefined;
  const config = readLiveConfig();
  const token = await freshToken(config);
  log(`[extension] createFeishuMessage role=${meta?.role} len=${text.length}`);
  if (meta?.role) {
    const type = meta.role === 'user' ? 'user-message' : 'assistant-message';
    return await sendFeishuMirrorMessage(token, runtimeTargetChatId, text, { type });
  } else {
    return await sendFeishuText(token, runtimeTargetChatId, text);
  }
}

async function updateFeishuMessage(messageId: string, text: string, meta?: { role: 'user' | 'assistant' }): Promise<void> {
  if (!runtimeTargetChatId) return;
  const config = readLiveConfig();
  const token = await freshToken(config);
  
  if (meta?.role) {
    const type = meta.role === 'user' ? 'user-message' : 'assistant-message';
    await updateFeishuMirrorMessage(token, messageId, text, { type });
  }
}

async function refreshSessions(monitor: SessionMonitor): Promise<void> {
  const config = readLiveConfig();
  // Use the workspaceStoragePath from the extension's context.storageUri
  // The storagePath is the parent directory of the extension's private folder
  const storagePath = contextStoragePath;
  if (!storagePath) {
    console.warn('[feishu-copilot-handoff] refreshSessions: storagePath not available');
    return;
  }
  try {
    const files = await listChatSessionFiles(storagePath);
    const now = new Date().toISOString().slice(11, 19);
    log(`[feishu-copilot-handoff] ${now} refreshSessions: found ${files.length} files`);
    if (files.length === 0) return;
    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        await monitor.processFile(filePath, content);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('[feishu-copilot-handoff] refreshSessions file error:', filePath, errMsg);
      }
    }
    await monitor.drainQueue();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log('[feishu-copilot-handoff] refreshSessions error: ' + errMsg);
  }
}

async function stopBridge(showToast = true): Promise<void> {
  if (!activeEventSource) {
    if (showToast) void vscode.window.showInformationMessage('Feishu Copilot Handoff is already stopped');
    updateStatusBar();
    return;
  }
  activeEventSource.dispose();
  activeEventSource = undefined;
  activeMonitor = undefined;
  if (sessionRefreshTimer) { clearInterval(sessionRefreshTimer); sessionRefreshTimer = undefined; }
  if (showToast) void vscode.window.showInformationMessage('Feishu Copilot Handoff stopped');
  updateStatusBar();
}

async function startBridge(showToast = true): Promise<void> {
  if (activeEventSource) {
    if (showToast) void vscode.window.showInformationMessage('Feishu Copilot Handoff is already running');
    updateStatusBar();
    return;
  }

  try { await ensureCopilotDebugLogEnabled(); } catch (err) {
    console.warn('[feishu-copilot-handoff] failed to enable copilot debug log:', err instanceof Error ? err.message : String(err));
  }

  const config = readLiveConfig();
  if (!isConfigured(config)) {
    void vscode.window.showErrorMessage('Feishu Copilot Handoff: feishuAppId, feishuAppSecret, and ownerOpenId must all be configured.');
    updateStatusBar();
    return;
  }

  if (config.targetChatId) runtimeTargetChatId = config.targetChatId;
  const monitor = new SessionMonitor(createFeishuMessage, updateFeishuMessage, undefined, false, log);
  activeMonitor = monitor;

  if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);

  // Initial bootstrap scan — builds internal state, does NOT send historical
  // messages to Feishu.  Must complete before the periodic timer starts to
  // prevent a race where the timer fires mid-bootstrap.
  await refreshSessions(monitor);

  // Now start periodic polling — only genuinely new events will be forwarded.
  sessionRefreshTimer = setInterval(() => { if (activeMonitor) void refreshSessions(activeMonitor); }, SESSION_REFRESH_INTERVAL_MS);

  activeEventSource = startFeishuEventSource({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    onMessage: async (message) => {
      try {
        if (message.senderOpenId !== config.ownerOpenId || !activeMonitor) return;

        if (!runtimeTargetChatId) {
          runtimeTargetChatId = message.chatId;
          learnedTargetChatId = runtimeTargetChatId;
          await vscode.workspace.getConfiguration('feishuCopilotHandoff').update('targetChatId', runtimeTargetChatId, true);
          void vscode.window.showInformationMessage(`Feishu Copilot Handoff learned target chat: ${runtimeTargetChatId}`);
          updateStatusBar();
        } else if (message.chatId !== runtimeTargetChatId) {
          runtimeTargetChatId = message.chatId;
          learnedTargetChatId = runtimeTargetChatId;
          await vscode.workspace.getConfiguration('feishuCopilotHandoff').update('targetChatId', runtimeTargetChatId, true);
          void vscode.window.showInformationMessage(`Feishu Copilot Handoff switched to chat: ${runtimeTargetChatId}`);
          updateStatusBar();
        }

        const commandService = new ChatCommandService((cmd, ...args) => vscode.commands.executeCommand(cmd, ...args));
        await commandService.submitToChat(message.text);
      } catch (err) {
        console.error('[feishu-copilot-handoff] onMessage failed:', err instanceof Error ? err.message : String(err));
      }
    },
  });

  if (showToast) void vscode.window.showInformationMessage('Feishu Copilot Handoff started');
  updateStatusBar();
}

async function restartBridge(showToast = true): Promise<void> {
  await stopBridge(false);
  await startBridge(false);
  if (showToast) void vscode.window.showInformationMessage('Feishu Copilot Handoff restarted');
  updateStatusBar();
}

async function openSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'feishuCopilotHandoff');
}

async function persistLearnedTargetChatId(): Promise<void> {
  if (!learnedTargetChatId) {
    void vscode.window.showWarningMessage('Feishu Copilot Handoff: No learned target chat yet.');
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
  const picked = await vscode.window.showQuickPick(options, { placeHolder: 'Feishu Copilot Handoff actions', ignoreFocusOut: true });
  if (!picked) return;
  if (picked.label.includes('Start Bridge')) { await startBridge(); return; }
  if (picked.label.includes('Stop Bridge')) { await stopBridge(); return; }
  if (picked.label.includes('Restart Bridge')) { await restartBridge(); return; }
  if (picked.label.includes('Open Settings')) { await openSettings(); return; }
  if (picked.label.includes('Save Learned Target Chat ID')) { await persistLearnedTargetChatId(); return; }
  const statusText = activeMonitor ? `session: ${activeMonitor.getSessionId()}\ntargetChatId: ${runtimeTargetChatId ?? 'auto-pending'}` : 'mode: stopped\nsession: none';
  void vscode.window.showInformationMessage(statusText);
}

export async function activate(context: vscode.ExtensionContext, deps?: ActivateDeps): Promise<void> {
  const cmds = deps?.commands ?? vscode.commands;

  // Create output channel first so all startup logs appear there
  outputChannel = vscode.window.createOutputChannel('Feishu Copilot Handoff');
  context.subscriptions.push(outputChannel);

  contextStoragePath = deps?.workspaceStoragePath;
  if (!contextStoragePath && context.storageUri) {
    contextStoragePath = path.dirname(context.storageUri.fsPath);
  }
  if (!contextStoragePath && context.globalStorageUri) {
    contextStoragePath = path.dirname(context.globalStorageUri.fsPath);
  }
  log('[feishu-copilot-handoff] initialized with storagePath: ' + contextStoragePath);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    cmds.registerCommand('feishuCopilotHandoff.start', () => startBridge()),
    cmds.registerCommand('feishuCopilotHandoff.stop', () => stopBridge()),
    cmds.registerCommand('feishuCopilotHandoff.restart', () => restartBridge()),
    cmds.registerCommand('feishuCopilotHandoff.openSettings', () => openSettings()),
    cmds.registerCommand('feishuCopilotHandoff.persistTargetChatId', () => persistLearnedTargetChatId()),
    cmds.registerCommand('feishuCopilotHandoff.status', () => showStatusActions()),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('feishuCopilotHandoff')) return;
      updateStatusBar();
      if (activeEventSource) void restartBridge(false);
    }),
  );

  updateStatusBar();

  if (isConfigured(readLiveConfig())) {
    void startBridge(false).catch((err) => {
      console.error('[feishu-copilot-handoff] auto-start failed:', err instanceof Error ? err.message : String(err));
      updateStatusBar();
    });
  }
}

export function deactivate(): void {
  activeEventSource?.dispose();
  activeEventSource = undefined;
  activeMonitor = undefined;
  learnedTargetChatId = undefined;
  runtimeTargetChatId = undefined;
  if (sessionRefreshTimer) { clearInterval(sessionRefreshTimer); sessionRefreshTimer = undefined; }
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
