# Feishu Copilot Handoff Status Bar & Config UX Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready VS Code status bar experience and config UX parity for `feishu-copilot-handoff`, including action menu commands and config-driven runtime behavior.

**Architecture:** Keep transport/session/handoff logic unchanged and layer UX orchestration in `src/extension.ts`. Introduce a small state machine for status bar rendering (`running` / `stopped` / `not configured`), route status command to a quick-pick action menu, and restart runtime on relevant config changes. Update extension manifest command/config metadata and keep test coverage in unit tests with mocked VS Code APIs.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest

---

## Scope Check

This plan covers one subsystem only: extension shell UX (status bar, command menu, configuration ergonomics). It does not change Feishu protocol, session parsing semantics, or command routing logic in the handoff core.

## Planned File Structure

### Modify

- `feishu-copilot-handoff/package.json`
  - Add command contributions for restart/settings actions.
  - Expand configuration descriptions and numeric bounds.
  - Ensure activation events cover added commands.
- `feishu-copilot-handoff/src/extension.ts`
  - Add status bar item lifecycle and state rendering.
  - Add start/stop/restart/openSettings/status command orchestration.
  - Add runtime restart on config changes.
- `feishu-copilot-handoff/tests/__mocks__/vscode.ts`
  - Extend VS Code mock surface (`createStatusBarItem`, `showQuickPick`, `ThemeColor`, `StatusBarAlignment`, config change event).
- `feishu-copilot-handoff/tests/extension.test.ts`
  - Validate command registration for new commands and status bar creation.

### Test

- `feishu-copilot-handoff/tests/extension.test.ts`
  - Unit tests for status bar and command registration behavior.
- Full regression run:
  - `feishu-copilot-handoff/tests/*.test.ts`

---

### Task 1: Expand Manifest Commands And Configuration Metadata

**Files:**
- Modify: `feishu-copilot-handoff/package.json`
- Test: `feishu-copilot-handoff/tests/extension.test.ts`

- [ ] **Step 1: Write failing assertion for new command registration**

```ts
expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.restart', expect.any(Function));
expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.openSettings', expect.any(Function));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd feishu-copilot-handoff && npm test -- tests/extension.test.ts`
Expected: FAIL with missing command registrations.

- [ ] **Step 3: Update extension manifest command and config schema**

```json
{
  "activationEvents": [
    "onStartupFinished",
    "onCommand:feishuCopilotHandoff.start",
    "onCommand:feishuCopilotHandoff.stop",
    "onCommand:feishuCopilotHandoff.restart",
    "onCommand:feishuCopilotHandoff.openSettings",
    "onCommand:feishuCopilotHandoff.status"
  ],
  "contributes": {
    "commands": [
      { "command": "feishuCopilotHandoff.start", "title": "Feishu Copilot Handoff: Start" },
      { "command": "feishuCopilotHandoff.stop", "title": "Feishu Copilot Handoff: Stop" },
      { "command": "feishuCopilotHandoff.restart", "title": "Feishu Copilot Handoff: Restart" },
      { "command": "feishuCopilotHandoff.openSettings", "title": "Feishu Copilot Handoff: Open Settings" },
      { "command": "feishuCopilotHandoff.status", "title": "Feishu Copilot Handoff: Status" }
    ],
    "configuration": {
      "title": "Feishu Copilot Handoff",
      "properties": {
        "feishuCopilotHandoff.feishuAppId": {
          "type": "string",
          "default": "",
          "description": "Feishu application app_id (required)."
        },
        "feishuCopilotHandoff.feishuAppSecret": {
          "type": "string",
          "default": "",
          "description": "Feishu application app_secret (required)."
        },
        "feishuCopilotHandoff.ownerOpenId": {
          "type": "string",
          "default": "",
          "description": "Allowed Feishu sender open_id. Messages from other senders are ignored."
        },
        "feishuCopilotHandoff.targetChatId": {
          "type": "string",
          "default": "",
          "description": "Target Feishu chat_id where mirrored turns and command replies are sent."
        },
        "feishuCopilotHandoff.statusCardEnabled": {
          "type": "boolean",
          "default": true,
          "description": "Reserved for future status card rendering support."
        },
        "feishuCopilotHandoff.maxMirroredSessions": {
          "type": "number",
          "default": 8,
          "minimum": 1,
          "maximum": 50,
          "description": "Maximum number of recent sessions shown in /sessions and status views."
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd feishu-copilot-handoff && npm test -- tests/extension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feishu-copilot-handoff/package.json feishu-copilot-handoff/tests/extension.test.ts
git commit -m "feat: extend handoff command and config contributions"
```

### Task 2: Add VS Code Mock Surface For Status Bar And Action Menu

**Files:**
- Modify: `feishu-copilot-handoff/tests/__mocks__/vscode.ts`
- Test: `feishu-copilot-handoff/tests/extension.test.ts`

- [ ] **Step 1: Add failing status bar creation assertion**

```ts
import * as vscode from 'vscode';
expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd feishu-copilot-handoff && npm test -- tests/extension.test.ts`
Expected: FAIL with `createStatusBarItem is not a function` (or equivalent).

- [ ] **Step 3: Expand mock with required APIs**

```ts
const window = {
  showInformationMessage: vi.fn(async (_msg: string) => undefined),
  showErrorMessage: vi.fn(async (_msg: string) => undefined),
  showQuickPick: vi.fn(async () => undefined),
  createStatusBarItem: vi.fn(() => ({
    text: '',
    tooltip: '',
    command: '',
    backgroundColor: undefined,
    show: vi.fn(),
    dispose: vi.fn(),
  })),
};

const configurationListeners = new Set<(evt: { affectsConfiguration: (section: string) => boolean }) => void>();

const workspace = {
  workspaceFolders: [] as { uri: { fsPath: string } }[],
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: unknown) => {
      const fullKey = section ? `${section}.${key}` : key;
      return fullKey in configStore ? configStore[fullKey] : defaultValue;
    },
  }),
  onDidChangeConfiguration: (listener: (evt: { affectsConfiguration: (section: string) => boolean }) => void) => {
    configurationListeners.add(listener);
    return {
      dispose: () => {
        configurationListeners.delete(listener);
      },
    };
  },
};

const StatusBarAlignment = { Left: 1, Right: 2 };

class ThemeColor {
  constructor(public id: string) {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd feishu-copilot-handoff && npm test -- tests/extension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feishu-copilot-handoff/tests/__mocks__/vscode.ts feishu-copilot-handoff/tests/extension.test.ts
git commit -m "test: extend vscode mocks for status bar and quick actions"
```

### Task 3: Implement Status Bar State Machine And Runtime Action Commands

**Files:**
- Modify: `feishu-copilot-handoff/src/extension.ts`
- Test: `feishu-copilot-handoff/tests/extension.test.ts`

- [ ] **Step 1: Add failing command expectations for restart and openSettings**

```ts
expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.restart', expect.any(Function));
expect(commands.registerCommand).toHaveBeenCalledWith('feishuCopilotHandoff.openSettings', expect.any(Function));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd feishu-copilot-handoff && npm test -- tests/extension.test.ts`
Expected: FAIL with missing command registrations.

- [ ] **Step 3: Implement status bar and action menu orchestration**

```ts
let activeEventSource: { dispose: () => void } | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let activeController: BridgeController | undefined;

function updateStatusBar(): void {
  if (!statusBarItem) return;
  const config = readLiveConfig();
  if (activeEventSource) {
    statusBarItem.text = '$(radio-tower) Feishu Handoff: Running';
    statusBarItem.tooltip = 'Feishu Copilot Handoff is running\nClick for actions';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.command = 'feishuCopilotHandoff.status';
    return;
  }
  if (isConfigured(config)) {
    statusBarItem.text = '$(debug-pause) Feishu Handoff: Stopped';
    statusBarItem.tooltip = 'Feishu Copilot Handoff is stopped\nClick for actions';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.command = 'feishuCopilotHandoff.status';
    return;
  }
  statusBarItem.text = '$(gear) Feishu Handoff: Not Configured';
  statusBarItem.tooltip = 'Feishu Copilot Handoff is not configured\nClick for actions';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarItem.command = 'feishuCopilotHandoff.status';
}

async function openSettings(): Promise<void> {
  await cmds.executeCommand('workbench.action.openSettings', 'feishuCopilotHandoff');
}

async function showStatusActions(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(play) Start Bridge', description: 'Start Feishu handoff connection' },
      { label: '$(stop) Stop Bridge', description: 'Stop Feishu handoff connection' },
      { label: '$(debug-restart) Restart Bridge', description: 'Restart Feishu handoff connection' },
      { label: '$(gear) Open Settings', description: 'Open Feishu Copilot Handoff settings' },
      { label: '$(info) Show Runtime Status', description: 'Show current mode and active target' },
    ],
    { placeHolder: 'Feishu Copilot Handoff actions', ignoreFocusOut: true },
  );
  if (!picked) return;
  if (picked.label.includes('Start Bridge')) return startBridge();
  if (picked.label.includes('Stop Bridge')) return stopBridge();
  if (picked.label.includes('Restart Bridge')) return restartBridge();
  if (picked.label.includes('Open Settings')) return openSettings();
  void vscode.window.showInformationMessage(activeController?.getStatusText() ?? 'mode: follow-latest\nsession: none');
}

context.subscriptions.push(
  cmds.registerCommand('feishuCopilotHandoff.start', () => startBridge()),
  cmds.registerCommand('feishuCopilotHandoff.stop', () => stopBridge()),
  cmds.registerCommand('feishuCopilotHandoff.restart', () => restartBridge()),
  cmds.registerCommand('feishuCopilotHandoff.openSettings', () => openSettings()),
  cmds.registerCommand('feishuCopilotHandoff.status', () => showStatusActions()),
);
```

- [ ] **Step 4: Run extension tests to verify pass**

Run: `cd feishu-copilot-handoff && npm test -- tests/extension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add feishu-copilot-handoff/src/extension.ts feishu-copilot-handoff/tests/extension.test.ts
git commit -m "feat: add status bar runtime actions for handoff extension"
```

### Task 4: Add Config-Change Restart Behavior And Full Regression Verification

**Files:**
- Modify: `feishu-copilot-handoff/src/extension.ts`
- Test: `feishu-copilot-handoff/tests/extension.test.ts`

- [ ] **Step 1: Add a failing test for status bar setup path**

```ts
expect(vscode.window.createStatusBarItem).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run test to verify it fails before wiring listener**

Run: `cd feishu-copilot-handoff && npm test -- tests/extension.test.ts`
Expected: FAIL (if status bar creation/listener wiring absent).

- [ ] **Step 3: Wire status bar creation, config listener, and deactivate cleanup**

```ts
statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
statusBarItem.show();
context.subscriptions.push(statusBarItem);

context.subscriptions.push(
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('feishuCopilotHandoff')) return;
    updateStatusBar();
    if (activeEventSource) {
      void restartBridge(false);
    }
  }),
);

export function deactivate(): void {
  activeEventSource?.dispose();
  activeEventSource = undefined;
  activeController = undefined;
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
```

- [ ] **Step 4: Run full regression and typecheck**

Run: `cd feishu-copilot-handoff && npm test`
Expected: PASS all tests.

Run: `cd feishu-copilot-handoff && npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add feishu-copilot-handoff/src/extension.ts feishu-copilot-handoff/tests/extension.test.ts
git commit -m "feat: refresh status UX on config changes and cleanly dispose resources"
```

## Self-Review

### Spec Coverage

- Status bar icon states (`running`/`stopped`/`not configured`): covered in Task 3 and Task 4.
- Status action menu (`start`/`stop`/`restart`/`settings`/`runtime status`): covered in Task 3.
- Command and activation alignment in manifest: covered in Task 1.
- Configuration UX improvements and bounds: covered in Task 1.
- Mock/test support for VS Code APIs used by status UX: covered in Task 2.

### Placeholder Scan

- No TODO/TBD placeholders.
- Each task includes concrete code snippets, explicit commands, and expected outcomes.

### Type Consistency

- Command IDs are consistently `feishuCopilotHandoff.*` across manifest, runtime registration, and tests.
- Status bar and runtime state variables (`activeEventSource`, `activeController`, `statusBarItem`) are defined once and used consistently.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-feishu-copilot-handoff-statusbar-config-ux.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using the `executing-plans` agent, batch execution with checkpoints

**Which approach?**
