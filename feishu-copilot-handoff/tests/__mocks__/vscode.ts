// Minimal vscode mock for Vitest — covers surface used by extension.ts
import { vi } from 'vitest';

const commands = {
  registerCommand: (_id: string, _handler: () => void) => ({ dispose: () => {} }),
  executeCommand: vi.fn(async () => undefined),
};

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

const configStore: Record<string, unknown> = {};
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

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

class ThemeColor {
  constructor(public id: string) {}
}

class Uri {
  constructor(public scheme: string, public path: string) {}
  static from(c: { scheme: string; path: string }) { return new Uri(c.scheme, c.path); }
  get fsPath() { return this.path; }
}

export { commands, window, workspace, Uri, StatusBarAlignment, ThemeColor };
export default { commands, window, workspace, Uri, StatusBarAlignment, ThemeColor };
