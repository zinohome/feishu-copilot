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

export async function activate(
  context: vscode.ExtensionContext,
  deps?: ActivateDeps,
): Promise<void> {
  const cmds = deps?.commands ?? vscode.commands;
  const storagePath = deps?.workspaceStoragePath ?? context.storageUri?.fsPath ?? '';

  const config = readExtensionConfig(
    vscode.workspace?.getConfiguration?.('feishuCopilotHandoff') ?? {
      get<T>(_key: string, defaultValue: T): T { return defaultValue; },
    },
  );

  const commandService = new ChatCommandService(
    (command: string, ...args: unknown[]) => cmds.executeCommand(command, ...args),
  );

  let token = '';
  if (config.feishuAppId && config.feishuAppSecret) {
    token = await getTenantAccessToken(config.feishuAppId, config.feishuAppSecret);
  }

  const controller = new BridgeController({
    ownerOpenId: config.ownerOpenId,
    targetChatId: config.targetChatId,
    sendFeishuText: (chatId, text) => sendFeishuText(token, chatId, text),
  });

  let eventSource: { dispose: () => void } | undefined;

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
      await refreshSessions();
      eventSource = startFeishuEventSource({
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
            await sendFeishuText(token, config.targetChatId, reply);
          }
        },
      });
    }),
    cmds.registerCommand('feishuCopilotHandoff.stop', async () => {
      eventSource?.dispose();
      eventSource = undefined;
    }),
    cmds.registerCommand('feishuCopilotHandoff.status', async () => {
      void vscode.window?.showInformationMessage?.(controller.getStatusText());
    }),
  );
}

export function deactivate(): void {}
