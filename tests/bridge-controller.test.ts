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

describe('BridgeController remote commands', () => {
  it('locks a chosen session and returns status text for follow-latest', async () => {
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: vi.fn().mockResolvedValue('msg_1'),
    });

    await controller.handleSessionUpdate({ sessionId: 'a', title: 'A', lastUserMessageAt: 10, lastAssistantMessageAt: 10, lastFileWriteAt: 10, turns: [] });
    await controller.handleSessionUpdate({ sessionId: 'b', title: 'B', lastUserMessageAt: 20, lastAssistantMessageAt: 20, lastFileWriteAt: 20, turns: [] });

    const sessionsText = controller.renderSessionsList();
    expect(sessionsText).toContain('1. B');
    expect(sessionsText).toContain('2. A');

    controller.switchByIndex(2);
    expect(controller.getStatusText()).toContain('manual-lock');

    controller.followLatest();
    expect(controller.getStatusText()).toContain('follow-latest');
  });
});
