import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Pipeline } from '../archive/src/app/pipeline';
import type { FeishuWebhookEvent } from '../archive/src/app/pipeline';
import type { BridgeConfig } from '../archive/src/config/types';
import type { CopilotAdapter } from '../archive/src/copilot/copilot-adapter';

vi.mock('../src/feishu/feishu-client', () => ({
  sendCard: vi.fn().mockResolvedValue('card-msg-id-1'),
  updateCard: vi.fn().mockResolvedValue(undefined),
  sendText: vi.fn().mockResolvedValue('text-msg-id-1'),
}));

import * as feishuClient from '../archive/src/feishu/feishu-client';

const config: BridgeConfig = {
  ownerOpenId: 'ou_owner123',
  workspaceAllowlist: [],
  approvalTimeoutMs: 5000,
  cardPatchIntervalMs: 0,
  sharedStorePath: '',
  allowGlobalStorageFallback: true,
};

function makeEvent(openId: string, text = 'hello', chatId = 'chat-1', messageId = 'msg-1'): FeishuWebhookEvent {
  return {
    sender: { open_id: openId },
    message: {
      message_id: messageId,
      content: JSON.stringify({ text }),
      chat_id: chatId,
      create_time: '1712726400000',
    },
  };
}

describe('Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores message from unauthorized sender', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (_message, _signal) {
        yield 'chunk';
      }),
    };
    const pipeline = new Pipeline({ config, copilot, feishuToken: 'token-x' });

    await pipeline.handleInbound(makeEvent('ou_stranger'));

    expect(copilot.generate).not.toHaveBeenCalled();
    expect(feishuClient.sendCard).not.toHaveBeenCalled();
  });

  it('fails closed when ownerOpenId is empty', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (_message, _signal) {
        yield 'chunk';
      }),
    };
    const pipeline = new Pipeline({
      config: { ...config, ownerOpenId: '' },
      copilot,
      feishuToken: 'token-x',
    });

    await pipeline.handleInbound(makeEvent('ou_owner123'));

    expect(copilot.generate).not.toHaveBeenCalled();
    expect(feishuClient.sendCard).not.toHaveBeenCalled();
  });

  it('streams chunks and updates final card', async () => {
    const copilot: CopilotAdapter = {
      async *generate(_message, _signal) {
        yield 'Hello';
        yield ' World';
      },
    };
    const pipeline = new Pipeline({ config, copilot, feishuToken: 'token-x' });

    await pipeline.handleInbound(makeEvent('ou_owner123', 'hi'));

    expect(feishuClient.sendCard).toHaveBeenCalledOnce();
    expect(feishuClient.updateCard).toHaveBeenCalled();

    // Final updateCard call should contain the full accumulated text
    const calls = vi.mocked(feishuClient.updateCard).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe('token-x');
    expect(lastCall[1]).toBe('card-msg-id-1');
    expect(lastCall[2]).toContain('Hello World');
  });

  it('does not treat /agentic as /agent command', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (_message, _signal) {
        yield 'ok';
      }),
    };

    const fakeSessionStore = {
      getOrCreate: () => ({ id: 's1', selectedAgentId: 'superpowers' }),
      appendMessage: vi.fn(),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({ id: 'superpowers', systemPrompt: 'prompt' }),
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'agents',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agentic continue this work'));

    expect(copilot.generate).toHaveBeenCalledOnce();
    expect(feishuClient.sendText).not.toHaveBeenCalled();
  });

  it('supports /agent list command', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* () {
        yield 'ok';
      }),
    };

    const fakeSessionStore = {
      getOrCreate: () => ({ id: 's1', selectedAgentId: 'superpowers' }),
      appendMessage: vi.fn(),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({ id: 'superpowers', systemPrompt: 'prompt' }),
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agent list'));

    expect(feishuClient.sendText).toHaveBeenCalledOnce();
    expect(fakeSessionStore.appendMessage).not.toHaveBeenCalled();
    expect(copilot.generate).not.toHaveBeenCalled();
  });

  it('supports /agent list command without session store', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* () {
        yield 'ok';
      }),
    };

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({ id: 'superpowers', systemPrompt: 'prompt' }),
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agent list'));

    expect(feishuClient.sendText).toHaveBeenCalledOnce();
    expect(copilot.generate).not.toHaveBeenCalled();
  });

  it('rejects /agent use without session store', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* () {
        yield 'ok';
      }),
    };

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: (id: string) => ({ id, systemPrompt: 'prompt' }),
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agent use debug'));

    expect(feishuClient.sendText).toHaveBeenCalledWith(
      'token-x',
      'chat-1',
      'Agent switching requires session storage support.',
    );
    expect(copilot.generate).not.toHaveBeenCalled();
  });

  it('supports /agent command with extra whitespace', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* () {
        yield 'ok';
      }),
    };

    const fakeSessionStore = {
      getOrCreate: () => ({ id: 's1', selectedAgentId: 'superpowers' }),
      appendMessage: vi.fn(),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({ id: 'superpowers', systemPrompt: 'prompt' }),
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agent    list'));

    expect(feishuClient.sendText).toHaveBeenCalledOnce();
    expect(copilot.generate).not.toHaveBeenCalled();
  });

  it('supports /agent command split by newline whitespace', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* () {
        yield 'ok';
      }),
    };

    const fakeSessionStore = {
      getOrCreate: () => ({ id: 's1', selectedAgentId: 'superpowers' }),
      appendMessage: vi.fn(),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({ id: 'superpowers', systemPrompt: 'prompt' }),
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agent\nlist'));

    expect(feishuClient.sendText).toHaveBeenCalledOnce();
    expect(copilot.generate).not.toHaveBeenCalled();
  });

  it('supports /agent current command', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* () {
        yield 'ok';
      }),
    };

    const fakeSessionStore = {
      getOrCreate: () => ({ id: 's1', selectedAgentId: 'debug' }),
      appendMessage: vi.fn(),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: (id: string) => ({ id, systemPrompt: 'prompt' }),
      getById: () => ({ id: 'debug', displayName: 'Systematic Debugging' }),
      formatForFeishu: () => 'agents',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agent current'));

    expect(feishuClient.sendText).toHaveBeenCalledWith(
      'token-x',
      'chat-1',
      'Current agent: debug (Systematic Debugging)',
    );
    expect(copilot.generate).not.toHaveBeenCalled();
  });

  it('rejects invalid /agent use target', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* () {
        yield 'ok';
      }),
    };

    const fakeSessionStore = {
      getOrCreate: () => ({ id: 's1', selectedAgentId: 'superpowers' }),
      appendMessage: vi.fn(),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => undefined,
      getById: () => undefined,
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', '/agent use missing-agent'));

    expect(feishuClient.sendText).toHaveBeenCalledOnce();
    expect(fakeSessionStore.setSelectedAgent).toHaveBeenCalledWith('s1', 'superpowers');
    expect(copilot.generate).not.toHaveBeenCalled();
  });

  it('auto-heals stale session agent id before routing', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (_message, _signal) {
        yield 'ok';
      }),
    };

    const fakeSession = { id: 's1', selectedAgentId: 'stale-agent' };
    const fakeSessionStore = {
      getOrCreate: () => fakeSession,
      appendMessage: vi.fn(),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: (id: string) =>
        id === 'superpowers' ? { id: 'superpowers', systemPrompt: 'prompt' } : undefined,
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', 'hello'));

    expect(fakeSessionStore.setSelectedAgent).toHaveBeenCalledWith('s1', 'superpowers');
    expect(copilot.generate).toHaveBeenCalledOnce();
  });

  it('includes shared session history when feishu continues an existing session', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (_message, _signal) {
        yield 'ok';
      }),
    };

    const fakeSession: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 2,
      messages: [
        { role: 'user', text: 'from feishu before', timestampMs: 1, source: 'feishu' },
        { role: 'assistant', text: 'from vscode before', timestampMs: 2, source: 'vscode' },
      ],
      archived: false,
    };

    const fakeSessionStore = {
      getOrCreate: () => fakeSession,
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string; timestampMs: number }) => {
        fakeSession.messages.push(message);
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const fakeRegistry = {
      getDefaultAgentId: () => 'superpowers',
      getRunnableById: () => ({ id: 'superpowers', systemPrompt: 'prompt' }),
      getById: () => ({ id: 'superpowers', displayName: 'Superpowers' }),
      formatForFeishu: () => 'Available agents:\n- superpowers',
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
      agentRegistry: fakeRegistry,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', 'current feishu turn'));

    const inbound = vi.mocked(copilot.generate).mock.calls[0][0];
    expect(inbound.text).toContain('[Feishu user]: from feishu before');
    expect(inbound.text).toContain('[VS Code assistant]: from vscode before');
    expect(inbound.text).toContain('[user]: current feishu turn');
    expect(inbound.text.match(/current feishu turn/g)).toHaveLength(1);
  });

  it('keeps feishu prompt minimal when the session has no prior history', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (_message, _signal) {
        yield 'ok';
      }),
    };

    const fakeSession: any = {
      id: 's1',
      feishuKey: 'chat-1',
      label: 'Session 1',
      selectedAgentId: 'superpowers',
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
      archived: false,
    };

    const fakeSessionStore = {
      getOrCreate: () => fakeSession,
      appendMessage: vi.fn((sessionId: string, message: { role: string; text: string; source: string; timestampMs: number }) => {
        fakeSession.messages.push(message);
      }),
      setSelectedAgent: vi.fn(),
    } as any;

    const pipeline = new Pipeline({
      config,
      copilot,
      feishuToken: 'token-x',
      sessionStore: fakeSessionStore,
    });

    await pipeline.handleInbound(makeEvent('ou_owner123', 'first turn'));

    const inbound = vi.mocked(copilot.generate).mock.calls[0][0];
    expect(inbound.text).toBe('first turn');
  });

  it('passes AbortSignal to copilot generate', async () => {
    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (_message, _signal) {
        yield 'ok';
      }),
    };
    const pipeline = new Pipeline({ config, copilot, feishuToken: 'token-x' });

    await pipeline.handleInbound(makeEvent('ou_owner123', 'hello'));

    const args = vi.mocked(copilot.generate).mock.calls[0];
    expect(args[1]).toBeInstanceOf(AbortSignal);
  });

  it('does not cancel in-flight request across different chat sessions', async () => {
    let resolveFirst: (() => void) | undefined;
    const firstReady = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const signals: AbortSignal[] = [];

    const copilot: CopilotAdapter = {
      generate: vi.fn(async function* (message, signal) {
        signals.push(signal as AbortSignal);
        if (message.text === 'first') {
          await firstReady;
          yield 'first-done';
          return;
        }
        yield 'second-done';
      }),
    };

    const pipeline = new Pipeline({ config, copilot, feishuToken: 'token-x' });

    const p1 = pipeline.handleInbound(makeEvent('ou_owner123', 'first', 'chat-a', 'msg-a'));
    await Promise.resolve();

    await pipeline.handleInbound(makeEvent('ou_owner123', 'second', 'chat-b', 'msg-b'));

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(false);

    resolveFirst?.();
    await p1;

    const interruptedUpdates = vi.mocked(feishuClient.updateCard).mock.calls.filter((call) =>
      typeof call[2] === 'string' && call[2].includes('Request interrupted by newer message.'),
    );
    expect(interruptedUpdates).toHaveLength(0);
  });
});
