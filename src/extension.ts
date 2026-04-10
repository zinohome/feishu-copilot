import * as vscode from 'vscode';
import { Pipeline } from './app/pipeline';
import type { FeishuWebhookEvent } from './app/pipeline';
import type { BridgeConfig } from './config/types';
import { VscodeLmAdapter } from './copilot/vscode-lm-adapter';
import { getToken } from './feishu/feishu-client';
import { startWebhookServer } from './http/webhook-server';

let serverHandle: { close: () => void } | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('feishuCopilot');

  const ownerOpenId = cfg.get<string>('ownerOpenId', '');
  if (!ownerOpenId) {
    void vscode.window.showErrorMessage('Feishu Copilot: ownerOpenId is required');
    return;
  }

  const feishuAppId = cfg.get<string>('feishuAppId', '');
  if (!feishuAppId) {
    void vscode.window.showErrorMessage('Feishu Copilot: feishuAppId is required');
    return;
  }

  const feishuAppSecret = cfg.get<string>('feishuAppSecret', '');
  if (!feishuAppSecret) {
    void vscode.window.showErrorMessage('Feishu Copilot: feishuAppSecret is required');
    return;
  }

  const webhookPort = cfg.get<number>('webhookPort', 3456);
  const approvalTimeoutMs = cfg.get<number>('approvalTimeoutMs', 120000);
  const cardPatchIntervalMs = cfg.get<number>('cardPatchIntervalMs', 400);

  let feishuToken: string;
  try {
    feishuToken = await getToken(feishuAppId, feishuAppSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Feishu Copilot: Failed to get token: ${msg}`);
    return;
  }

  const copilot = new VscodeLmAdapter();

  const bridgeConfig: BridgeConfig = {
    ownerOpenId,
    workspaceAllowlist: [],
    approvalTimeoutMs,
    cardPatchIntervalMs,
  };

  const pipeline = new Pipeline({ config: bridgeConfig, copilot, feishuToken });

  serverHandle = startWebhookServer(webhookPort, async (body, _req, res) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.statusCode = 400;
      res.end('invalid json');
      return;
    }

    // Feishu webhook challenge verification
    if (typeof parsed['challenge'] === 'string') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ challenge: parsed['challenge'] }));
      return;
    }

    await pipeline.handleInbound(parsed as unknown as FeishuWebhookEvent);
  });

  const stopCmd = vscode.commands.registerCommand('feishu-copilot.stop', () => {
    serverHandle?.close();
    serverHandle = undefined;
    void vscode.window.showInformationMessage('Feishu Copilot Bridge stopped');
  });

  const startCmd = vscode.commands.registerCommand('feishu-copilot.start', () => {
    void vscode.window.showInformationMessage('Feishu Copilot Bridge is already running');
  });

  const serverDisposable = {
    dispose: () => {
      serverHandle?.close();
      serverHandle = undefined;
    },
  };

  context.subscriptions.push(startCmd, stopCmd, serverDisposable);
  void vscode.window.showInformationMessage(`Feishu Copilot Bridge started on port ${webhookPort}`);
}

export function deactivate(): void {
  serverHandle?.close();
  serverHandle = undefined;
}
