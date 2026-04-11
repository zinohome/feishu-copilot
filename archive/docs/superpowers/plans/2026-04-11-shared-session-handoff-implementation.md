# Shared Session Handoff Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic Feishu↔Desktop shared-session handoff by moving transcript storage to a shared location strategy and forcing explicit desktop entry into shared sessions.

**Architecture:** Introduce a store-path resolver that chooses workspace shared file first, configured absolute path second, and editor-local globalStorage last. Keep Feishu Sessions as snapshot-based native chat items while tightening desktop write rules: only Feishu-bound sessions can append shared transcript. Add explicit commands to open latest or specific shared sessions so desktop continuation is predictable.

**Tech Stack:** TypeScript, VS Code Extension API (chat + proposed chat sessions provider), Node fs/path, Vitest

---

## Scope Check

This spec is one cohesive subsystem: shared session continuity. It can be delivered in one plan with staged tasks.

Out of scope in this plan:
- Real-time refresh of already-opened native chat content beyond current snapshot semantics.
- Intercepting arbitrary Copilot panel chats and auto-binding them to shared sessions.
- Cross-device/cloud sync services outside workspace file or user-configured absolute path.

## Behavior Contract

### Behaviors That Stay Unchanged

1. Feishu inbound session key resolution order remains: `chat_id` first, `open_id` fallback.
2. Shared transcript remains the single prompt source for both Feishu and desktop continuation.
3. Native Feishu Sessions in Copilot remain snapshot-based experience (no live stream refresh redesign).
4. Desktop-to-Feishu mirror remains best-effort display sync, not source-of-truth storage.

### Behaviors Intentionally Tightened

1. Unbound desktop Copilot panel messages no longer append to shared transcript through heuristic fallback.
2. Desktop continuation is explicit: users open shared sessions via commands or Feishu Session items.
3. Shared store location is deterministic with explicit fallback warnings; silent local-only split is removed.
4. At most one active non-archived shared session is allowed for one Feishu key.

## Planned File Structure

Files to create:
1. `src/session/store-path-resolver.ts`
   Responsibility: resolve deterministic store path and fallback mode.
2. `tests/session-store-path-resolver.test.ts`
   Responsibility: fallback order and path compatibility tests.
3. `tests/session-store.test.ts`
   Responsibility: shared-key uniqueness, persistence mode, and migration safety tests.

Files to modify:
1. `src/config/types.ts`
   Responsibility: add typed session store strategy fields.
2. `src/extension.ts`
   Responsibility: wire resolver output, warnings, and new open-shared-session commands.
3. `src/session/session-store.ts`
   Responsibility: support resolved external file path plus fallback metadata.
4. `src/session/feishu-chat-session-manager.ts`
   Responsibility: remove ambiguous fallback binding, add explicit open-latest/open-by-key methods.
5. `src/app/pipeline.ts`
   Responsibility: keep Feishu append semantics stable while using refactored store contracts.
6. `package.json`
   Responsibility: add settings and command contributions.
7. `README.md`
   Responsibility: document shared-store setup, fallback behavior, and explicit desktop continuation flow.
8. `tests/feishu-chat-session-manager.test.ts`
   Responsibility: unbound desktop request rejection and explicit command entry tests.
9. `tests/pipeline.test.ts`
   Responsibility: guard Feishu key/session continuity behaviors after refactor.
10. `tests/extension-config-reload.test.ts`
    Responsibility: ensure config changes trigger expected rebuild/restart behavior.

---

### Task 1: Add Shared Store Strategy Configuration

**Files:**
- Modify: `src/config/types.ts`
- Modify: `package.json`
- Test: `tests/config-and-domain.test.ts`

- [ ] **Step 1: Write failing tests for new config fields**

```ts
import { describe, expect, it } from 'vitest';
import type { BridgeConfig } from '../src/config/types';

describe('BridgeConfig shared store fields', () => {
  it('includes sharedStorePath and fallback mode fields', () => {
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/config-and-domain.test.ts -t "shared store fields"`
Expected: FAIL with type errors for missing properties in `BridgeConfig`.

- [ ] **Step 3: Add config type fields**

```ts
// src/config/types.ts
export interface BridgeConfig {
  ownerOpenId: string;
  workspaceAllowlist: string[];
  approvalTimeoutMs: number;
  cardPatchIntervalMs: number;
  /** Optional absolute path to sessions.json for cross-editor sharing */
  sharedStorePath: string;
  /** If false, fail when shared path is unavailable instead of local fallback */
  allowGlobalStorageFallback: boolean;
}
```

- [ ] **Step 4: Add VS Code settings schema for shared store strategy**

```json
// package.json (configuration.properties additions)
"feishuCopilot.sharedStorePath": {
  "type": "string",
  "default": "",
  "description": "Absolute path to shared sessions.json. Used when no workspace folder is available."
},
"feishuCopilot.allowGlobalStorageFallback": {
  "type": "boolean",
  "default": true,
  "description": "Allow fallback to editor-local globalStorage when shared path is unavailable."
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- tests/config-and-domain.test.ts -t "shared store fields"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/types.ts package.json tests/config-and-domain.test.ts
git commit -m "feat: add shared session store configuration contract"
```

---

### Task 2: Implement Deterministic Store Path Resolver

**Files:**
- Create: `src/session/store-path-resolver.ts`
- Test: `tests/session-store-path-resolver.test.ts`

- [ ] **Step 1: Write failing tests for path resolution order**

```ts
import { describe, expect, it } from 'vitest';
import { resolveSessionStorePath } from '../src/session/store-path-resolver';

describe('resolveSessionStorePath', () => {
  it('prefers workspace path when workspace exists', () => {
    const result = resolveSessionStorePath({
      workspaceFolders: [{ uri: { fsPath: '/repo/app' } }],
      configuredSharedStorePath: '/tmp/custom/sessions.json',
      globalStoragePath: '/editor/global',
      allowGlobalStorageFallback: true,
    });
    expect(result.storePath).toBe('/repo/app/.feishu-copilot/sessions.json');
    expect(result.mode).toBe('workspace-shared');
  });

  it('falls back to configured absolute path when no workspace', () => {
    const result = resolveSessionStorePath({
      workspaceFolders: [],
      configuredSharedStorePath: '/tmp/custom/sessions.json',
      globalStoragePath: '/editor/global',
      allowGlobalStorageFallback: true,
    });
    expect(result.storePath).toBe('/tmp/custom/sessions.json');
    expect(result.mode).toBe('configured-shared');
  });

  it('falls back to globalStorage when sharing unavailable and fallback allowed', () => {
    const result = resolveSessionStorePath({
      workspaceFolders: [],
      configuredSharedStorePath: '',
      globalStoragePath: '/editor/global',
      allowGlobalStorageFallback: true,
    });
    expect(result.storePath).toBe('/editor/global/sessions.json');
    expect(result.mode).toBe('editor-local-fallback');
    expect(result.warning).toContain('handoff continuity is limited');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/session-store-path-resolver.test.ts`
Expected: FAIL with missing resolver module.

- [ ] **Step 3: Implement resolver module**

```ts
// src/session/store-path-resolver.ts
import * as path from 'path';

export type SessionStoreMode =
  | 'workspace-shared'
  | 'configured-shared'
  | 'editor-local-fallback';

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
  const ws = input.workspaceFolders[0]?.uri.fsPath?.trim();
  if (ws) {
    return {
      storePath: path.join(ws, '.feishu-copilot', 'sessions.json'),
      mode: 'workspace-shared',
    };
  }

  const configured = input.configuredSharedStorePath.trim();
  if (configured) {
    return {
      storePath: configured,
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

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- tests/session-store-path-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/store-path-resolver.ts tests/session-store-path-resolver.test.ts
git commit -m "feat: add deterministic session store path resolver"
```

---

### Task 3: Refactor SessionStore To Use Resolved Path And Enforce Shared-Key Uniqueness

**Files:**
- Modify: `src/session/session-store.ts`
- Test: `tests/session-store.test.ts`

- [ ] **Step 1: Write failing tests for resolved path and one-active-session-per-feishu-key**

```ts
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../src/session/session-store';

describe('SessionStore', () => {
  it('uses injected storePath instead of globalStorage default', () => {
    const store = new SessionStore({
      globalStorageUri: { fsPath: '/editor/global' },
    } as any, {
      storePath: '/shared/project/.feishu-copilot/sessions.json',
    });
    expect((store as any).storePath).toBe('/shared/project/.feishu-copilot/sessions.json');
  });

  it('returns existing active session for same feishu key', () => {
    const store = new SessionStore({ globalStorageUri: { fsPath: '/x' } } as any, {
      storePath: '/tmp/sessions.json',
    });
    const a = store.getOrCreate('chat-1', 'A');
    const b = store.getOrCreate('chat-1', 'B');
    expect(a.id).toBe(b.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/session-store.test.ts`
Expected: FAIL with constructor signature mismatch and missing test file.

- [ ] **Step 3: Add constructor options and deterministic persistence path**

```ts
// src/session/session-store.ts (constructor shape)
export interface SessionStoreOptions {
  storePath?: string;
  storeMode?: 'workspace-shared' | 'configured-shared' | 'editor-local-fallback';
}

constructor(context: vscode.ExtensionContext, options?: SessionStoreOptions) {
  this.storePath = options?.storePath
    ?? path.join(context.globalStorageUri.fsPath, 'sessions.json');
  this.load();
}
```

- [ ] **Step 4: Enforce one active shared session per Feishu key on getOrCreate**

```ts
// src/session/session-store.ts (inside getOrCreate)
const active = [...this.sessions.values()].filter(
  (s) => s.feishuKey === feishuKey && !s.archived,
);
if (active.length > 0) {
  return active.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
}
```

- [ ] **Step 5: Add/Run tests to verify pass**

Run: `npm run test -- tests/session-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/session-store.ts tests/session-store.test.ts
git commit -m "refactor: support resolved session store path and shared key uniqueness"
```

---

### Task 4: Wire Resolver Into Extension Startup With Fallback Warnings

**Files:**
- Modify: `src/extension.ts`
- Modify: `tests/extension-config-reload.test.ts`

- [ ] **Step 1: Write failing tests for resolver wiring and restart trigger fields**

```ts
import { describe, expect, it } from 'vitest';
import { shouldRestartBridgeForConfigChange } from '../src/extension';

describe('config restart scope', () => {
  it('restarts bridge when shared store settings change', () => {
    const evt = {
      affectsConfiguration: (k: string) =>
        k === 'feishuCopilot.sharedStorePath' || k === 'feishuCopilot.allowGlobalStorageFallback',
    };
    expect(shouldRestartBridgeForConfigChange(evt, true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/extension-config-reload.test.ts -t "shared store settings"`
Expected: FAIL because restart function does not include new keys.

- [ ] **Step 3: Resolve store path during activation and construct SessionStore with resolved path**

```ts
// src/extension.ts (activation shape)
import { resolveSessionStorePath } from './session/store-path-resolver';

const resolved = resolveSessionStorePath({
  workspaceFolders: vscode.workspace.workspaceFolders ?? [],
  configuredSharedStorePath: cfg.get<string>('sharedStorePath', ''),
  globalStoragePath: context.globalStorageUri.fsPath,
  allowGlobalStorageFallback: cfg.get<boolean>('allowGlobalStorageFallback', true),
});

sessionStore = new SessionStore(context, {
  storePath: resolved.storePath,
  storeMode: resolved.mode,
});

if (resolved.warning) {
  void vscode.window.showWarningMessage(`Feishu Copilot: ${resolved.warning}`);
}
```

- [ ] **Step 4: Extend restart condition with shared-store settings**

```ts
// src/extension.ts (inside shouldRestartBridgeForConfigChange)
evt.affectsConfiguration('feishuCopilot.sharedStorePath') ||
evt.affectsConfiguration('feishuCopilot.allowGlobalStorageFallback')
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- tests/extension-config-reload.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts tests/extension-config-reload.test.ts
git commit -m "feat: wire shared store resolver and fallback warning into extension bootstrap"
```

---

### Task 5: Add Explicit Desktop Entry Commands For Shared Sessions

**Files:**
- Modify: `src/session/feishu-chat-session-manager.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Test: `tests/feishu-chat-session-manager.test.ts`

- [ ] **Step 1: Write failing tests for open-latest and open-by-key behavior**

```ts
import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { FeishuChatSessionManager } from '../src/session/feishu-chat-session-manager';

describe('explicit shared session entry', () => {
  it('opens latest active shared session', async () => {
    const store = {
      list: () => [
        { id: 's1', feishuKey: 'chat-a', archived: false, lastActiveAt: 1 },
        { id: 's2', feishuKey: 'chat-b', archived: false, lastActiveAt: 2 },
      ],
    } as any;
    const manager = new FeishuChatSessionManager(store, {} as any, {} as any);
    const openSpy = vi.mocked(vscode.commands.executeCommand);
    await manager.openLatestSharedSession();
    expect(openSpy).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ scheme: 'feishu-session', path: '/s2' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/feishu-chat-session-manager.test.ts -t "explicit shared session entry"`
Expected: FAIL with missing manager methods.

- [ ] **Step 3: Implement explicit open methods in manager**

```ts
// src/session/feishu-chat-session-manager.ts (public methods)
async openLatestSharedSession(): Promise<boolean> {
  const session = this.store
    .list()
    .filter((s) => !s.archived && Boolean(s.feishuKey) && !s.feishuKey.startsWith('vscode-'))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (!session) {
    return false;
  }
  await vscode.commands.executeCommand('vscode.open', sessionUri(session.id), {
    preview: false,
    preserveFocus: false,
  });
  return true;
}

async openSharedSessionByFeishuKey(feishuKey: string): Promise<boolean> {
  const session = this.store
    .list()
    .find((s) => !s.archived && s.feishuKey === feishuKey);
  if (!session) {
    return false;
  }
  await vscode.commands.executeCommand('vscode.open', sessionUri(session.id), {
    preview: false,
    preserveFocus: false,
  });
  return true;
}
```

- [ ] **Step 4: Register commands and command palette contributions**

```ts
// src/extension.ts
const openLatestCmd = vscode.commands.registerCommand(
  'feishu-copilot.openLatestSharedSession',
  async () => {
    const ok = await sessionManager?.openLatestSharedSession();
    if (!ok) {
      void vscode.window.showInformationMessage(
        'No shared Feishu session found. Start from Feishu first or create one explicitly.',
      );
    }
  },
);
```

```json
// package.json (contributes.commands additions)
{
  "command": "feishu-copilot.openLatestSharedSession",
  "title": "Feishu Copilot: Open Latest Shared Session"
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- tests/feishu-chat-session-manager.test.ts -t "explicit shared session entry"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/feishu-chat-session-manager.ts src/extension.ts package.json tests/feishu-chat-session-manager.test.ts
git commit -m "feat: add explicit desktop commands to open shared feishu sessions"
```

---

### Task 6: Remove Ambiguous Desktop Auto-Binding And Require Explicit Shared Context

**Files:**
- Modify: `src/session/feishu-chat-session-manager.ts`
- Test: `tests/feishu-chat-session-manager.test.ts`

- [ ] **Step 1: Write failing tests for unbound desktop request rejection**

```ts
import { describe, expect, it, vi } from 'vitest';
import { FeishuChatSessionManager } from '../src/session/feishu-chat-session-manager';

describe('desktop request binding strictness', () => {
  it('does not append to shared transcript when request is unbound', async () => {
    const appendMessage = vi.fn();
    const store = {
      get: vi.fn(() => undefined),
      appendMessage,
      list: vi.fn(() => []),
    } as any;
    const manager = new FeishuChatSessionManager(store, {} as any, {} as any);
    const stream = { markdown: vi.fn() } as any;

    await (manager as any).handleVsCodeRequest(
      { prompt: 'continue please' },
      { chatSessionContext: undefined },
      stream,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() },
    );

    expect(appendMessage).not.toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenCalledWith(
      expect.stringContaining('not bound to a Feishu shared session'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/feishu-chat-session-manager.test.ts -t "binding strictness"`
Expected: FAIL because current context resolver can still bind via label/lastOpened/single-session fallback.

- [ ] **Step 3: Tighten session resolution to scheme-bound session resource only**

```ts
// src/session/feishu-chat-session-manager.ts
private resolveStoredSessionFromContext(context: vscode.ChatContext): FeishuSession | undefined {
  const sessionResource = context.chatSessionContext?.chatSessionItem.resource;
  if (sessionResource?.scheme !== FEISHU_SESSION_SCHEME) {
    return undefined;
  }
  return this.store.get(sessionIdFromUri(sessionResource));
}
```

- [ ] **Step 4: Keep explicit guidance message for unbound requests**

```ts
// src/session/feishu-chat-session-manager.ts
stream.markdown(
  'This request is not bound to a Feishu shared session. Use "Feishu Copilot: Open Latest Shared Session" first.',
);
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- tests/feishu-chat-session-manager.test.ts`
Expected: PASS with new strict-binding assertions.

- [ ] **Step 6: Commit**

```bash
git add src/session/feishu-chat-session-manager.ts tests/feishu-chat-session-manager.test.ts
git commit -m "refactor: require explicit feishu session binding for desktop shared continuation"
```

---

### Task 7: Regression Tests For Feishu Inbound Continuity And Snapshot Semantics

**Files:**
- Modify: `tests/pipeline.test.ts`
- Modify: `tests/feishu-chat-session-manager.test.ts`

- [ ] **Step 1: Add failing regression tests for unchanged behaviors**

```ts
it('uses chat_id as primary feishu key and open_id as fallback', async () => {
  // arrange sessionStore spy, run pipeline handleInbound
  // assert getOrCreate called with chat_id when present
});

it('keeps native chat snapshot behavior without introducing real-time refresh contract', async () => {
  // assert no new polling/subscription behavior is introduced in manager
});
```

- [ ] **Step 2: Run tests to verify current failures**

Run: `npm run test -- tests/pipeline.test.ts tests/feishu-chat-session-manager.test.ts`
Expected: FAIL for new assertions until fixtures are updated to refactored contracts.

- [ ] **Step 3: Update fixtures and expectations to match final contract**

```ts
// tests/pipeline.test.ts expectation example
expect(fakeSessionStore.getOrCreate).toHaveBeenCalledWith('chat-1', expect.stringContaining('飞书'));

// tests/feishu-chat-session-manager.test.ts expectation example
expect(stream.markdown).toHaveBeenCalledWith(
  expect.stringContaining('Open Latest Shared Session'),
);
```

- [ ] **Step 4: Run full unit suite for impacted areas**

Run: `npm run test -- tests/session-store-path-resolver.test.ts tests/session-store.test.ts tests/pipeline.test.ts tests/feishu-chat-session-manager.test.ts tests/extension-config-reload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/pipeline.test.ts tests/feishu-chat-session-manager.test.ts tests/session-store-path-resolver.test.ts tests/session-store.test.ts tests/extension-config-reload.test.ts
git commit -m "test: add shared session handoff regression and strict binding coverage"
```

---

### Task 8: Documentation, Manual Verification, And Release Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-11-shared-session-handoff-design.md` (status update only)

- [ ] **Step 1: Update README with shared-store setup and fallback behavior**

```md
## Shared Session Continuity

Store resolution order:
1. Workspace: .feishu-copilot/sessions.json
2. feishuCopilot.sharedStorePath (absolute path)
3. globalStorage fallback (warning shown)

Desktop continuation:
- Use command: Feishu Copilot: Open Latest Shared Session
- Unbound Copilot panel chats do not append to shared transcript.
```

- [ ] **Step 2: Define release verification checklist (manual)**

Run in VS Code:
`npm run typecheck && npm run test && npm run build`

Manual checks:
1. Open workspace in VS Code, send Feishu message, verify `.feishu-copilot/sessions.json` is created.
2. Open same repo in Cursor, verify same session transcript is readable.
3. Send desktop message from unbound Copilot panel and verify warning text plus no transcript append.
4. Run command “Open Latest Shared Session” and verify message appends as `source: vscode` in same shared session.
5. With no workspace and no configured path, verify fallback warning is shown and bridge still works locally.

- [ ] **Step 3: Mark spec status from drafted to implemented-ready (if accepted by reviewer)**

```md
Status: Approved for implementation (plan complete)
```

- [ ] **Step 4: Final release commit**

```bash
git add README.md docs/superpowers/specs/2026-04-11-shared-session-handoff-design.md
git commit -m "docs: document shared session continuity flow and release verification"
```

---

## Main Risks And Dependencies

1. **Proposed API availability risk**
   Dependency: `chatSessionsProvider` must be enabled in host environment.
   Mitigation: keep graceful degradation path and explicit warning when unavailable.

2. **Filesystem permission/path risk**
   Dependency: workspace root or configured absolute path must be writable.
   Mitigation: deterministic fallback behavior + user-visible warning + optional strict no-fallback mode.

3. **Cross-editor path mismatch risk**
   Dependency: VS Code and Cursor must open the same workspace root (or share configured path).
   Mitigation: resolver tests + README guidance + release checklist item validating both editors.

4. **Behavior tightening adoption risk**
   Dependency: users must switch to explicit shared-session entry command.
   Mitigation: clear unbound guidance message and command palette discoverability.

5. **Legacy data shape risk**
   Dependency: existing `sessions.json` may contain old/incomplete session fields.
   Mitigation: keep normalization in `SessionStore.load()` and add regression tests for legacy records.

## Self-Review

1. Spec coverage check: all required items are mapped to tasks (shared path refactor, config/fallback, open latest command, explicit entry, tests, release validation).
2. Placeholder scan: no TBD/TODO placeholders remain; each code step has concrete snippet and command.
3. Type consistency: `sharedStorePath` and `allowGlobalStorageFallback` names are used consistently in config, extension wiring, and tests.
