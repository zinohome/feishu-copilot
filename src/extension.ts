import * as vscode from 'vscode';
import { Pipeline } from './app/pipeline';
import type { FeishuWebhookEvent } from './app/pipeline';
import type { BridgeConfig } from './config/types';
import { VscodeLmAdapter } from './copilot/vscode-lm-adapter';
import { getToken } from './feishu/feishu-client';
import { startFeishuWsEventSource } from './feishu/ws-event-source';

let wsHandle: { close: () => void } | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

function readConfig(): { appId: string; appSecret: string; isConfigured: boolean } {
  const cfg = vscode.workspace.getConfiguration('feishuCopilot');
  const appId = cfg.get<string>('feishuAppId', '').trim();
  const appSecret = cfg.get<string>('feishuAppSecret', '').trim();
  return {
    appId,
    appSecret,
    isConfigured: Boolean(appId && appSecret),
  };
}

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const { isConfigured } = readConfig();
  if (wsHandle) {
    statusBarItem.text = '$(radio-tower) Feishu Copilot: Running';
    statusBarItem.tooltip = 'Feishu Copilot Bridge is running\nClick for actions';
    statusBarItem.command = 'feishu-copilot.status';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (isConfigured) {
    statusBarItem.text = '$(debug-pause) Feishu Copilot: Stopped';
    statusBarItem.tooltip = 'Feishu Copilot Bridge is stopped\nClick for actions';
    statusBarItem.command = 'feishu-copilot.status';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    return;
  }

  statusBarItem.text = '$(gear) Feishu Copilot: Not Configured';
  statusBarItem.tooltip = 'Feishu Copilot is not configured\nClick for actions';
  statusBarItem.command = 'feishu-copilot.status';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
}

async function startBridge(showToast = true): Promise<void> {
  if (wsHandle) {
    if (showToast) {
      void vscode.window.showInformationMessage('Feishu Copilot Bridge is already running');
    }
    updateStatusBar();
    return;
  }

  const { appId, appSecret } = readConfig();
  if (!appId) {
    void vscode.window.showErrorMessage('Feishu Copilot: feishuAppId is required');
    updateStatusBar();
    return;
  }

  if (!appSecret) {
    void vscode.window.showErrorMessage('Feishu Copilot: feishuAppSecret is required');
    updateStatusBar();
    return;
  }

  const approvalTimeoutMs = 120000;
  const cardPatchIntervalMs = 400;

  let feishuToken: string;
  try {
    feishuToken = await getToken(appId, appSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Feishu Copilot: Failed to get token: ${msg}`);
    updateStatusBar();
    return;
  }

  const copilot = new VscodeLmAdapter();

  const bridgeConfig: BridgeConfig = {
    workspaceAllowlist: [],
    approvalTimeoutMs,
    cardPatchIntervalMs,
  };

  const pipeline = new Pipeline({ config: bridgeConfig, copilot, feishuToken });

  wsHandle = startFeishuWsEventSource({
    appId,
    appSecret,
    onMessage: async (event) => {
      await pipeline.handleInbound(event as FeishuWebhookEvent);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Feishu Copilot WS error: ${msg}`);
    },
  });

  updateStatusBar();
  if (showToast) {
    void vscode.window.showInformationMessage('Feishu Copilot Bridge started (WebSocket mode)');
  }
}

function stopBridge(showToast = true): void {
  wsHandle?.close();
  wsHandle = undefined;
  updateStatusBar();
  if (showToast) {
    void vscode.window.showInformationMessage('Feishu Copilot Bridge stopped');
  }
}

async function restartBridge(): Promise<void> {
  stopBridge(false);
  await startBridge(false);
  if (wsHandle) {
    void vscode.window.showInformationMessage('Feishu Copilot Bridge restarted');
  }
}

async function showStatusMenu(): Promise<void> {
  const { isConfigured, appId } = readConfig();

  if (wsHandle) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Stop Bridge', description: 'Stop Feishu WebSocket bridge', action: 'stop' },
        { label: 'Restart Bridge', description: 'Restart bridge connection', action: 'restart' },
        { label: 'Open Settings', description: 'Configure appId / appSecret', action: 'settings' },
      ],
      {
        title: 'Feishu Copilot Status',
        placeHolder: `Running${appId ? ` | appId: ${appId}` : ''}`,
      }
    );

    if (!picked) {
      return;
    }

    if (picked.action === 'stop') {
      stopBridge();
      return;
    }
    if (picked.action === 'restart') {
      await restartBridge();
      return;
    }
    await vscode.commands.executeCommand('feishu-copilot.openSettings');
    return;
  }

  if (isConfigured) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Start Bridge', description: 'Start Feishu WebSocket bridge', action: 'start' },
        { label: 'Open Settings', description: 'Configure appId / appSecret', action: 'settings' },
      ],
      {
        title: 'Feishu Copilot Status',
        placeHolder: `Stopped${appId ? ` | appId: ${appId}` : ''}`,
      }
    );

    if (!picked) {
      return;
    }
    if (picked.action === 'start') {
      await startBridge();
      return;
    }
    await vscode.commands.executeCommand('feishu-copilot.openSettings');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Open Settings', description: 'Set feishuAppId and feishuAppSecret', action: 'settings' },
      { label: 'Start Bridge', description: 'Try starting now', action: 'start' },
    ],
    {
      title: 'Feishu Copilot Status',
      placeHolder: 'Not configured',
    }
  );

  if (!picked) {
    return;
  }
  if (picked.action === 'settings') {
    await vscode.commands.executeCommand('feishu-copilot.openSettings');
    return;
  }
  await startBridge();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.show();
  updateStatusBar();

  const stopCmd = vscode.commands.registerCommand('feishu-copilot.stop', () => {
    stopBridge();
  });

  const startCmd = vscode.commands.registerCommand('feishu-copilot.start', async () => {
    await startBridge();
  });

  const restartCmd = vscode.commands.registerCommand('feishu-copilot.restart', async () => {
    await restartBridge();
  });

  const statusCmd = vscode.commands.registerCommand('feishu-copilot.status', async () => {
    await showStatusMenu();
  });

  const settingsCmd = vscode.commands.registerCommand('feishu-copilot.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'feishuCopilot');
  });

  const configWatcher = vscode.workspace.onDidChangeConfiguration((evt) => {
    if (evt.affectsConfiguration('feishuCopilot')) {
      updateStatusBar();
    }
  });

  const serverDisposable = {
    dispose: () => {
      stopBridge(false);
      statusBarItem?.dispose();
      statusBarItem = undefined;
    },
  };

  context.subscriptions.push(
    startCmd,
    stopCmd,
    restartCmd,
    statusCmd,
    settingsCmd,
    configWatcher,
    statusBarItem,
    serverDisposable
  );

  await startBridge(false);
}

export function deactivate(): void {
  stopBridge(false);
}
