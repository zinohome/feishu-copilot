# Shared Session Handoff Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Feishu and desktop continuation reliably share one transcript source so users can hand off between mobile and IDE without context split.

**Architecture:** Introduce deterministic session store path resolution (workspace > configured absolute path > editor-local fallback), keep native Feishu Sessions as snapshot UI, and enforce explicit desktop binding to shared Feishu sessions. Add explicit command(s) to open latest shared session and remove heuristic fallback writes from general Copilot chats.

**Tech Stack:** TypeScript, VS Code Extension API, proposed chatSessionsProvider API, Node fs/path, Vitest

---

## Scope Check

This is one subsystem (shared-session continuity). It should be implemented as one cohesive change set with small TDD tasks.

## Planned File Structure

### Create

- `src/session/store-path-resolver.ts`
  - Deterministic store path selection and mode reporting.
- `tests/session-store-path-resolver.test.ts`
  - Resolver priority and failure-mode tests.
- `tests/session-store.test.ts`
  - SessionStore constructor options and key-reuse behavior tests.

### Modify

- `src/config/types.ts`
  - Add `sharedStorePath` and `allowGlobalStorageFallback`.
- `src/config/load-config.ts`
  - Parse env vars for shared-store controls.
- `src/session/session-store.ts`
  - Support injected store path/mode and expose storage info.
- `src/session/feishu-chat-session-manager.ts`
  - Remove non-resource fallback binding; add explicit open-latest method.
- `src/extension.ts`
  - Resolve store path at activate time, initialize SessionStore with resolved path, add open-latest command wiring.
- `package.json`
  - Add config schema for shared-store settings, add command contribution.
- `tests/config-and-domain.test.ts`
  - Type-level config coverage for new fields.
- `tests/extension-config-reload.test.ts`
  - Ensure new config keys trigger restart when running.
- `tests/feishu-chat-session-manager.test.ts`
  - Assert no heuristic fallback write; assert explicit open-latest behavior.
- `tests/pipeline.test.ts`
  - Include new BridgeConfig fields in fixtures.
- `README.md`
  - Document explicit desktop continuation flow and shared-store modes.

---

### Task 1: Add Shared Store Config Contract

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/load-config.ts`
- Modify: `tests/config-and-domain.test.ts`

- [ ] **Step 1: Write failing test for BridgeConfig shared-store fields**

```ts
import type { BridgeConfig } from '../src/config/types';

it('includes shared store settings in BridgeConfig', () => {
  const cfg: BridgeConfig = {
    ownerOpenId: 'ou_x',
    workspaceAllowlist: [],
    approvalTimeoutMs: 1000,
    cardPatchIntervalMs: 100,
    sharedStorePath: '/tmp/sessions.json',
    allowGlobalStorageFallback: true,
  };
  expect(cfg.sharedStorePath).toContain('sessions.json');
  expect(cfg.allowGlobalStorageFallback).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config-and-domain.test.ts -t "shared store"`
Expected: FAIL with missing BridgeConfig properties.

- [ ] **Step 3: Add config type fields**

```ts
// src/config/types.ts
export interface BridgeConfig {
  ownerOpenId: string;
  workspaceAllowlist: string[];
  approvalTimeoutMs: number;
  cardPatchIntervalMs: number;
  sharedStorePath: string;
  allowGlobalStorageFallback: boolean;
}
```

- [ ] **Step 4: Parse env config for new fields**

```ts
// src/config/load-config.ts
sharedStorePath: env.FEISHU_SHARED_STORE_PATH ?? '',
allowGlobalStorageFallback: (env.FEISHU_ALLOW_GLOBAL_STORAGE_FALLBACK ?? 'true') !== 'false',
```

- [ ] **Step 5: Run targeted tests**

Run: `npm test -- tests/config-and-domain.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/types.ts src/config/load-config.ts tests/config-and-domain.test.ts
git commit -m "feat: add shared store config contract"
```

---

### Task 2: Implement Deterministic Store Path Resolver

**Files:**
- Create: `src/session/store-path-resolver.ts`
- Create: `tests/session-store-path-resolver.test.ts`

- [ ] **Step 1: Write failing resolver tests**

```ts
it('prefers workspace path', () => {
  const result = resolveSessionStorePath({
    workspaceFolders: [{ uri: { fsPath: '/repo/app' } }],
    configuredSharedStorePath: '/tmp/custom/sessions.json',
    globalStoragePath: '/editor/global',
    allowGlobalStorageFallback: true,
  });
  expect(result.storePath).toBe('/repo/app/.feishu-copilot/sessions.json');
  expect(result.mode).toBe('workspace-shared');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/session-store-path-resolver.test.ts`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement resolver**

```ts
// src/session/store-path-resolver.ts
import * as path from 'path';

export type SessionStoreMode = 'workspace-shared' | 'configured-shared' | 'editor-local-fallback';

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
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/session-store-path-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/store-path-resolver.ts tests/session-store-path-resolver.test.ts
git commit -m "feat: add deterministic shared session store path resolver"
```

---

### Task 3: Refactor SessionStore to Use Resolved Path

**Files:**
- Modify: `src/session/session-store.ts`
- Create: `tests/session-store.test.ts`

- [ ] **Step 1: Write failing SessionStore tests**

```ts
it('uses injected store path', () => {
  const store = new SessionStore({ globalStorageUri: { fsPath: '/editor/global' } } as any, {
    storePath: '/shared/project/.feishu-copilot/sessions.json',
    storeMode: 'workspace-shared',
  });
  expect(store.getStorageInfo().storePath).toBe('/shared/project/.feishu-copilot/sessions.json');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/session-store.test.ts`
Expected: FAIL with constructor mismatch.

- [ ] **Step 3: Add SessionStore options and storage info API**

```ts
export interface SessionStoreOptions {
  storePath?: string;
  storeMode?: SessionStoreMode;
}

constructor(context: vscode.ExtensionContext, options?: SessionStoreOptions) {
  this.storePath = options?.storePath ?? path.join(context.globalStorageUri.fsPath, 'sessions.json');
  this.storeMode = options?.storeMode ?? 'editor-local-fallback';
  this.load();
}

getStorageInfo(): { storePath: string; storeMode: SessionStoreMode } {
  return { storePath: this.storePath, storeMode: this.storeMode };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/session-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-store.ts tests/session-store.test.ts
git commit -m "feat: make session store path configurable"
```

---

### Task 4: Wire Resolver in Extension Activation

**Files:**
- Modify: `src/extension.ts`
- Modify: `tests/extension-config-reload.test.ts`

- [ ] **Step 1: Write failing restart-trigger tests for new config keys**

```ts
it('returns true for sharedStorePath change when bridge is running', () => {
  const evt = eventFor('feishuCopilot.sharedStorePath');
  expect(shouldRestartBridgeForConfigChange(evt, true)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/extension-config-reload.test.ts`
Expected: FAIL for missing conditions.

- [ ] **Step 3: Resolve session store path during activate and initialize SessionStore with it**

```ts
const resolvedStore = resolveSessionStorePath({
  workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(f => ({ uri: { fsPath: f.uri.fsPath } })),
  configuredSharedStorePath: readSharedStorePath(),
  globalStoragePath: context.globalStorageUri.fsPath,
  allowGlobalStorageFallback: readAllowGlobalStorageFallback(),
});

sessionStore = new SessionStore(context, {
  storePath: resolvedStore.storePath,
  storeMode: resolvedStore.mode,
});
```

- [ ] **Step 4: Surface fallback warning**

```ts
if (resolvedStore.warning) {
  void vscode.window.showWarningMessage(`Feishu Copilot: ${resolvedStore.warning}`);
}
```

- [ ] **Step 5: Extend restart-trigger predicate for new settings**

```ts
evt.affectsConfiguration('feishuCopilot.sharedStorePath') ||
evt.affectsConfiguration('feishuCopilot.allowGlobalStorageFallback')
```

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/extension-config-reload.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts tests/extension-config-reload.test.ts
git commit -m "feat: wire shared store resolver into extension activation"
```

---

### Task 5: Enforce Explicit Desktop Binding and Add Open-Latest Command

**Files:**
- Modify: `src/session/feishu-chat-session-manager.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Modify: `tests/feishu-chat-session-manager.test.ts`

- [ ] **Step 1: Write failing tests for removed heuristic fallback and open-latest command**

```ts
it('does not fall back to non-feishu session resources', async () => {
  await manager.handleVsCodeRequest(...nonFeishuContext...);
  expect(store.appendMessage).not.toHaveBeenCalled();
});

it('opens the latest shared session explicitly', async () => {
  const opened = await manager.openLatestSharedSession();
  expect(opened).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-chat-session-manager.test.ts`
Expected: FAIL due to existing fallback behavior and missing method.

- [ ] **Step 3: Remove fallback resolution from non-feishu resources**

```ts
private resolveStoredSessionFromContext(context: vscode.ChatContext): FeishuSession | undefined {
  const sessionResource = context.chatSessionContext?.chatSessionItem.resource;
  if (sessionResource?.scheme === FEISHU_SESSION_SCHEME) {
    return this.store.get(sessionIdFromUri(sessionResource));
  }
  return undefined;
}
```

- [ ] **Step 4: Add explicit method to open latest shared session**

```ts
async openLatestSharedSession(): Promise<boolean> {
  const latest = this.store
    .list()
    .find(s => !s.archived && Boolean(s.feishuKey) && !s.feishuKey.startsWith('vscode-'));
  if (!latest) {
    return false;
  }
  await vscode.commands.executeCommand('vscode.open', sessionUri(latest.id), { preview: false });
  return true;
}
```

- [ ] **Step 5: Register new command and command-palette entry**

```json
{
  "command": "feishu-copilot.openLatestSharedSession",
  "title": "Feishu Copilot: Open Latest Shared Session"
}
```

```ts
const openLatestSharedSessionCmd = vscode.commands.registerCommand(
  'feishu-copilot.openLatestSharedSession',
  async () => {
    const opened = await sessionManager?.openLatestSharedSession();
    if (!opened) {
      void vscode.window.showInformationMessage('No shared Feishu session found yet. Start from Feishu first.');
    }
  },
);
```

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/feishu-chat-session-manager.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/session/feishu-chat-session-manager.ts src/extension.ts package.json tests/feishu-chat-session-manager.test.ts
git commit -m "feat: enforce explicit shared-session binding and add open-latest command"
```

---

### Task 6: Update BridgeConfig Consumers and Pipeline Fixtures

**Files:**
- Modify: `src/extension.ts`
- Modify: `tests/pipeline.test.ts`

- [ ] **Step 1: Write failing fixture compile/test check**

Run: `npm run build`
Expected: FAIL if BridgeConfig consumers are missing new properties.

- [ ] **Step 2: Update BridgeConfig construction in extension**

```ts
const bridgeConfig: BridgeConfig = {
  ownerOpenId,
  workspaceAllowlist: [],
  approvalTimeoutMs,
  cardPatchIntervalMs,
  sharedStorePath: readSharedStorePath(),
  allowGlobalStorageFallback: readAllowGlobalStorageFallback(),
};
```

- [ ] **Step 3: Update pipeline tests config fixture**

```ts
const config: BridgeConfig = {
  ownerOpenId: 'ou_owner123',
  workspaceAllowlist: [],
  approvalTimeoutMs: 5000,
  cardPatchIntervalMs: 0,
  sharedStorePath: '',
  allowGlobalStorageFallback: true,
};
```

- [ ] **Step 4: Run tests and build**

Run: `npm test -- tests/pipeline.test.ts && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts tests/pipeline.test.ts
git commit -m "chore: update bridge config consumers for shared store settings"
```

---

### Task 7: Document New Continuation Contract and Verify End-to-End

**Files:**
- Modify: `README.md`
- Test: manual verification checklist

- [ ] **Step 1: Add README section for shared-store modes and explicit continuation**

```md
## Shared Session Handoff

- Store priority: workspace `.feishu-copilot/sessions.json` > `feishuCopilot.sharedStorePath` > local fallback.
- Use command: `Feishu Copilot: Open Latest Shared Session` when returning to desktop.
- General Copilot chats are not automatically shared-session writes.
```

- [ ] **Step 2: Run full regression**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual handoff verification**

Run sequence:
1. Send message from Feishu.
2. Run command: `Feishu Copilot: Open Latest Shared Session` in desktop editor.
3. Continue in opened session.
4. Confirm transcript and context continue from shared session source.

Expected:
- Shared transcript contains both `feishu` and `vscode` sources under the same session id.
- Model response references prior turns from both sides.

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: document shared-session handoff flow"
```

---

## Risks and Mitigations

1. Workspace is absent and configured path is empty with fallback disabled.
- Mitigation: fail fast at activate with clear error message.

2. Users continue chatting in general Copilot panel expecting shared writes.
- Mitigation: explicit warning message and command-driven continuation path.

3. Cross-editor mismatch due to different workspace roots.
- Mitigation: document sharedStorePath override and show resolved-mode warning.

4. Existing local session history split.
- Mitigation: keep fallback mode and avoid destructive migration; users can continue with new path from first shared write.

## Self-Review

1. Spec coverage:
- Shared store deterministic path: covered in Tasks 2-4.
- Explicit desktop entry: covered in Task 5.
- Snapshot semantics and no general panel interception: covered in Task 5 and Task 7 docs.
- Testing and verification: covered in Tasks 1-7.

2. Placeholder scan:
- No TODO/TBD placeholders.
- All tasks include concrete files, commands, and expected outcomes.

3. Type consistency:
- `BridgeConfig.sharedStorePath` and `BridgeConfig.allowGlobalStorageFallback` are referenced consistently across config, extension wiring, and tests.
- `SessionStoreMode` usage is consistent between resolver and store options.

## Execution Notes

- Keep commits small and task-scoped.
- Do not include unrelated dirty-worktree changes in task commits.
- Validate each task before moving to the next one.
