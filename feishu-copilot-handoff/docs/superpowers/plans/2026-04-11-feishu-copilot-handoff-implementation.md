# Feishu Copilot Handoff Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that mirrors the most recently active Copilot Chat session to Feishu and treats Feishu messages as remote keyboard input submitted into that active Copilot Chat session.

**Architecture:** Create a new extension project under `projects/feishu-copilot-handoff` with four core subsystems: Feishu transport, Copilot session discovery/parsing, active-session state management, and bridge orchestration. The bridge watches all local Copilot chat JSONL sessions, promotes the newest user-driven session as the active handoff target by default, supports Feishu-side manual override with `/sessions`, `/switch`, `/follow-latest`, and `/status`, and injects Feishu input back into VS Code through chat commands instead of maintaining a second transcript store.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js fs/path, `@larksuiteoapi/node-sdk`, Vitest

---

## Scope Check

This plan covers one subsystem: the `feishu-copilot-handoff` extension. It intentionally excludes `/new` session creation from phase 1 because new-session creation depends on unstable internal command behavior and is not required for the core handoff workflow.

## Planned File Structure

### Create

- `package.json`
  - Extension manifest, scripts, configuration schema, commands, activation events.
- `tsconfig.json`
  - TypeScript compiler config for the extension.
- `vitest.config.ts`
  - Unit test runner config.
- `src/extension.ts`
  - Extension activation, command registration, lifecycle wiring.
- `src/config.ts`
  - Read and validate VS Code configuration.
- `src/types.ts`
  - Shared domain types for sessions, Feishu commands, bridge state.
- `src/feishu/client.ts`
  - Token fetch, text send, card send, card update.
- `src/feishu/event-source.ts`
  - WebSocket subscription and Feishu inbound message normalization.
- `src/copilot/session-discovery.ts`
  - Resolve workspace chatSessions directory and enumerate JSONL files.
- `src/copilot/session-parser.ts`
  - Parse JSONL snapshots and deltas into typed session metadata and turns.
- `src/copilot/active-session-tracker.ts`
  - Track all sessions, determine active session, support manual lock/follow-latest.
- `src/copilot/chat-command-service.ts`
  - Inject Feishu text into Copilot Chat using VS Code commands.
- `src/handoff/feishu-renderer.ts`
  - Format Feishu status, list, switch, and mirrored transcript output.
- `src/handoff/bridge-controller.ts`
  - Coordinate watcher events, Feishu commands, and remote submit flow.
- `tests/config.test.ts`
  - Config parsing and validation.
- `tests/feishu-client.test.ts`
  - Feishu REST client behavior.
- `tests/session-parser.test.ts`
  - JSONL parsing and turn extraction.
- `tests/active-session-tracker.test.ts`
  - Auto-follow vs manual-lock state transitions.
- `tests/chat-command-service.test.ts`
  - Copilot command execution behavior.
- `tests/bridge-controller.test.ts`
  - End-to-end orchestration across mirror, switch, and inbound submit flows.

### Modify

- None. This project starts from scratch under `feishu-copilot-handoff`.

---

### Task 1: Scaffold The New Extension Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing config test**

```ts
import { describe, expect, it } from 'vitest';
import { readExtensionConfig } from '../src/config';

const makeConfig = (values: Record<string, unknown>) => ({
  get<T>(key: string, defaultValue: T): T {
    return (key in values ? (values[key] as T) : defaultValue);
  },
});

describe('readExtensionConfig', () => {
  it('returns trimmed settings and defaults', () => {
    const config = readExtensionConfig(makeConfig({
      feishuAppId: ' cli_app ',
      feishuAppSecret: ' secret ',
      ownerOpenId: ' ou_123 ',
      targetChatId: ' oc_123 ',
    }));

    expect(config).toEqual({
      feishuAppId: 'cli_app',
      feishuAppSecret: 'secret',
      ownerOpenId: 'ou_123',
      targetChatId: 'oc_123',
      statusCardEnabled: true,
      maxMirroredSessions: 8,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL with `Cannot find module '../src/config'` or equivalent TypeScript resolution error.

- [ ] **Step 3: Write minimal project scaffold and config implementation**

```json
{
  "name": "feishu-copilot-handoff",
  "version": "0.1.0",
  "private": true,
  "publisher": "feishu-copilot",
  "displayName": "Feishu Copilot Handoff",
  "description": "Mirror the active Copilot Chat session to Feishu and accept remote handoff input.",
  "main": "./dist/extension.js",
  "engines": {
    "vscode": "^1.100.0",
    "node": ">=22"
  },
  "activationEvents": [
    "onStartupFinished",
    "onCommand:feishuCopilotHandoff.start",
    "onCommand:feishuCopilotHandoff.stop",
    "onCommand:feishuCopilotHandoff.status"
  ],
  "contributes": {
    "commands": [
      { "command": "feishuCopilotHandoff.start", "title": "Feishu Copilot Handoff: Start" },
      { "command": "feishuCopilotHandoff.stop", "title": "Feishu Copilot Handoff: Stop" },
      { "command": "feishuCopilotHandoff.status", "title": "Feishu Copilot Handoff: Status" }
    ],
    "configuration": {
      "title": "Feishu Copilot Handoff",
      "properties": {
        "feishuCopilotHandoff.feishuAppId": { "type": "string", "default": "" },
        "feishuCopilotHandoff.feishuAppSecret": { "type": "string", "default": "" },
        "feishuCopilotHandoff.ownerOpenId": { "type": "string", "default": "" },
        "feishuCopilotHandoff.targetChatId": { "type": "string", "default": "" },
        "feishuCopilotHandoff.statusCardEnabled": { "type": "boolean", "default": true },
        "feishuCopilotHandoff.maxMirroredSessions": { "type": "number", "default": 8 }
      }
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.15.30",
    "@types/vscode": "^1.100.0",
    "typescript": "^5.8.3",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.60.0"
  }
}
```

```ts
export interface ExtensionConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  ownerOpenId: string;
  targetChatId: string;
  statusCardEnabled: boolean;
  maxMirroredSessions: number;
}

export interface CopilotTurn {
  requestId: string;
  userText: string;
  assistantText: string;
  timestamp: number;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  lastUserMessageAt: number;
  lastAssistantMessageAt: number;
  lastFileWriteAt: number;
  turns: CopilotTurn[];
}

export type SessionSelectionMode = 'follow-latest' | 'manual-lock';
```

```ts
import type { ExtensionConfig } from './types';

export interface ConfigurationLike {
  get<T>(key: string, defaultValue: T): T;
}

export function readExtensionConfig(config: ConfigurationLike): ExtensionConfig {
  return {
    feishuAppId: config.get('feishuAppId', '').trim(),
    feishuAppSecret: config.get('feishuAppSecret', '').trim(),
    ownerOpenId: config.get('ownerOpenId', '').trim(),
    targetChatId: config.get('targetChatId', '').trim(),
    statusCardEnabled: config.get('statusCardEnabled', true),
    maxMirroredSessions: config.get('maxMirroredSessions', 8),
  };
}
```

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      enabled: false,
    },
  },
});
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "node",
    "types": ["node", "vitest/globals", "vscode"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/config.test.ts`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/types.ts src/config.ts tests/config.test.ts
git commit -m "feat: scaffold feishu copilot handoff extension"
```

### Task 2: Implement Feishu Transport Layer

**Files:**
- Create: `src/feishu/client.ts`
- Create: `src/feishu/event-source.ts`
- Create: `tests/feishu-client.test.ts`

- [ ] **Step 1: Write the failing Feishu transport tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { getTenantAccessToken, sendFeishuText } from '../src/feishu/client';

describe('feishu client', () => {
  it('fetches tenant access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ code: 0, tenant_access_token: 'token_123' }),
    });

    const token = await getTenantAccessToken('app', 'secret', fetchMock as typeof fetch);
    expect(token).toBe('token_123');
  });

  it('sends text to configured chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ code: 0, data: { message_id: 'msg_1' } }),
    });

    const messageId = await sendFeishuText(
      'token_123',
      'oc_123',
      'hello',
      fetchMock as typeof fetch,
    );

    expect(messageId).toBe('msg_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-client.test.ts`
Expected: FAIL with missing module or missing exports.

- [ ] **Step 3: Write minimal Feishu client and event source**

```ts
const BASE_URL = 'https://open.feishu.cn/open-apis';

export class FeishuApiError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = 'FeishuApiError';
  }
}

async function postJson<T>(url: string, body: unknown, token?: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as { code: number; msg?: string } & Record<string, unknown>;
  if (payload.code !== 0) {
    throw new FeishuApiError(payload.msg ?? 'Unknown Feishu error', payload.code);
  }
  return payload as T;
}

export async function getTenantAccessToken(
  appId: string,
  appSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const result = await postJson<{ tenant_access_token: string }>(
    `${BASE_URL}/auth/v3/tenant_access_token/internal`,
    { app_id: appId, app_secret: appSecret },
    undefined,
    fetchImpl,
  );
  return result.tenant_access_token;
}

export async function sendFeishuText(
  token: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const result = await postJson<{ data: { message_id: string } }>(
    `${BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
    {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
    token,
    fetchImpl,
  );
  return result.data.message_id;
}
```

```ts
import * as Lark from '@larksuiteoapi/node-sdk';

export interface FeishuInboundMessage {
  senderOpenId: string;
  chatId: string;
  messageId: string;
  text: string;
  createTime: number;
}

export interface FeishuEventSourceOptions {
  appId: string;
  appSecret: string;
  onMessage: (message: FeishuInboundMessage) => Promise<void>;
  onError?: (error: unknown) => void;
}

export function startFeishuEventSource(options: FeishuEventSourceOptions): { dispose: () => void } {
  const dispatcher = new Lark.EventDispatcher({});
  dispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      const event = data?.event ?? data;
      const text = JSON.parse(event.message.content).text ?? '';
      await options.onMessage({
        senderOpenId: event.sender.sender_id.open_id,
        chatId: event.message.chat_id,
        messageId: event.message.message_id,
        text,
        createTime: Number(event.message.create_time),
      });
    },
  } as Record<string, (payload: unknown) => Promise<void>>);

  const client = new Lark.WSClient({
    appId: options.appId,
    appSecret: options.appSecret,
    autoReconnect: true,
    loggerLevel: Lark.LoggerLevel.warn,
  });

  void client.start({ eventDispatcher: dispatcher }).catch((error) => options.onError?.(error));
  return { dispose: () => client.close({ force: true }) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishu-client.test.ts`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/client.ts src/feishu/event-source.ts tests/feishu-client.test.ts
git commit -m "feat: add feishu transport layer"
```

### Task 3: Parse Copilot Chat Sessions And Track The Active Target

**Files:**
- Create: `src/copilot/session-discovery.ts`
- Create: `src/copilot/session-parser.ts`
- Create: `src/copilot/active-session-tracker.ts`
- Create: `tests/session-parser.test.ts`
- Create: `tests/active-session-tracker.test.ts`

- [ ] **Step 1: Write the failing parser and tracker tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseChatSessionJsonl } from '../src/copilot/session-parser';
import { ActiveSessionTracker } from '../src/copilot/active-session-tracker';

describe('parseChatSessionJsonl', () => {
  it('extracts user and assistant turns from the snapshot line', () => {
    const jsonl = [
      JSON.stringify({
        kind: 0,
        v: {
          customTitle: 'React 重构',
          sessionId: 'session-1',
          requests: [
            {
              requestId: 'req-1',
              timestamp: 100,
              message: { text: 'hello' },
              response: [{ kind: 'markdownContent', value: 'world' }],
            },
          ],
        },
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-1.jsonl', jsonl, 200);
    expect(summary.title).toBe('React 重构');
    expect(summary.turns[0]).toEqual({
      requestId: 'req-1',
      userText: 'hello',
      assistantText: 'world',
      timestamp: 100,
    });
  });
});

describe('ActiveSessionTracker', () => {
  it('follows newest user-driven session by default and supports manual lock', () => {
    const tracker = new ActiveSessionTracker();

    tracker.upsert({ sessionId: 'a', title: 'A', lastUserMessageAt: 10, lastAssistantMessageAt: 20, lastFileWriteAt: 20, turns: [] });
    tracker.upsert({ sessionId: 'b', title: 'B', lastUserMessageAt: 30, lastAssistantMessageAt: 40, lastFileWriteAt: 40, turns: [] });
    expect(tracker.getCurrentTarget()?.sessionId).toBe('b');

    tracker.lockToSession('a');
    tracker.upsert({ sessionId: 'b', title: 'B', lastUserMessageAt: 50, lastAssistantMessageAt: 60, lastFileWriteAt: 60, turns: [] });
    expect(tracker.getCurrentTarget()?.sessionId).toBe('a');

    tracker.followLatest();
    expect(tracker.getCurrentTarget()?.sessionId).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/session-parser.test.ts tests/active-session-tracker.test.ts`
Expected: FAIL with missing parser/tracker modules.

- [ ] **Step 3: Write session discovery, parser, and tracker**

```ts
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export async function listChatSessionFiles(storagePath: string): Promise<string[]> {
  const chatSessionsDir = path.join(storagePath, 'chatSessions');
  const entries = await fs.readdir(chatSessionsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(chatSessionsDir, entry.name));
}
```

```ts
import type { CopilotTurn, SessionSummary } from '../types';

function collectAssistantText(response: Array<{ kind?: string; value?: string }> | undefined): string {
  return (response ?? [])
    .filter((part) => part.kind === 'markdownContent')
    .map((part) => part.value ?? '')
    .join('');
}

export function parseChatSessionJsonl(fileName: string, content: string, fileWriteTime: number): SessionSummary {
  const lines = content.split('\n').filter(Boolean);
  const snapshot = JSON.parse(lines[0]) as {
    v: {
      sessionId: string;
      customTitle?: string;
      requests?: Array<{
        requestId: string;
        timestamp: number;
        message?: { text?: string };
        response?: Array<{ kind?: string; value?: string }>;
      }>;
    };
  };

  const turns: CopilotTurn[] = (snapshot.v.requests ?? []).map((request) => ({
    requestId: request.requestId,
    userText: request.message?.text ?? '',
    assistantText: collectAssistantText(request.response),
    timestamp: request.timestamp,
  }));

  const lastUserMessageAt = turns.reduce((max, turn) => Math.max(max, turn.timestamp), 0);
  const lastAssistantMessageAt = turns.reduce((max, turn) => (turn.assistantText ? Math.max(max, turn.timestamp) : max), 0);

  return {
    sessionId: snapshot.v.sessionId || fileName.replace(/\.jsonl$/, ''),
    title: snapshot.v.customTitle?.trim() || fileName.replace(/\.jsonl$/, ''),
    lastUserMessageAt,
    lastAssistantMessageAt,
    lastFileWriteAt: fileWriteTime,
    turns,
  };
}
```

```ts
import type { SessionSelectionMode, SessionSummary } from '../types';

export class ActiveSessionTracker {
  private readonly sessions = new Map<string, SessionSummary>();
  private mode: SessionSelectionMode = 'follow-latest';
  private lockedSessionId: string | undefined;

  upsert(summary: SessionSummary): void {
    this.sessions.set(summary.sessionId, summary);
  }

  listRecent(limit = 8): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((left, right) => right.lastUserMessageAt - left.lastUserMessageAt)
      .slice(0, limit);
  }

  lockToSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.mode = 'manual-lock';
    this.lockedSessionId = sessionId;
  }

  followLatest(): void {
    this.mode = 'follow-latest';
    this.lockedSessionId = undefined;
  }

  getMode(): SessionSelectionMode {
    return this.mode;
  }

  getCurrentTarget(): SessionSummary | undefined {
    if (this.mode === 'manual-lock' && this.lockedSessionId) {
      return this.sessions.get(this.lockedSessionId);
    }

    return [...this.sessions.values()].sort((left, right) => {
      if (right.lastUserMessageAt !== left.lastUserMessageAt) {
        return right.lastUserMessageAt - left.lastUserMessageAt;
      }
      return right.lastFileWriteAt - left.lastFileWriteAt;
    })[0];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/session-parser.test.ts tests/active-session-tracker.test.ts`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/copilot/session-discovery.ts src/copilot/session-parser.ts src/copilot/active-session-tracker.ts tests/session-parser.test.ts tests/active-session-tracker.test.ts
git commit -m "feat: track active copilot chat session"
```

### Task 4: Mirror The Active Session To Feishu

**Files:**
- Create: `src/handoff/feishu-renderer.ts`
- Create: `src/handoff/bridge-controller.ts`
- Create: `tests/bridge-controller.test.ts`

- [ ] **Step 1: Write the failing bridge mirror test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { BridgeController } from '../src/handoff/bridge-controller';

describe('BridgeController mirror flow', () => {
  it('mirrors only the current target session to Feishu', async () => {
    const sendText = vi.fn().mockResolvedValue('msg_1');
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: sendText,
    });

    await controller.handleSessionUpdate({
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 100,
      lastAssistantMessageAt: 100,
      lastFileWriteAt: 100,
      turns: [{ requestId: 'r1', userText: 'hello', assistantText: 'world', timestamp: 100 }],
    });

    expect(sendText).toHaveBeenCalledWith(
      'oc_target',
      expect.stringContaining('React 重构'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bridge-controller.test.ts`
Expected: FAIL with missing module or constructor errors.

- [ ] **Step 3: Write renderer and mirror controller**

```ts
import type { SessionSummary } from '../types';

export function renderSessionSwitch(summary: SessionSummary): string {
  return [
    '已切换接力目标',
    `Session: ${summary.title}`,
    '状态: 后续飞书输入将直接提交到该会话',
  ].join('\n');
}

export function renderMirroredTurn(summary: SessionSummary): string {
  const turn = summary.turns.at(-1);
  if (!turn) {
    return `当前接力会话: ${summary.title}`;
  }

  return [
    `[当前接力会话] ${summary.title}`,
    '',
    '你:',
    turn.userText,
    '',
    'Copilot:',
    turn.assistantText,
  ].join('\n');
}
```

```ts
import { ActiveSessionTracker } from '../copilot/active-session-tracker';
import type { SessionSummary } from '../types';
import { renderMirroredTurn, renderSessionSwitch } from './feishu-renderer';

export interface BridgeControllerOptions {
  ownerOpenId: string;
  targetChatId: string;
  sendFeishuText: (chatId: string, text: string) => Promise<string>;
}

export class BridgeController {
  private readonly tracker = new ActiveSessionTracker();
  private lastMirroredRequestIdBySession = new Map<string, string>();
  private lastTargetSessionId: string | undefined;

  constructor(private readonly options: BridgeControllerOptions) {}

  async handleSessionUpdate(summary: SessionSummary): Promise<void> {
    this.tracker.upsert(summary);
    const currentTarget = this.tracker.getCurrentTarget();
    if (!currentTarget || currentTarget.sessionId !== summary.sessionId) {
      return;
    }

    if (this.lastTargetSessionId !== currentTarget.sessionId) {
      this.lastTargetSessionId = currentTarget.sessionId;
      await this.options.sendFeishuText(this.options.targetChatId, renderSessionSwitch(currentTarget));
    }

    const lastTurn = currentTarget.turns.at(-1);
    if (!lastTurn) {
      return;
    }

    const lastMirrored = this.lastMirroredRequestIdBySession.get(currentTarget.sessionId);
    if (lastMirrored === lastTurn.requestId) {
      return;
    }

    this.lastMirroredRequestIdBySession.set(currentTarget.sessionId, lastTurn.requestId);
    await this.options.sendFeishuText(this.options.targetChatId, renderMirroredTurn(currentTarget));
  }

  listRecentSessions(limit = 8): SessionSummary[] {
    return this.tracker.listRecent(limit);
  }

  lockSession(sessionId: string): void {
    this.tracker.lockToSession(sessionId);
  }

  followLatest(): void {
    this.tracker.followLatest();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bridge-controller.test.ts`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/handoff/feishu-renderer.ts src/handoff/bridge-controller.ts tests/bridge-controller.test.ts
git commit -m "feat: mirror active copilot session to feishu"
```

### Task 5: Submit Feishu Input Into Copilot Chat And Handle Remote Commands

**Files:**
- Create: `src/copilot/chat-command-service.ts`
- Modify: `src/handoff/bridge-controller.ts`
- Create: `tests/chat-command-service.test.ts`
- Modify: `tests/bridge-controller.test.ts`

- [ ] **Step 1: Write the failing command-injection and remote-command tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ChatCommandService } from '../src/copilot/chat-command-service';

describe('ChatCommandService', () => {
  it('submits Feishu text into Copilot Chat', async () => {
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const service = new ChatCommandService(executeCommand);

    await service.submitToChat('帮我继续修这个 bug');

    expect(executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', {
      query: '帮我继续修这个 bug',
    });
  });
});
```

```ts
import { describe, expect, it, vi } from 'vitest';
import { BridgeController } from '../src/handoff/bridge-controller';

describe('BridgeController remote commands', () => {
  it('locks a chosen session and returns status text for follow-latest', async () => {
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: vi.fn().mockResolvedValue('msg_1'),
    });

    await controller.handleSessionUpdate({ sessionId: 'a', title: 'A', lastUserMessageAt: 10, lastAssistantMessageAt: 10, lastFileWriteAt: 10, turns: [] });
    await controller.handleSessionUpdate({ sessionId: 'b', title: 'B', lastUserMessageAt: 20, lastAssistantMessageAt: 20, lastFileWriteAt: 20, turns: [] });

    const sessionsText = controller.renderSessionsList();
    expect(sessionsText).toContain('1. B');
    expect(sessionsText).toContain('2. A');

    controller.switchByIndex(2);
    expect(controller.getStatusText()).toContain('manual-lock');

    controller.followLatest();
    expect(controller.getStatusText()).toContain('follow-latest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/chat-command-service.test.ts tests/bridge-controller.test.ts`
Expected: FAIL with missing command service or missing bridge methods.

- [ ] **Step 3: Implement command submission and Feishu-side command routing**

```ts
export type ExecuteCommand = (command: string, ...args: unknown[]) => Thenable<unknown>;

export class ChatCommandService {
  constructor(private readonly executeCommand: ExecuteCommand) {}

  async submitToChat(text: string): Promise<void> {
    await this.executeCommand('workbench.action.chat.open', { query: text });
  }
}
```

```ts
// Add these methods to BridgeController
renderSessionsList(): string {
  return this.listRecentSessions()
    .map((session, index) => `${index + 1}. ${session.title}`)
    .join('\n');
}

switchByIndex(index: number): void {
  const target = this.listRecentSessions()[index - 1];
  if (!target) {
    throw new Error(`Unknown session index: ${index}`);
  }
  this.lockSession(target.sessionId);
}

getStatusText(): string {
  const target = this.tracker.getCurrentTarget();
  return [
    `mode: ${this.tracker.getMode()}`,
    `session: ${target?.title ?? 'none'}`,
  ].join('\n');
}
```

```ts
// Add this method to BridgeController
async handleFeishuText(text: string, submitToChat: (text: string) => Promise<void>): Promise<string | undefined> {
  const trimmed = text.trim();
  if (trimmed === '/sessions') {
    return this.renderSessionsList();
  }

  if (trimmed === '/follow-latest') {
    this.followLatest();
    return this.getStatusText();
  }

  if (trimmed === '/status') {
    return this.getStatusText();
  }

  const match = /^\/switch\s+(\d+)$/.exec(trimmed);
  if (match) {
    this.switchByIndex(Number(match[1]));
    return this.getStatusText();
  }

  await submitToChat(text);
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/chat-command-service.test.ts tests/bridge-controller.test.ts`
Expected: PASS with all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/copilot/chat-command-service.ts src/handoff/bridge-controller.ts tests/chat-command-service.test.ts tests/bridge-controller.test.ts
git commit -m "feat: add feishu remote control commands"
```

### Task 6: Wire VS Code Activation And End-To-End Handoff Flow

**Files:**
- Create: `src/extension.ts`
- Modify: `src/handoff/bridge-controller.ts`
- Modify: `src/copilot/session-discovery.ts`
- Modify: `src/copilot/session-parser.ts`
- Modify: `tests/bridge-controller.test.ts`

- [ ] **Step 1: Write the failing activation integration test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { activate } from '../src/extension';

describe('activate', () => {
  it('registers start, stop, and status commands', async () => {
    const subscriptions: { dispose: () => void }[] = [];
    const commands = {
      registerCommand: vi.fn((_id: string, handler: () => unknown) => {
        subscriptions.push({ dispose: () => void handler });
        return subscriptions.at(-1)!;
      }),
      executeCommand: vi.fn(),
    };

    await activate({ subscriptions } as any, {
      commands,
      workspaceStoragePath: '/tmp/workspace-storage',
    } as any);

    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.start', expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.stop', expect.any(Function));
    expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.status', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bridge-controller.test.ts`
Expected: FAIL because `src/extension.ts` and lifecycle wiring do not exist yet.

- [ ] **Step 3: Implement activation and watcher flow**

```ts
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readExtensionConfig } from './config';
import { getTenantAccessToken, sendFeishuText } from './feishu/client';
import { startFeishuEventSource } from './feishu/event-source';
import { listChatSessionFiles } from './copilot/session-discovery';
import { parseChatSessionJsonl } from './copilot/session-parser';
import { ChatCommandService } from './copilot/chat-command-service';
import { BridgeController } from './handoff/bridge-controller';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = readExtensionConfig(vscode.workspace.getConfiguration('feishuCopilotHandoff'));
  const commandService = new ChatCommandService(vscode.commands.executeCommand.bind(vscode.commands));
  let eventSource: { dispose: () => void } | undefined;

  const token = config.feishuAppId && config.feishuAppSecret
    ? await getTenantAccessToken(config.feishuAppId, config.feishuAppSecret)
    : '';

  const controller = new BridgeController({
    ownerOpenId: config.ownerOpenId,
    targetChatId: config.targetChatId,
    sendFeishuText: (chatId, text) => sendFeishuText(token, chatId, text),
  });

  async function refreshSessions(): Promise<void> {
    if (!context.storageUri) {
      return;
    }

    const files = await listChatSessionFiles(context.storageUri.fsPath);
    for (const filePath of files) {
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      const summary = parseChatSessionJsonl(path.basename(filePath), content, stat.mtimeMs);
      await controller.handleSessionUpdate(summary);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('feishuCopilotHandoff.start', async () => {
      await refreshSessions();
      eventSource = startFeishuEventSource({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
        onMessage: async (message) => {
          if (message.senderOpenId !== config.ownerOpenId) {
            return;
          }

          const reply = await controller.handleFeishuText(message.text, (text) => commandService.submitToChat(text));
          if (reply) {
            await sendFeishuText(token, config.targetChatId, reply);
          }
        },
      });
    }),
    vscode.commands.registerCommand('feishuCopilotHandoff.stop', async () => {
      eventSource?.dispose();
      eventSource = undefined;
    }),
    vscode.commands.registerCommand('feishuCopilotHandoff.status', async () => {
      void vscode.window.showInformationMessage(controller.getStatusText());
    }),
  );
}

export function deactivate(): void {}
```

- [ ] **Step 4: Run tests to verify the end-to-end flow passes**

Run: `npm test`
Expected: PASS with all unit tests green.

Run: `npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/handoff/bridge-controller.ts src/copilot/session-discovery.ts src/copilot/session-parser.ts tests/bridge-controller.test.ts
git commit -m "feat: wire end-to-end feishu copilot handoff"
```

## Self-Review

### Spec Coverage

- Recent active session auto-follow: covered in Task 3 and Task 4.
- Feishu as monitor for the current active session: covered in Task 4.
- Feishu text as remote keyboard input into Copilot Chat: covered in Task 5 and Task 6.
- Manual switch and follow-latest commands: covered in Task 5.
- Single active target with no independent Feishu transcript store: enforced by Task 3 and Task 4 design.
- `/new` session creation explicitly excluded from phase 1: documented in Scope Check.

### Placeholder Scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Every task includes code, exact commands, expected failures, expected passes, and commit steps.

### Type Consistency

- `SessionSummary`, `CopilotTurn`, `SessionSelectionMode`, and `ExtensionConfig` are defined once in Task 1 and reused consistently in later tasks.
- `handleFeishuText`, `renderSessionsList`, `switchByIndex`, and `getStatusText` are introduced before they are referenced by Task 6.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-feishu-copilot-handoff-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using the `executing-plans` agent, batch execution with checkpoints

**Which approach?**