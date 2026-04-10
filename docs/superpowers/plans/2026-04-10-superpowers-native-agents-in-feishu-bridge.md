# Superpowers Native Agents In Feishu Bridge Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Feishu sessions use real Superpowers agent definitions (not style approximations), with session-level agent switching that stays synced between Feishu and VS Code Chat.

**Architecture:** Build a bridge-owned Agent Registry that loads canonical Superpowers skill content and exposes runnable agents. Keep session state (`selectedAgentId`) in one shared store and route both Feishu requests and VS Code session requests through the same resolver. Remove non-runnable external-participant entries from user-facing Feishu commands to avoid misleading choices.

**Tech Stack:** TypeScript, VS Code extension API (chat + proposed chat sessions provider), existing Feishu webhook/ws pipeline, JSON file persistence.

---

## Scope Summary

This plan implements one cohesive subsystem: “real Superpowers agent runtime inside the bridge.”

Out of scope for this plan:
- Calling third-party chat participants by ID through undocumented APIs.
- UI automation that writes text into Copilot Chat input boxes.

## Current vs Required

Required behavior:
1. Feishu can list and switch only runnable agents.
2. Runnable agents are native Superpowers agents (brainstorming, tdd, debug, plan, execute, subagent, parallel, review, receive-review, verify, worktree, finish, write-skill, superpowers).
3. VS Code session dropdown and Feishu `/agent use` always point to the same `selectedAgentId`.
4. Message routing uses selected Superpowers agent prompt/instructions.
5. No “visible-only” dead-end entries in Feishu command output.

Current implementation gaps:
1. `src/agent/agent-registry.ts` defines generic builtin agents (`default`, `code-review`, `debugger`) that are not canonical Superpowers definitions.
2. `/agent list` in `src/app/pipeline.ts` shows non-runnable discovered participants.
3. Registry does not load Superpowers SKILL content from source-of-truth files.
4. Session dropdown currently mirrors runtime agents but not canonical Superpowers set.

## File Structure Plan

Files to modify:
1. `src/agent/agent-registry.ts`
   Responsibility: canonical runnable agent catalog, prompt loading, Feishu display formatting.
2. `src/app/pipeline.ts`
   Responsibility: Feishu command parsing + execution route using selected canonical agent.
3. `src/session/feishu-chat-session-manager.ts`
   Responsibility: VS Code session input state options based on runnable canonical agents.
4. `package.json`
   Responsibility: optional config for Superpowers source path and toggle for strict runnable-only list.

Files to create:
1. `src/agent/superpowers-agent-presets.ts`
   Responsibility: mapping between agent IDs and loaded SKILL content metadata.
2. `src/agent/superpowers-loader.ts`
   Responsibility: deterministic loading of SKILL.md text from configured source path.
3. `tests/agent-registry.test.ts`
   Responsibility: registry loading + runnable list + fallback behavior tests.
4. `tests/agent-routing.test.ts`
   Responsibility: `/agent` command and selected-agent route assertions.

---

### Task 1: Define Canonical Superpowers Agent Catalog

**Files:**
- Create: `src/agent/superpowers-agent-presets.ts`
- Modify: `src/agent/agent-registry.ts`
- Test: `tests/agent-registry.test.ts`

- [ ] **Step 1: Write the failing tests for canonical IDs and runnable-only list**

```ts
import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../src/agent/agent-registry';

describe('AgentRegistry canonical Superpowers', () => {
  it('exposes canonical runnable agent ids', () => {
    const registry = new AgentRegistry({
      superpowersSourcePath: '/tmp/not-used-in-this-test',
      loader: { loadSkillPrompt: (id: string) => `prompt:${id}` },
    });

    const ids = registry.listRunnable().map(a => a.id);
    expect(ids).toEqual([
      'brainstorming',
      'tdd',
      'debug',
      'plan',
      'execute',
      'subagent',
      'parallel',
      'review',
      'receive-review',
      'verify',
      'worktree',
      'finish',
      'write-skill',
      'superpowers',
    ]);
  });

  it('formats feishu list without visible-only participants', () => {
    const registry = new AgentRegistry({
      superpowersSourcePath: '/tmp/not-used-in-this-test',
      loader: { loadSkillPrompt: (id: string) => `prompt:${id}` },
    });

    const text = registry.formatForFeishu('debug');
    expect(text).toContain('debug');
    expect(text).not.toContain('visible-only');
    expect(text).not.toContain('participant:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/agent-registry.test.ts -t "canonical runnable agent ids"`
Expected: FAIL with missing canonical IDs / old builtin IDs.

- [ ] **Step 3: Create canonical preset mapping file**

```ts
// src/agent/superpowers-agent-presets.ts
export interface SuperpowersAgentPreset {
  id: string;
  displayName: string;
  description: string;
  skillFolder: string;
}

export const SUPERPOWERS_AGENT_PRESETS: SuperpowersAgentPreset[] = [
  { id: 'brainstorming', displayName: 'Brainstorming', description: 'Spec feature before coding.', skillFolder: 'brainstorming' },
  { id: 'tdd', displayName: 'Test-Driven Development', description: 'Implement via TDD loop.', skillFolder: 'test-driven-development' },
  { id: 'debug', displayName: 'Systematic Debugging', description: 'Root-cause driven debugging.', skillFolder: 'systematic-debugging' },
  { id: 'plan', displayName: 'Writing Plans', description: 'Create implementation plans.', skillFolder: 'writing-plans' },
  { id: 'execute', displayName: 'Executing Plans', description: 'Execute written plans.', skillFolder: 'executing-plans' },
  { id: 'subagent', displayName: 'Subagent Development', description: 'Dispatch subagents by task.', skillFolder: 'subagent-driven-development' },
  { id: 'parallel', displayName: 'Parallel Dispatch', description: 'Run independent work in parallel.', skillFolder: 'dispatching-parallel-agents' },
  { id: 'review', displayName: 'Requesting Code Review', description: 'Pre-merge review workflow.', skillFolder: 'requesting-code-review' },
  { id: 'receive-review', displayName: 'Receiving Code Review', description: 'Process review feedback rigorously.', skillFolder: 'receiving-code-review' },
  { id: 'verify', displayName: 'Verification Before Completion', description: 'Validate completion with evidence.', skillFolder: 'verification-before-completion' },
  { id: 'worktree', displayName: 'Using Git Worktrees', description: 'Isolated worktree workflow.', skillFolder: 'using-git-worktrees' },
  { id: 'finish', displayName: 'Finish Development Branch', description: 'Wrap up branch/PR flow.', skillFolder: 'finishing-a-development-branch' },
  { id: 'write-skill', displayName: 'Writing Skills', description: 'Author new skill modules.', skillFolder: 'writing-skills' },
  { id: 'superpowers', displayName: 'Using Superpowers', description: 'Discover and use Superpowers.', skillFolder: 'using-superpowers' },
];
```

- [ ] **Step 4: Update registry to use presets and remove visible-only from Feishu output**

```ts
// src/agent/agent-registry.ts (key shape)
listRunnable(): AgentDefinition[] {
  return this.runnableAgents.slice();
}

formatForFeishu(currentId?: string): string {
  const agents = this.listRunnable();
  const lines = ['Available agents:'];
  for (const agent of agents) {
    const mark = currentId === agent.id ? ' *current*' : '';
    lines.push(`- ${agent.id}${mark}: ${agent.displayName} - ${agent.description}`);
  }
  lines.push('');
  lines.push('Use: /agent use <agentId>');
  return lines.join('\n');
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- tests/agent-registry.test.ts -t "canonical"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/superpowers-agent-presets.ts src/agent/agent-registry.ts tests/agent-registry.test.ts
git commit -m "feat: replace generic agents with canonical superpowers catalog"
```

---

### Task 2: Load Real Superpowers SKILL Content as Prompt Source

**Files:**
- Create: `src/agent/superpowers-loader.ts`
- Modify: `src/agent/agent-registry.ts`
- Test: `tests/agent-registry.test.ts`

- [ ] **Step 1: Write failing tests for loader path behavior and fallback**

```ts
it('loads skill prompt from configured source path', () => {
  const loader = new SuperpowersLoader('/tmp/sp');
  // mocked fs: /tmp/sp/skills/brainstorming/SKILL.md exists
  expect(loader.loadSkillPrompt('brainstorming')).toContain('#');
});

it('falls back to safe default prompt when skill file missing', () => {
  const loader = new SuperpowersLoader('/tmp/empty');
  expect(loader.loadSkillPrompt('brainstorming')).toContain('Act as');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/agent-registry.test.ts -t "loads skill prompt"`
Expected: FAIL with missing loader class.

- [ ] **Step 3: Implement deterministic loader**

```ts
// src/agent/superpowers-loader.ts
import * as fs from 'fs';
import * as path from 'path';

export class SuperpowersLoader {
  constructor(private readonly rootPath: string) {}

  loadSkillPrompt(skillFolder: string): string {
    const filePath = path.join(this.rootPath, 'skills', skillFolder, 'SKILL.md');
    if (!fs.existsSync(filePath)) {
      return 'Act as a focused software engineering assistant and follow best practices for this mode.';
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}
```

- [ ] **Step 4: Wire loader into registry construction**

```ts
// src/agent/agent-registry.ts (constructor shape)
constructor(options?: { superpowersSourcePath?: string; loader?: SkillLoader }) {
  const sourcePath = options?.superpowersSourcePath || process.env.SUPERPOWERS_SOURCE_PATH || '';
  const loader = options?.loader || new SuperpowersLoader(sourcePath);
  this.runnableAgents = SUPERPOWERS_AGENT_PRESETS.map(preset => ({
    id: preset.id,
    displayName: preset.displayName,
    description: preset.description,
    source: 'builtin',
    runnable: true,
    systemPrompt: loader.loadSkillPrompt(preset.skillFolder),
  }));
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test -- tests/agent-registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/superpowers-loader.ts src/agent/agent-registry.ts tests/agent-registry.test.ts
git commit -m "feat: load canonical superpowers skill prompts into runtime registry"
```

---

### Task 3: Align Feishu Agent Commands with Runnable-Only Contract

**Files:**
- Modify: `src/app/pipeline.ts`
- Test: `tests/agent-routing.test.ts`

- [ ] **Step 1: Write failing tests for /agent command behavior**

```ts
it('returns runnable-only list for /agent list', async () => {
  const result = await handleText('/agent list');
  expect(result).toContain('brainstorming');
  expect(result).not.toContain('visible-only');
  expect(result).not.toContain('participant:');
});

it('switches selectedAgentId on /agent use plan', async () => {
  await handleText('/agent use plan');
  expect(sessionStore.get(sessionId)?.selectedAgentId).toBe('plan');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/agent-routing.test.ts -t "agent"`
Expected: FAIL where output still includes visible-only tag.

- [ ] **Step 3: Implement command output and validation updates**

```ts
// src/app/pipeline.ts (command branch)
if (cmd === '/agent list') {
  await sendText(feishuToken, event.message.chat_id, agentRegistry.formatForFeishu(selectedAgentId));
  return;
}

if (cmd.startsWith('/agent use ')) {
  const target = cmd.slice('/agent use '.length).trim();
  const agent = agentRegistry.getRunnableById(target);
  if (!agent) {
    await sendText(feishuToken, event.message.chat_id, `Unknown runnable agent: ${target}\n\n${agentRegistry.formatForFeishu(selectedAgentId)}`);
    return;
  }
  sessionStore.setSelectedAgent(session.id, target);
  await sendText(feishuToken, event.message.chat_id, `Switched agent to ${target}.`);
  return;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- tests/agent-routing.test.ts -t "agent"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/pipeline.ts tests/agent-routing.test.ts
git commit -m "feat: enforce runnable-only agent commands in feishu"
```

---

### Task 4: Ensure VS Code Session Dropdown Uses Canonical Superpowers Agents

**Files:**
- Modify: `src/session/feishu-chat-session-manager.ts`
- Test: `tests/agent-routing.test.ts`

- [ ] **Step 1: Write failing tests for dropdown options and sync**

```ts
it('builds chat input state with canonical superpowers options', async () => {
  const input = await manager['getChatSessionInputState'](resource, { previousInputState: undefined }, token);
  const group = input.groups.find(g => g.id === 'agent');
  expect(group?.items.map(i => i.id)).toContain('brainstorming');
  expect(group?.items.map(i => i.id)).toContain('plan');
});

it('syncs selected dropdown option back to session selectedAgentId', async () => {
  // simulate inputState selected=debug
  await sendVscodeRequestWithInputSelection('debug');
  expect(sessionStore.get(sessionId)?.selectedAgentId).toBe('debug');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/agent-routing.test.ts -t "dropdown"`
Expected: FAIL if options still generic or unsynced.

- [ ] **Step 3: Make session manager consume registry runnable list as single source**

```ts
const items: vscode.ChatSessionProviderOptionItem[] = this.agentRegistry
  .listRunnable()
  .map(agent => ({
    id: agent.id,
    name: agent.displayName,
    description: agent.description,
    default: agent.id === selectedAgentId,
  }));
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- tests/agent-routing.test.ts -t "dropdown"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/feishu-chat-session-manager.ts tests/agent-routing.test.ts
git commit -m "feat: sync vscode session dropdown with canonical superpowers agents"
```

---

### Task 5: Configuration, Compatibility, and Verification

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Test: `tests/agent-registry.test.ts`

- [ ] **Step 1: Write failing tests for configurable superpowers source path**

```ts
it('uses configured superpowers source path from vscode settings', () => {
  const path = '/custom/superpowers';
  const registry = createRegistryWithConfig(path);
  expect(registry.listRunnable()[0].systemPrompt).toContain('SKILL');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/agent-registry.test.ts -t "source path"`
Expected: FAIL without config wiring.

- [ ] **Step 3: Add config entry and wire into extension activation**

```json
// package.json contributes.configuration.properties
"feishuCopilot.superpowersSourcePath": {
  "type": "string",
  "default": "",
  "description": "Absolute path of a Superpowers extension root used to load skills/*/SKILL.md as runtime agent prompts."
}
```

```ts
// src/extension.ts
const cfg = vscode.workspace.getConfiguration('feishuCopilot');
const superpowersSourcePath = cfg.get<string>('superpowersSourcePath', '').trim();
agentRegistry = new AgentRegistry({ superpowersSourcePath });
```

- [ ] **Step 4: Run full verification suite**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json src/extension.ts tests/agent-registry.test.ts
git commit -m "feat: configurable superpowers source path and final verification"
```

---

## Self-Review Checklist Results

1. Spec coverage:
- Real Superpowers agents loaded from canonical SKILL files: covered by Task 2.
- Feishu list/use/current flow: covered by Task 3.
- VS Code dropdown sync with same session state: covered by Task 4.
- Remove confusing non-runnable entries from Feishu flow: covered by Task 1 + Task 3.

2. Placeholder scan:
- No TODO/TBD placeholders remain.
- Every code-change step includes concrete snippet and command.

3. Type consistency:
- `selectedAgentId` is consistent across `SessionStore`, `Pipeline`, and `FeishuChatSessionManager`.
- Runnable agent lookups consistently use `getRunnableById`.

