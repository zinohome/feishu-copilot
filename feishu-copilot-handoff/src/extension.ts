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

  const config = readExtensionConfig(
    vscode.workspace?.getConfiguration?.('feishuCopilotHandoff') ?? {
      get<T>(_key: string, defaultValue: T): T { return defaultValue; },
    },
  );

  const commandService = new ChatCommandService(
    (command: string, ...args: unknown[]) => cmds.executeCommand(command, ...args),
  );

  // Fix #2: lazy token refresh — Feishu tokens expire in ~2 hours.
  let cachedToken = '';
  let tokenExpiresAt = 0;

  async function freshToken(): Promise<string> {
    if (!config.feishuAppId || !config.feishuAppSecret) {
      return '';
    }
    if (!cachedToken || Date.now() > tokenExpiresAt) {
      cachedToken = await getTenantAccessToken(config.feishuAppId, config.feishuAppSecret);
      tokenExpiresAt = Date.now() + 100 * 60 * 1000; // refresh conservatively at 100 min
    }
    return cachedToken;
  }

  const controller = new BridgeController({
    ownerOpenId: config.ownerOpenId,
    targetChatId: config.targetChatId,
    maxMirroredSessions: config.maxMirroredSessions,
    sendFeishuText: async (chatId, text) => sendFeishuText(await freshToken(), chatId, text),
  });

  async function refreshSessions(): Promise<void> {
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

  context.subscriptions.push(
    cmds.registerCommand('feishuCopilotHandoff.start', async () => {
      // Fix #6: validate required config fields before attempting to connect
      if (!config.feishuAppId || !config.feishuAppSecret || !config.ownerOpenId || !config.targetChatId) {
        void vscode.window?.showErrorMessage?.(
          'Feishu Copilot Handoff: feishuAppId, feishuAppSecret, ownerOpenId, and targetChatId must all be configured.',
        );
        return;
      }

      await refreshSessions();
      activeEventSource = startFeishuEventSource({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
        onMessage: async (message) => {
          if (message.senderOpenId !== config.ownerOpenId) {
            return;
          }
          const reply = await controller.handleFeishuText(message.text, (text) =>
            commandService.submitToChat(text),
          );
          if (reply) {
            await sendFeishuText(await freshToken(), config.targetChatId, reply);
          }
        },
      });
    }),
    cmds.registerCommand('feishuCopilotHandoff.stop', async () => {
      activeEventSource?.dispose();
      activeEventSource = undefined;
    }),
    cmds.registerCommand('feishuCopilotHandoff.status', async () => {
      void vscode.window?.showInformationMessage?.(controller.getStatusText());
    }),
  );
}

// Fix #4: close the WebSocket connection when the extension is deactivated
export function deactivate(): void {
  activeEventSource?.dispose();
  activeEventSource = undefined;
}

