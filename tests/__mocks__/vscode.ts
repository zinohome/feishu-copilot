// Minimal vscode mock for Vitest
// Only covers surface area used by extension.ts

import { vi } from 'vitest';

const commands = {
  registerCommand: (_id: string, _handler: () => void) => ({ dispose: () => {} }),
};

const window = {
  showInformationMessage: (_msg: string) => Promise.resolve(undefined),
  showErrorMessage: (_msg: string) => Promise.resolve(undefined),
  showWarningMessage: (_msg: string) => Promise.resolve(undefined),
};

const workspace = {
  workspaceFolders: [] as { uri: { fsPath: string } }[],
  getConfiguration: (_section?: string) => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
  }),
};

class LanguageModelTextPart {
  constructor(public value: string) {}
}

const LanguageModelChatMessage = {
  User: (text: string) => ({ role: 'user' as const, content: text }),
};

class CancellationTokenSource {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
  };
  cancel() {
    this.token.isCancellationRequested = true;
  }
  dispose() {}
}

const lm = {
  selectChatModels: vi.fn(async (_selector?: unknown) => [
    {
      sendRequest: vi.fn(async (_messages: unknown, _options: unknown, _token: unknown) => ({
        stream: (async function* () {
          yield new LanguageModelTextPart('Hello');
          yield new LanguageModelTextPart(' World');
        })(),
      })),
    },
  ]),
};

export { commands, window, workspace, lm, LanguageModelTextPart, LanguageModelChatMessage, CancellationTokenSource };
export default { commands, window, workspace, lm, LanguageModelTextPart, LanguageModelChatMessage, CancellationTokenSource };
