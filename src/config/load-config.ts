import type { BridgeConfig } from './types.ts';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    ownerOpenId: env.FEISHU_OWNER_OPEN_ID ?? '',
    workspaceAllowlist: (env.WORKSPACE_ALLOWLIST ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    approvalTimeoutMs: Number(env.APPROVAL_TIMEOUT_MS ?? '120000'),
    cardPatchIntervalMs: Number(env.CARD_PATCH_INTERVAL_MS ?? '400'),
    sharedStorePath: env.FEISHU_SHARED_STORE_PATH ?? '',
    allowGlobalStorageFallback: (env.FEISHU_ALLOW_GLOBAL_STORAGE_FALLBACK ?? 'true') !== 'false',
  };
}
