import { describe, expect, it, vi } from 'vitest';
import { BridgeController } from '../src/handoff/bridge-controller';

describe('BridgeController mirror flow', () => {
  it('mirrors only the current target session to Feishu', async () => {
    const sendText = vi.fn().mockResolvedValue('msg_1');
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: sendText,
    });

    await controller.handleSessionUpdate({
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 100,
      lastAssistantMessageAt: 100,
      lastFileWriteAt: 100,
      turns: [{ requestId: 'r1', userText: 'hello', assistantText: 'world', timestamp: 100 }],
    });

    expect(sendText).toHaveBeenCalledWith(
      'oc_target',
      expect.stringContaining('React 重构'),
    );
  });
});
