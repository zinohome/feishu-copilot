import * as path from 'path';

export type SessionStoreMode = 'workspace-shared' | 'configured-shared' | 'editor-local-fallback';

export interface ResolveStorePathInput {
  workspaceFolders: Array<{ uri: { fsPath: string } }>;
  configuredSharedStorePath: string;
  globalStoragePath: string;
  allowGlobalStorageFallback: boolean;
}

export interface ResolveStorePathResult {
  storePath: string;
  mode: SessionStoreMode;
  warning?: string;
}

export function resolveSessionStorePath(input: ResolveStorePathInput): ResolveStorePathResult {
  const workspacePath = input.workspaceFolders[0]?.uri.fsPath?.trim();
  if (workspacePath) {
    return {
      storePath: path.join(workspacePath, '.feishu-copilot', 'sessions.json'),
      mode: 'workspace-shared',
    };
  }

  const configuredPath = input.configuredSharedStorePath.trim();
  if (configuredPath) {
    return {
      storePath: configuredPath,
      mode: 'configured-shared',
    };
  }

  if (!input.allowGlobalStorageFallback) {
    throw new Error('No workspace/configured shared session store path and fallback is disabled.');
  }

  return {
    storePath: path.join(input.globalStoragePath, 'sessions.json'),
    mode: 'editor-local-fallback',
    warning: 'Using editor-local session storage; handoff continuity is limited across editors.',
  };
}
