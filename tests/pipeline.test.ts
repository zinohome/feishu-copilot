import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Pipeline } from '../src/app/pipeline';
import type { FeishuWebhookEvent } from '../src/app/pipeline';
import type { BridgeConfig } from '../src/config/types';
import type { CopilotAdapter } from '../src/copilot/copilot-adapter';

vi.mock('../src/feishu/feishu-client', () => ({
  sendCard: vi.fn().mockResolvedValue('card-msg-id-1'),
  updateCard: vi.fn().mockResolvedValue(undefined),
  sendText: vi.fn().mockResolvedValue('text-msg-id-1'),
}));

import * as feishuClient from '../src/feishu/feishu-client';

const config: BridgeConfig = {
  ownerOpenId: 'ou_owner123',
  workspaceAllowlist: [],
  approvalTimeoutMs: 5000,
  cardPatchIntervalMs: 0,
};

function makeEvent(openId: string, text = 'hello'): FeishuWebhookEvent {
  return {
    sender: { open_id: openId },
    message: {
      message_id: 'msg-1',
      content: JSON.stringify({ text }),
      chat_id: 'chat-1',
      create_time: '1712726400000',
    },
  };
}

describe('Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores messages from non-whitelisted users', async () => {
    const copilot: CopilotAdapter = { generate: vi.fn() };
    const pipeline = new Pipeline({ config, copilot, feishuToken: 'token-x' });

    await pipeline.handleInbound(makeEvent('ou_stranger'));

    expect(copilot.generate).not.toHaveBeenCalled();
    expect(feishuClient.sendCard).not.toHaveBeenCalled();
  });

  it('processes messages from whitelisted users and updates card', async () => {
    const copilot: CopilotAdapter = {
      async *generate() {
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
});
