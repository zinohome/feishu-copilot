// Minimal vscode mock for Vitest — covers surface used by extension.ts
import { vi } from 'vitest';

const commands = {
  registerCommand: (_id: string, _handler: () => void) => ({ dispose: () => {} }),
  executeCommand: vi.fn(async () => undefined),
};

const window = {
  showInformationMessage: vi.fn(async (_msg: string) => undefined),
  showErrorMessage: vi.fn(async (_msg: string) => undefined),
};

const configStore: Record<string, unknown> = {};

const workspace = {
  workspaceFolders: [] as { uri: { fsPath: string } }[],
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: unknown) => {
      const fullKey = section ? `${section}.${key}` : key;
      return fullKey in configStore ? configStore[fullKey] : defaultValue;
    },
  }),
};

class Uri {
  constructor(public scheme: string, public path: string) {}
  static from(c: { scheme: string; path: string }) { return new Uri(c.scheme, c.path); }
  get fsPath() { return this.path; }
}

export { commands, window, workspace, Uri };
export default { commands, window, workspace, Uri };
