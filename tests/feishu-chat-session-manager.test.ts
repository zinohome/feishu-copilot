import { describe, expect, it, vi } from 'vitest';
import { FeishuChatSessionManager } from '../src/session/feishu-chat-session-manager';
import type { InboundChatMessage } from '../src/domain/message-types';

describe('FeishuChatSessionManager', () => {
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
    const session = {
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

  it('does not emit error markdown for cancelled inline vscode request', async () => {
    const manager = new FeishuChatSessionManager(
      {} as any,
      {
        generate: vi.fn(async function* (_message: InboundChatMessage, _signal?: AbortSignal) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }),
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
        isCancellationRequested: true,
        onCancellationRequested: vi.fn((handler: () => void) => {
          handler();
          return { dispose: () => {} };
        }),
      },
    );

    expect(stream.markdown).not.toHaveBeenCalledWith(expect.stringContaining('⚠️ Error:'));
  });
});