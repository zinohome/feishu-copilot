import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { FeishuChatSessionManager } from '../archive/src/session/feishu-chat-session-manager';
import type { InboundChatMessage } from '../archive/src/domain/message-types';

describe('FeishuChatSessionManager', () => {
  it('reopens the currently opened session when feishu appends new messages', async () => {
    const replace = vi.fn();
    const executeCommand = vi.mocked(vscode.commands.executeCommand);
    executeCommand.mockClear();

    const store = {
      list: vi.fn(() => [
        {
          id: 's1',
          feishuKey: 'chat-1',
          label: 'Session 1',
          selectedAgentId: 'superpowers',
          createdAt: 1,
          lastActiveAt: 2,
          messages: [],
          archived: false,
        },
      ]),
    } as any;

    const manager = new FeishuChatSessionManager(store, {} as any, {} as any);
    (manager as any).controller = {
      items: { replace },
      createChatSessionItem: vi.fn((_resource: unknown, label: string) => ({ label })),
    };
    (manager as any).lastOpenedSessionId = 's1';

    await (manager as any).handleStoreChange({
      sessionId: 's1',
      reason: 'append',
      messageSource: 'feishu',
    });

    expect(replace).toHaveBeenCalledOnce();
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ scheme: 'feishu-session', path: '/s1' }),
      expect.objectContaining({ preview: false, preserveFocus: true }),
    );
  });

  it('does not reopen the session for non-feishu updates', async () => {
    const replace = vi.fn();
    const executeCommand = vi.mocked(vscode.commands.executeCommand);
    executeCommand.mockClear();

    const store = {
      list: vi.fn(() => []),
    } as any;

    const manager = new FeishuChatSessionManager(store, {} as any, {} as any);
    (manager as any).controller = {
      items: { replace },
      createChatSessionItem: vi.fn(),
    };
    (manager as any).lastOpenedSessionId = 's1';

    await (manager as any).handleStoreChange({
      sessionId: 's1',
      reason: 'append',
      messageSource: 'vscode',
    });

    expect(replace).toHaveBeenCalledOnce();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('maps session store messages into chat session history in order', () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 3,
      messages: [
        { role: 'user', text: 'from feishu', timestampMs: 1, source: 'feishu' },
        { role: 'assistant', text: 'assistant reply', timestampMs: 2, source: 'vscode' },
      ],
      archived: false,
    };

    const manager = new FeishuChatSessionManager(
      {
        get: vi.fn(() => session),
      } as any,
      {} as any,
      {} as any,
    );

    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    expect(chatSession.history).toHaveLength(2);
    expect(chatSession.history[0]).toMatchObject({
      prompt: 'from feishu',
      participant: 'feishu-copilot.chat',
    });
    expect(chatSession.history[1]).toMatchObject({
      participant: 'feishu-copilot.chat',
    });
    expect((chatSession.history[1] as any).response[0].value.value).toBe('assistant reply');
  });

  it('keeps trailing user message when stored history has odd number of messages', () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 3,
      messages: [
        { role: 'user', text: 'first user', timestampMs: 1, source: 'feishu' },
        { role: 'assistant', text: 'first reply', timestampMs: 2, source: 'vscode' },
        { role: 'user', text: 'second user', timestampMs: 3, source: 'vscode' },
      ],
      archived: false,
    };

    const manager = new FeishuChatSessionManager(
      {
        get: vi.fn(() => session),
      } as any,
      {} as any,
      {} as any,
    );

    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    expect(chatSession.history).toHaveLength(3);
    expect(chatSession.history[2]).toMatchObject({
      prompt: 'second user',
      participant: 'feishu-copilot.chat',
    });
  });

  it('returns empty history when session has no messages', () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const manager = new FeishuChatSessionManager(
      {
        get: vi.fn(() => session),
      } as any,
      {} as any,
      {} as any,
    );

    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    expect(chatSession.title).toBe('Session 1');
    expect(chatSession.history).toEqual([]);
  });

  it('reuses existing shared feishu session when creating a new chat session item', async () => {
    const sharedSession: any = {
      id: 's-shared',
      feishuKey: 'oc_shared',
      label: '飞书 oc_shared',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 2,
      messages: [],
      archived: false,
    };

    const store = {
      list: vi.fn(() => [sharedSession]),
      getOrCreate: vi.fn(),
    } as any;

    const manager = new FeishuChatSessionManager(store, {} as any, {} as any);
    (manager as any).makeItem = vi.fn((session: { label: string }) => ({ label: session.label }));

    const item = await (manager as any).handleNewSession(
      { request: { prompt: 'new chat' } },
      {} as any,
    );

    expect(store.getOrCreate).not.toHaveBeenCalled();
    expect(item.label).toBe('飞书 oc_shared');
  });

  it('returns empty history when legacy session misses messages field', () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      archived: false,
    };

    const manager = new FeishuChatSessionManager(
      {
        get: vi.fn(() => session),
      } as any,
      {} as any,
      {} as any,
    );

    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    expect(chatSession.title).toBe('Session 1');
    expect(chatSession.history).toEqual([]);
  });

  it('returns empty history when legacy session has non-array messages', () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: {},
      archived: false,
    };

    const manager = new FeishuChatSessionManager(
      {
        get: vi.fn(() => session),
      } as any,
      {} as any,
      {} as any,
    );

    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    expect(chatSession.title).toBe('Session 1');
    expect(chatSession.history).toEqual([]);
  });

  it('normalizes stale selected agent in chat session input state', async () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'stale-agent',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn(() => session),
      setSelectedAgent: vi.fn(),
    } as any;

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: (id: string) =>
        id === 'superpowers'
          ? { id: 'superpowers', displayName: 'Superpowers', description: 'default' }
          : id === 'debug'
            ? { id: 'debug', displayName: 'Debug', description: 'debug flow' }
            : undefined,
      listRunnable: () => [
        { id: 'superpowers', displayName: 'Superpowers', description: 'default' },
        { id: 'debug', displayName: 'Debug', description: 'debug flow' },
      ],
    } as any;

    const manager = new FeishuChatSessionManager(store, {} as any, registry);
    (manager as any).controller = {
      createChatSessionInputState: vi.fn((groups: unknown) => ({ groups })),
    };

    const result = await (manager as any).getChatSessionInputState(
      { path: '/s1' },
      { previousInputState: undefined },
      {} as any,
    );

    const agentGroup = result.groups[0];
    expect(agentGroup.id).toBe('agent');
    expect(agentGroup.selected.id).toBe('superpowers');
    expect(agentGroup.items.map((item: { id: string }) => item.id)).toEqual(['superpowers', 'debug']);
    expect(store.setSelectedAgent).toHaveBeenCalledWith('s1', 'superpowers');
  });

  it('creates fallback input option when no runnable agents exist', async () => {
    const session = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn(() => session),
      setSelectedAgent: vi.fn(),
    } as any;

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => undefined,
      listRunnable: () => [],
    } as any;

    const manager = new FeishuChatSessionManager(store, {} as any, registry);
    (manager as any).controller = {
      createChatSessionInputState: vi.fn((groups: unknown) => ({ groups })),
    };

    const result = await (manager as any).getChatSessionInputState(
      { path: '/s1' },
      { previousInputState: undefined },
      {} as any,
    );

    const agentGroup = result.groups[0];
    expect(agentGroup.items).toHaveLength(1);
    expect(agentGroup.selected.id).toBe('__no_runnable_agent__');
    expect(agentGroup.items[0].name).toContain('No runnable agents');
    expect(store.setSelectedAgent).not.toHaveBeenCalled();
  });

  it('syncs selected agent from VS Code input state before generating response', async () => {
    const session = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [
        {
          role: 'user',
          text: 'older context',
          timestampMs: 1,
          source: 'feishu',
        },
      ],
      archived: false,
    };

    const store = {
      get: vi.fn(() => session),
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string }) => {
        session.messages.push({ ...message, timestampMs: 2 });
      }),
      setSelectedAgent: vi.fn((sessionId: string, agentId: string) => {
        session.selectedAgentId = agentId;
      }),
    } as any;

    const generate = vi.fn(async function* (message: InboundChatMessage) {
      yield `handled:${message.text}`;
    });

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: (id: string) =>
        id === 'debug'
          ? {
              id: 'debug',
              displayName: 'Debug',
              description: 'debug flow',
              systemPrompt: 'Debug system prompt',
            }
          : id === 'superpowers'
            ? {
                id: 'superpowers',
                displayName: 'Superpowers',
                description: 'default flow',
                systemPrompt: 'Default system prompt',
              }
            : undefined,
    } as any;

    const manager = new FeishuChatSessionManager(store, { generate } as any, registry);
    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    const stream = {
      markdown: vi.fn(),
    } as any;

    await chatSession.requestHandler(
      { prompt: 'new request' },
      {
        chatSessionContext: {
          inputState: {
            groups: [{ id: 'agent', selected: { id: 'debug' } }],
          },
        },
      },
      stream,
      {
        onCancellationRequested: vi.fn(),
      },
    );

    expect(store.setSelectedAgent).toHaveBeenCalledWith('s1', 'debug');
    expect(generate).toHaveBeenCalledOnce();

    const inbound = generate.mock.calls[0][0] as InboundChatMessage;
    expect(inbound.text).toContain('[Agent: debug]');
    expect(inbound.text).toContain('Debug system prompt');
    expect(inbound.text).toContain('[Feishu user]: older context');
    expect(inbound.text).toContain('[user]: new request');
    expect(stream.markdown).toHaveBeenCalledWith(expect.stringContaining('handled:'));
    expect(store.appendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not persist assistant error message when request is cancelled', async () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn(() => session),
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string }) => {
        session.messages.push({ ...message, timestampMs: 2 });
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const generate = vi.fn(async function* (_message: InboundChatMessage, signal?: AbortSignal) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({
        id: 'superpowers',
        displayName: 'Superpowers',
        description: 'default flow',
        systemPrompt: 'Default system prompt',
      }),
      listRunnable: () => [],
    } as any;

    const manager = new FeishuChatSessionManager(store, { generate } as any, registry);
    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    let cancelHandler: (() => void) | undefined;
    const stream = {
      markdown: vi.fn(),
    } as any;

    await chatSession.requestHandler(
      { prompt: 'cancel me' },
      { chatSessionContext: { inputState: { groups: [] } } },
      stream,
      {
        isCancellationRequested: true,
        onCancellationRequested: vi.fn((handler: () => void) => {
          cancelHandler = handler;
          handler();
          return { dispose: () => {} };
        }),
      },
    );

    expect(cancelHandler).toBeDefined();
    expect(stream.markdown).not.toHaveBeenCalledWith(expect.stringContaining('⚠️ Error:'));
    // only user message should be persisted
    expect(store.appendMessage).toHaveBeenCalledTimes(1);
    expect((session.messages[0] as { role: string }).role).toBe('user');
  });

  it('mirrors vscode turns back to feishu for existing feishu sessions', async () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn(() => session),
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string }) => {
        session.messages.push({ ...message, timestampMs: 2 });
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const generate = vi.fn(async function* () {
      yield 'reply from vscode';
    });

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({
        id: 'superpowers',
        displayName: 'Superpowers',
        description: 'default flow',
        systemPrompt: 'Default system prompt',
      }),
      listRunnable: () => [],
    } as any;

    const mirrorTurn = vi.fn().mockResolvedValue(undefined);
    const manager = new FeishuChatSessionManager(store, { generate } as any, registry);
    manager.setMirror({ mirrorTurn });
    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    await chatSession.requestHandler(
      { prompt: 'sync this turn' },
      { chatSessionContext: { inputState: { groups: [] } } },
      { markdown: vi.fn() } as any,
      { onCancellationRequested: vi.fn() },
    );

    expect(mirrorTurn).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        userText: 'sync this turn',
        assistantText: 'reply from vscode',
      }),
    );
  });

  it('does not mirror vscode turns for local-only sessions', async () => {
    const session: any = {
      id: 's1',
      feishuKey: 'vscode-123',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn(() => session),
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string }) => {
        session.messages.push({ ...message, timestampMs: 2 });
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const generate = vi.fn(async function* () {
      yield 'reply from vscode';
    });

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({
        id: 'superpowers',
        displayName: 'Superpowers',
        description: 'default flow',
        systemPrompt: 'Default system prompt',
      }),
      listRunnable: () => [],
    } as any;

    const mirrorTurn = vi.fn().mockResolvedValue(undefined);
    const manager = new FeishuChatSessionManager(store, { generate } as any, registry);
    manager.setMirror({ mirrorTurn });
    const provider = (manager as any).buildContentProvider();
    const chatSession = provider.provideChatSessionContent({ path: '/s1' }, {} as any);

    await chatSession.requestHandler(
      { prompt: 'local only' },
      { chatSessionContext: { inputState: { groups: [] } } },
      { markdown: vi.fn() } as any,
      { onCancellationRequested: vi.fn() },
    );

    expect(mirrorTurn).not.toHaveBeenCalled();
  });

  it('prompts user when request is not bound to a shared feishu session', async () => {
    const generate = vi.fn(async function* (_message: InboundChatMessage, _signal?: AbortSignal) {
      yield 'should not run';
    });

    const manager = new FeishuChatSessionManager(
      {
        list: vi.fn(() => []),
      } as any,
      {
        generate,
      } as any,
      {} as any,
    );

    const stream = {
      markdown: vi.fn(),
    } as any;

    await (manager as any).handleVsCodeRequest(
      { prompt: 'cancel me' },
      {},
      stream,
      {
        onCancellationRequested: vi.fn((handler: () => void) => {
          return { dispose: () => {} };
        }),
      },
    );

    expect(stream.markdown).toHaveBeenCalledWith(
      expect.stringContaining('not bound to a Feishu shared session'),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('routes participant requests for feishu sessions into the shared session store', async () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn(() => session),
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string }) => {
        session.messages.push({ ...message, timestampMs: Date.now() });
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const generate = vi.fn(async function* () {
      yield 'shared reply';
    });

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({
        id: 'superpowers',
        displayName: 'Superpowers',
        description: 'default flow',
        systemPrompt: 'Default system prompt',
      }),
      listRunnable: () => [],
    } as any;

    const manager = new FeishuChatSessionManager(store, { generate } as any, registry);

    await (manager as any).handleVsCodeRequest(
      { prompt: 'persist this turn' },
      {
        chatSessionContext: {
          chatSessionItem: {
            resource: { scheme: 'feishu-session', path: '/s1' },
          },
          inputState: { groups: [] },
        },
      },
      { markdown: vi.fn() } as any,
      { onCancellationRequested: vi.fn() },
    );

    expect(store.get).toHaveBeenCalledWith('s1');
    expect(store.appendMessage).toHaveBeenCalledTimes(2);
    expect(session.messages[0]).toMatchObject({ role: 'user', source: 'vscode', text: 'persist this turn' });
    expect(session.messages[1]).toMatchObject({ role: 'assistant', source: 'vscode', text: 'shared reply' });
  });

  it('does not fall back to latest shared session when chat editor resource is not feishu-session', async () => {
    const session: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn((id: string) => (id === 's1' ? session : undefined)),
      list: vi.fn(() => [session]),
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string }) => {
        session.messages.push({ ...message, timestampMs: Date.now() });
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const generate = vi.fn(async function* () {
      yield 'shared reply';
    });

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({
        id: 'superpowers',
        displayName: 'Superpowers',
        description: 'default flow',
        systemPrompt: 'Default system prompt',
      }),
      listRunnable: () => [],
    } as any;

    const manager = new FeishuChatSessionManager(store, { generate } as any, registry);
    (manager as any).lastOpenedSessionId = 's1';

    const stream = { markdown: vi.fn() } as any;

    await (manager as any).handleVsCodeRequest(
      { prompt: 'persist via fallback' },
      {
        chatSessionContext: {
          chatSessionItem: {
            resource: { scheme: 'vscode-chat', path: '/editor-session' },
          },
          inputState: { groups: [{ id: 'agent', items: [], selected: undefined }] },
        },
      },
      stream,
      { onCancellationRequested: vi.fn() },
    );

    expect(store.appendMessage).not.toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenCalledWith(
      expect.stringContaining('not bound to a Feishu shared session'),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not fall back to latest shared session when context cannot resolve resource', async () => {
    const session: any = {
      id: 's1',
      feishuKey: 'oc_abc',
      label: '飞书 oc_abc',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const olderSession: any = {
      id: 's0',
      feishuKey: 'oc_old',
      label: '飞书 oc_old',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const store = {
      get: vi.fn(() => undefined),
      list: vi.fn(() => [session, olderSession]),
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string }) => {
        const target = sessionId === 's1' ? session : olderSession;
        target.messages.push({ ...message, timestampMs: Date.now() });
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const generate = vi.fn(async function* () {
      yield 'shared reply';
    });

    const registry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({
        id: 'superpowers',
        displayName: 'Superpowers',
        description: 'default flow',
        systemPrompt: 'Default system prompt',
      }),
      listRunnable: () => [],
    } as any;

    const manager = new FeishuChatSessionManager(store, { generate } as any, registry);

    const stream = { markdown: vi.fn() } as any;

    await (manager as any).handleVsCodeRequest(
      { prompt: 'persist via single-session fallback' },
      {
        chatSessionContext: {
          chatSessionItem: {
            resource: { scheme: 'vscode-chat', path: '/editor-session' },
            label: 'unrelated-editor-session',
          },
          inputState: { groups: [] },
        },
      },
      stream,
      { onCancellationRequested: vi.fn() },
    );

    expect(store.list).not.toHaveBeenCalled();
    expect(store.appendMessage).not.toHaveBeenCalled();
    expect(session.messages).toHaveLength(0);
    expect(olderSession.messages).toHaveLength(0);
    expect(stream.markdown).toHaveBeenCalledWith(
      expect.stringContaining('not bound to a Feishu shared session'),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('opens the latest shared session explicitly', async () => {
    const executeCommand = vi.mocked(vscode.commands.executeCommand);
    executeCommand.mockClear();

    const store = {
      list: vi.fn(() => [
        {
          id: 's1',
          feishuKey: 'chat-1',
          label: 'Session 1',
          selectedAgentId: 'superpowers',
          createdAt: 1,
          lastActiveAt: 2,
          messages: [],
          archived: false,
        },
      ]),
    } as any;

    const manager = new FeishuChatSessionManager(store, {} as any, {} as any);
    const opened = await manager.openLatestSharedSession();

    expect(opened).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ scheme: 'feishu-session', path: '/s1' }),
      expect.objectContaining({ preview: false }),
    );
  });
});