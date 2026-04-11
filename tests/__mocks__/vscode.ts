// Minimal vscode mock for Vitest
// Only covers surface area used by extension.ts

import { vi } from 'vitest';

const commands = {
  registerCommand: (_id: string, _handler: () => void) => ({ dispose: () => {} }),
  executeCommand: vi.fn(async () => undefined),
};

const window = {
  showInformationMessage: vi.fn(async (_msg: string) => undefined),
  showErrorMessage: vi.fn(async (_msg: string) => undefined),
  showWarningMessage: vi.fn(async (_msg: string) => undefined),
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

function __setConfig(values: Record<string, unknown>) {
  Object.assign(configStore, values);
}

function __resetConfig() {
  for (const key of Object.keys(configStore)) {
    delete configStore[key];
  }
}

function __fireDidChangeConfiguration(changedKey: string) {
  const evt = {
    affectsConfiguration: (section: string) =>
      section === changedKey || changedKey.startsWith(`${section}.`),
  };
  for (const listener of configurationListeners) {
    listener(evt);
  }
}

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
  Right: 2,
  Left: 1,
};

class ThemeColor {
  constructor(public id: string) {}
}

class ThemeIcon {
  constructor(public id: string) {}
}

class Uri {
  constructor(public scheme: string, public path: string, public query: string = '') {}

  static from(components: { scheme: string; path: string }) {
    return new Uri(components.scheme, components.path);
  }

  with(changes: { scheme?: string; path?: string; query?: string }) {
    return new Uri(
      changes.scheme ?? this.scheme,
      changes.path ?? this.path,
      changes.query ?? this.query,
    );
  }
}

class MarkdownString {
  constructor(public value: string) {}
}

class ChatResponseMarkdownPart {
  value: MarkdownString;

  constructor(value: string | MarkdownString) {
    this.value = typeof value === 'string' ? new MarkdownString(value) : value;
  }
}

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

class EventEmitter<T = unknown> {
  private listeners = new Set<(event: T) => unknown>();

  event = (listener: (event: T) => unknown) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(data: T) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose() {
    this.listeners.clear();
  }
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

export {
  commands,
  window,
  workspace,
  StatusBarAlignment,
  ThemeColor,
  ThemeIcon,
  Uri,
  lm,
  __setConfig,
  __resetConfig,
  __fireDidChangeConfiguration,
  MarkdownString,
  ChatResponseMarkdownPart,
  LanguageModelTextPart,
  LanguageModelChatMessage,
  CancellationTokenSource,
  EventEmitter,
};
export default {
  commands,
  window,
  workspace,
  StatusBarAlignment,
  ThemeColor,
  ThemeIcon,
  Uri,
  lm,
  __setConfig,
  __resetConfig,
  __fireDidChangeConfiguration,
  MarkdownString,
  ChatResponseMarkdownPart,
  LanguageModelTextPart,
  LanguageModelChatMessage,
  CancellationTokenSource,
  EventEmitter,
};
