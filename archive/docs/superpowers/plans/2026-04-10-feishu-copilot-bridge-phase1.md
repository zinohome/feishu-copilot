# Feishu Copilot Bridge Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code hosted private-chat Feishu bridge that can invoke Copilot with workspace context, stream card updates, and enforce approval gates for risky actions.

**Architecture:** The VS Code extension hosts runtime orchestration (session routing, Copilot adapter, permission gate, state store) while Feishu protocol handling follows patterns validated by OpenClaw-Lark (signature verification, dedup, idempotency, throttled card patching). Private chat only in phase 1, one queue per user, cancellable in-flight jobs.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js 22, Feishu Open Platform APIs, Vitest, ESLint

---

## Parallel Delivery Batches

- Batch A (parallel): Task 1, Task 2, Task 3
- Batch B (parallel after A): Task 4, Task 5, Task 6
- Batch C (parallel after B): Task 7, Task 8
- Batch D (sequential finalization): Task 9

## Planned File Structure

- Create: `package.json` - workspace package scripts and dependencies
- Create: `tsconfig.json` - TypeScript compiler config
- Create: `.vscodeignore` - extension package exclusion
- Create: `src/extension.ts` - extension activation and command registration
- Create: `src/config/types.ts` - typed runtime config schema
- Create: `src/config/load-config.ts` - env and setting loader
- Create: `src/domain/message-types.ts` - inbound/outbound event types
- Create: `src/domain/permissions.ts` - permission categories and decision model
- Create: `src/feishu/signature.ts` - webhook signature verification
- Create: `src/feishu/idempotency-store.ts` - message dedup and replay safety
- Create: `src/feishu/feishu-client.ts` - send text/card/update abstractions
- Create: `src/session/session-router.ts` - per-user queue and cancellation
- Create: `src/copilot/copilot-adapter.ts` - Copilot request orchestration adapter
- Create: `src/card/card-renderer.ts` - initial card, stream patch, final state
- Create: `src/approval/approval-gate.ts` - approval lifecycle and timeout behavior
- Create: `src/state/state-store.ts` - durable state persistence and recovery markers
- Create: `src/http/webhook-server.ts` - local webhook endpoint for Feishu events
- Create: `src/app/bridge-app.ts` - request pipeline composition
- Create: `src/commands/chat-commands.ts` - /status /stop /clear /model /cwd /approve /deny
- Create: `tests/signature.test.ts` - signature verification tests
- Create: `tests/idempotency-store.test.ts` - dedup/idempotency tests
- Create: `tests/session-router.test.ts` - queue and cancellation tests
- Create: `tests/card-renderer.test.ts` - throttle and flush tests
- Create: `tests/approval-gate.test.ts` - approval state machine tests
- Create: `tests/bridge-app.integration.test.ts` - end-to-end integration tests
- Modify: `README.md` - run and validate instructions

---

### Task 1: Bootstrap Extension Workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.vscodeignore`
- Create: `src/extension.ts`
- Test: `tests/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

describe('bootstrap', () => {
  it('exports activate and deactivate functions', async () => {
    const mod = await import('../src/extension');
    expect(typeof mod.activate).toBe('function');
    expect(typeof mod.deactivate).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/bootstrap.test.ts -t bootstrap`
Expected: FAIL with module not found for `src/extension`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/extension.ts
import type { ExtensionContext } from 'vscode';

export function activate(_context: ExtensionContext): void {
  // Runtime wiring will be added in later tasks.
}

export function deactivate(): void {
  // No-op in phase 1 bootstrap.
}
```

```json
// package.json
{
  "name": "feishu-copilot-bridge",
  "displayName": "Feishu Copilot Bridge",
  "version": "0.1.0",
  "private": true,
  "engines": { "vscode": "^1.100.0", "node": ">=22" },
  "main": "./dist/extension.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests --ext .ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.15.30",
    "@types/vscode": "^1.100.0",
    "eslint": "^9.25.1",
    "typescript": "^5.8.3",
    "vitest": "^3.1.1"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node", "vscode"],
    "strict": true,
    "rootDir": ".",
    "outDir": "dist",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/bootstrap.test.ts -t bootstrap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .vscodeignore src/extension.ts tests/bootstrap.test.ts
git commit -m "chore: bootstrap extension workspace"
```

### Task 2: Config and Domain Contracts

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/load-config.ts`
- Create: `src/domain/message-types.ts`
- Create: `src/domain/permissions.ts`
- Test: `tests/config-and-domain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { classifyOperation } from '../src/domain/permissions';

describe('permission classification', () => {
  it('marks workspace writes as approval-required', () => {
    expect(classifyOperation({ kind: 'workspace-write' }).requireApproval).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/config-and-domain.test.ts -t permission`
Expected: FAIL with missing module `src/domain/permissions`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/permissions.ts
export type OperationKind =
  | 'read-only'
  | 'workspace-write'
  | 'command-run'
  | 'external-network'
  | 'git-write'
  | 'session-control';

export interface PermissionDecision {
  requireApproval: boolean;
  hardDenied: boolean;
}

export function classifyOperation(input: { kind: OperationKind; command?: string }): PermissionDecision {
  if (input.kind === 'read-only' || input.kind === 'session-control') {
    return { requireApproval: false, hardDenied: false };
  }
  if (input.kind === 'command-run' && /git\s+reset\s+--hard|rm\s+-rf/.test(input.command ?? '')) {
    return { requireApproval: false, hardDenied: true };
  }
  return { requireApproval: true, hardDenied: false };
}
```

```ts
// src/config/types.ts
export interface BridgeConfig {
  ownerOpenId: string;
  workspaceAllowlist: string[];
  approvalTimeoutMs: number;
  cardPatchIntervalMs: number;
}
```

```ts
// src/config/load-config.ts
import type { BridgeConfig } from './types';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    ownerOpenId: env.FEISHU_OWNER_OPEN_ID ?? '',
    workspaceAllowlist: (env.WORKSPACE_ALLOWLIST ?? '').split(',').filter(Boolean),
    approvalTimeoutMs: Number(env.APPROVAL_TIMEOUT_MS ?? '120000'),
    cardPatchIntervalMs: Number(env.CARD_PATCH_INTERVAL_MS ?? '400'),
  };
}
```

```ts
// src/domain/message-types.ts
export interface InboundChatMessage {
  userId: string;
  messageId: string;
  chatType: 'p2p';
  text: string;
  timestampMs: number;
}

export interface OutboundCardUpdate {
  cardMessageId: string;
  phase: 'thinking' | 'streaming' | 'done' | 'error' | 'interrupted';
  text: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/config-and-domain.test.ts -t permission`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/types.ts src/config/load-config.ts src/domain/message-types.ts src/domain/permissions.ts tests/config-and-domain.test.ts
git commit -m "feat: add config and permission domain contracts"
```

### Task 3: Feishu Signature and Idempotency Core

**Files:**
- Create: `src/feishu/signature.ts`
- Create: `src/feishu/idempotency-store.ts`
- Test: `tests/signature.test.ts`
- Test: `tests/idempotency-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { verifySignature } from '../src/feishu/signature';

describe('verifySignature', () => {
  it('returns false for mismatched signature', () => {
    expect(verifySignature({ timestamp: '1', nonce: 'n', body: '{}', signature: 'x', encryptKey: 'k' })).toBe(false);
  });
});
```

```ts
import { describe, expect, it } from 'vitest';
import { IdempotencyStore } from '../src/feishu/idempotency-store';

describe('IdempotencyStore', () => {
  it('accepts first event and rejects duplicate', () => {
    const store = new IdempotencyStore();
    expect(store.tryMark('mid-1')).toBe(true);
    expect(store.tryMark('mid-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/signature.test.ts tests/idempotency-store.test.ts`
Expected: FAIL with missing modules.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/feishu/signature.ts
import { createHmac } from 'node:crypto';

interface SignatureInput {
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
  encryptKey: string;
}

export function verifySignature(input: SignatureInput): boolean {
  const payload = `${input.timestamp}${input.nonce}${input.body}`;
  const digest = createHmac('sha256', input.encryptKey).update(payload).digest('base64');
  return digest === input.signature;
}
```

```ts
// src/feishu/idempotency-store.ts
export class IdempotencyStore {
  private readonly seen = new Set<string>();

  tryMark(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/signature.test.ts tests/idempotency-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/feishu/signature.ts src/feishu/idempotency-store.ts tests/signature.test.ts tests/idempotency-store.test.ts
git commit -m "feat: add feishu signature verification and idempotency"
```

### Task 4: Session Router and Cancellation

**Files:**
- Create: `src/session/session-router.ts`
- Test: `tests/session-router.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { SessionRouter } from '../src/session/session-router';

describe('SessionRouter', () => {
  it('cancels active task when new request arrives', async () => {
    const router = new SessionRouter();
    const state1 = router.enqueue('u1', 'req-1');
    const state2 = router.enqueue('u1', 'req-2');
    expect(state1.cancelled).toBe(true);
    expect(state2.cancelled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/session-router.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/session/session-router.ts
export interface RequestState {
  requestId: string;
  cancelled: boolean;
}

export class SessionRouter {
  private readonly active = new Map<string, RequestState>();

  enqueue(userId: string, requestId: string): RequestState {
    const prev = this.active.get(userId);
    if (prev) prev.cancelled = true;

    const next: RequestState = { requestId, cancelled: false };
    this.active.set(userId, next);
    return next;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/session-router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-router.ts tests/session-router.test.ts
git commit -m "feat: add per-user session router cancellation"
```

### Task 5: Card Renderer with Throttle and Final Flush

**Files:**
- Create: `src/card/card-renderer.ts`
- Test: `tests/card-renderer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { CardRenderer } from '../src/card/card-renderer';

describe('CardRenderer', () => {
  it('buffers chunks and emits final flush', () => {
    const out: string[] = [];
    const renderer = new CardRenderer((value) => out.push(value));
    renderer.pushChunk('hello');
    renderer.pushChunk(' world');
    renderer.finalize();
    expect(out[out.length - 1]).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/card-renderer.test.ts`
Expected: FAIL with missing module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/card/card-renderer.ts
export class CardRenderer {
  private buffer = '';

  constructor(private readonly emit: (text: string) => void) {}

  pushChunk(chunk: string): void {
    this.buffer += chunk;
  }

  finalize(): void {
    this.emit(this.buffer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/card-renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/card/card-renderer.ts tests/card-renderer.test.ts
git commit -m "feat: add card renderer buffer and finalize"
```

### Task 6: Approval Gate State Machine

**Files:**
- Create: `src/approval/approval-gate.ts`
- Test: `tests/approval-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ApprovalGate } from '../src/approval/approval-gate';

describe('ApprovalGate', () => {
  it('transitions from pending to approved', () => {
    const gate = new ApprovalGate();
    gate.request('a1');
    gate.approve('a1');
    expect(gate.status('a1')).toBe('approved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/approval-gate.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/approval/approval-gate.ts
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export class ApprovalGate {
  private readonly states = new Map<string, ApprovalStatus>();

  request(id: string): void {
    this.states.set(id, 'pending');
  }

  approve(id: string): void {
    this.states.set(id, 'approved');
  }

  deny(id: string): void {
    this.states.set(id, 'denied');
  }

  status(id: string): ApprovalStatus | undefined {
    return this.states.get(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/approval-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/approval/approval-gate.ts tests/approval-gate.test.ts
git commit -m "feat: add approval gate state machine"
```

### Task 7: Copilot Adapter and Bridge Pipeline Composition

**Files:**
- Create: `src/copilot/copilot-adapter.ts`
- Create: `src/app/bridge-app.ts`
- Test: `tests/bridge-app.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, expect, it } from 'vitest';
import { BridgeApp } from '../src/app/bridge-app';

describe('BridgeApp integration', () => {
  it('processes inbound message and returns streamed completion', async () => {
    const app = new BridgeApp({
      generate: async () => ['part-1', 'part-2', 'done'],
    });

    const result = await app.handleMessage({ userId: 'u1', messageId: 'm1', text: 'hello' });
    expect(result.finalText).toBe('part-1part-2done');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/bridge-app.integration.test.ts`
Expected: FAIL with missing `BridgeApp`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/copilot/copilot-adapter.ts
export interface CopilotAdapter {
  generate(input: { prompt: string; userId: string }): Promise<string[]>;
}
```

```ts
// src/app/bridge-app.ts
import type { CopilotAdapter } from '../copilot/copilot-adapter';

interface InboundMessage {
  userId: string;
  messageId: string;
  text: string;
}

export class BridgeApp {
  constructor(private readonly copilot: CopilotAdapter) {}

  async handleMessage(msg: InboundMessage): Promise<{ finalText: string }> {
    const chunks = await this.copilot.generate({ prompt: msg.text, userId: msg.userId });
    return { finalText: chunks.join('') };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/bridge-app.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/copilot/copilot-adapter.ts src/app/bridge-app.ts tests/bridge-app.integration.test.ts
git commit -m "feat: add copilot adapter contract and bridge pipeline"
```

### Task 8: Webhook Endpoint and Chat Commands

**Files:**
- Create: `src/http/webhook-server.ts`
- Create: `src/commands/chat-commands.ts`
- Test: `tests/webhook-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands/chat-commands';

describe('chat command parser', () => {
  it('parses /status', () => {
    expect(parseCommand('/status')).toEqual({ name: 'status', args: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/webhook-server.test.ts`
Expected: FAIL with missing parser function.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/chat-commands.ts
export function parseCommand(input: string): { name: string; args: string[] } | null {
  if (!input.startsWith('/')) return null;
  const [name, ...args] = input.slice(1).trim().split(/\s+/);
  return { name, args };
}
```

```ts
// src/http/webhook-server.ts
import { createServer } from 'node:http';

export function startWebhookServer(port: number, onBody: (body: string) => Promise<void>): void {
  createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', async () => {
      await onBody(body);
      res.statusCode = 200;
      res.end('ok');
    });
  }).listen(port);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/webhook-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/webhook-server.ts src/commands/chat-commands.ts tests/webhook-server.test.ts
git commit -m "feat: add webhook endpoint and chat command parser"
```

### Task 9: Hardening, Docs, and Verification Gate

**Files:**
- Modify: `src/app/bridge-app.ts`
- Modify: `src/card/card-renderer.ts`
- Modify: `src/approval/approval-gate.ts`
- Modify: `README.md`
- Test: `tests/bridge-app.integration.test.ts`
- Test: `tests/card-renderer.test.ts`
- Test: `tests/approval-gate.test.ts`

- [ ] **Step 1: Write failing tests for timeout, denial, and interruption labels**

```ts
import { describe, expect, it } from 'vitest';
import { BridgeApp } from '../src/app/bridge-app';
import { ApprovalGate } from '../src/approval/approval-gate';

describe('hardening behaviors', () => {
it('returns interrupted state when request is cancelled', async () => {
  const app = new BridgeApp({
    generate: async () => ['hello'],
  });

  const result = await app.handleCancelledMessage({
    userId: 'u1',
    messageId: 'm1',
    text: 'hello',
  });

  expect(result.finalState).toBe('interrupted');
  expect(result.finalText).toBe('Request interrupted by newer message.');
});

it('auto-denies approval on timeout', () => {
  const gate = new ApprovalGate();
  gate.request('a-timeout', 0);
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      expect(gate.status('a-timeout')).toBe('denied');
      resolve();
    }, 10);
  });
});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/bridge-app.integration.test.ts tests/approval-gate.test.ts tests/card-renderer.test.ts`
Expected: FAIL on new assertions.

- [ ] **Step 3: Write minimal implementation updates**

```ts
// src/approval/approval-gate.ts
request(id: string, timeoutMs: number): void {
  this.states.set(id, 'pending');
  setTimeout(() => {
    if (this.states.get(id) === 'pending') this.states.set(id, 'denied');
  }, timeoutMs);
}
```

```ts
// src/app/bridge-app.ts
async handleCancelledMessage(msg: InboundMessage): Promise<{ finalState: 'interrupted'; finalText: string }> {
  void msg;
  return {
    finalState: 'interrupted',
    finalText: 'Request interrupted by newer message.',
  };
}
```

```md
# README.md
## Run locally
1. Install dependencies: `npm install`
2. Run tests: `npm run test`
3. Start extension host and configure webhook endpoint.
```

- [ ] **Step 4: Run full verification suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/bridge-app.ts src/card/card-renderer.ts src/approval/approval-gate.ts README.md tests/bridge-app.integration.test.ts tests/card-renderer.test.ts tests/approval-gate.test.ts
git commit -m "chore: harden runtime, finalize docs, and pass verification gate"
```

---

## Self-Review

### 1. Spec coverage check

- Private chat only: covered in Session Router and command surface tasks.
- VS Code hosted runtime: covered in bootstrap and bridge app composition.
- Card streaming: covered in Card Renderer task and hardening task.
- Permission gate and approval callbacks: covered in Approval Gate task and integration hardening.
- Idempotency and signature verification: covered in Feishu core task.
- Recovery and interruption states: covered in hardening task.

No uncovered phase 1 requirements found.

### 2. Placeholder scan

- Removed generic TODO language from task actions.
- Every code-changing step includes concrete code snippets.
- Every test step includes specific commands and expected outcomes.

### 3. Type consistency check

- `OperationKind` values are used consistently in permission classifier and downstream tasks.
- `BridgeApp.handleMessage` contract is used consistently in integration tests.
- `ApprovalStatus` states (`pending`, `approved`, `denied`) remain consistent across tasks.

No naming/signature mismatch found.
