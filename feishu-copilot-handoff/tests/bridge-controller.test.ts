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
      expect.any(Object),
    );
  });

  it('does not mirror before target chat is bound and starts mirroring after setTargetChatId', async () => {
    const sendText = vi.fn().mockResolvedValue('msg_1');
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
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
    expect(sendText).not.toHaveBeenCalled();

    controller.setTargetChatId('oc_runtime');
    await controller.handleSessionUpdate({
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 101,
      lastAssistantMessageAt: 101,
      lastFileWriteAt: 101,
      turns: [{ requestId: 'r2', userText: 'next', assistantText: 'turn', timestamp: 101 }],
    });

    expect(sendText).toHaveBeenCalledWith('oc_runtime', expect.any(String), expect.any(Object));
  });

  it('re-mirrors when the same requestId gets updated assistant text', async () => {
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
      turns: [{ requestId: 'r1', userText: 'hello', assistantText: 'wo', timestamp: 100 }],
    });

    await controller.handleSessionUpdate({
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 100,
      lastAssistantMessageAt: 101,
      lastFileWriteAt: 101,
      turns: [{ requestId: 'r1', userText: 'hello', assistantText: 'world', timestamp: 100 }],
    });

    // 1st update: switch + user msg + assistant('wo') = 3 calls
    // 2nd update: assistant updated to 'world' = 1 more call
    expect(sendText).toHaveBeenCalledTimes(4);
    expect(sendText).toHaveBeenNthCalledWith(4, 'oc_target', expect.stringContaining('world'), expect.any(Object));
  });

  it('retries assistant send on next update when a previous assistant send failed', async () => {
    const sendText = vi
      .fn()
      .mockResolvedValueOnce('msg_switch')
      .mockResolvedValueOnce('msg_user')
      .mockRejectedValueOnce(new Error('temporary assistant send failure'))
      .mockResolvedValueOnce('msg_assistant_retry');
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: sendText,
    });

    const summary = {
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 100,
      lastAssistantMessageAt: 100,
      lastFileWriteAt: 100,
      turns: [{ requestId: 'r1', userText: 'hello', assistantText: 'world', timestamp: 100 }],
    };

    await controller.handleSessionUpdate(summary);
    await controller.handleSessionUpdate(summary);

    expect(sendText).toHaveBeenNthCalledWith(4, 'oc_target', expect.stringContaining('world'), expect.any(Object));
  });

  it('keeps raw assistant content and retries on next update when send fails', async () => {
    const sendText = vi
      .fn()
      .mockResolvedValueOnce('msg_switch')
      .mockResolvedValueOnce('msg_user')
      .mockRejectedValueOnce(new Error('assistant markdown send failed'))
      .mockResolvedValueOnce('msg_assistant_retry');
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: sendText,
    });

    const summary = {
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 100,
      lastAssistantMessageAt: 100,
      lastFileWriteAt: 100,
      turns: [{ requestId: 'r1', userText: 'hello', assistantText: '**ok** `done`', timestamp: 100 }],
    };

    await controller.handleSessionUpdate(summary);
    await controller.handleSessionUpdate(summary);

    expect(sendText).toHaveBeenNthCalledWith(3, 'oc_target', expect.stringContaining('**ok** `done`'), expect.any(Object));
    expect(sendText).toHaveBeenNthCalledWith(4, 'oc_target', expect.stringContaining('**ok** `done`'), expect.any(Object));
  });

  it('retries user send on next update when a previous user send failed', async () => {
    const sendText = vi
      .fn()
      .mockResolvedValueOnce('msg_switch')
      .mockRejectedValueOnce(new Error('temporary user send failure'))
      .mockResolvedValueOnce('msg_user_retry')
      .mockResolvedValueOnce('msg_assistant');
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: sendText,
    });

    const summary = {
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 100,
      lastAssistantMessageAt: 100,
      lastFileWriteAt: 100,
      turns: [{ requestId: 'r1', userText: 'hello', assistantText: 'world', timestamp: 100 }],
    };

    await controller.handleSessionUpdate(summary);
    await controller.handleSessionUpdate(summary);

    expect(sendText).toHaveBeenNthCalledWith(3, 'oc_target', expect.stringContaining('hello'), expect.any(Object));
    expect(sendText).toHaveBeenNthCalledWith(4, 'oc_target', expect.stringContaining('world'), expect.any(Object));
  });

  it('still sends delayed assistant reply when a newer user turn already exists', async () => {
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
      lastAssistantMessageAt: 0,
      lastFileWriteAt: 100,
      turns: [{ requestId: 'r1', userText: 'Q1', assistantText: '', timestamp: 100 }],
    });

    await controller.handleSessionUpdate({
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 101,
      lastAssistantMessageAt: 101,
      lastFileWriteAt: 101,
      turns: [
        { requestId: 'r1', userText: 'Q1', assistantText: 'A1', timestamp: 100 },
        { requestId: 'r2', userText: 'Q2', assistantText: '', timestamp: 101 },
      ],
    });

    const sentPayloads = sendText.mock.calls.map((args) => String(args[1]));
    expect(sentPayloads.some((p) => p.includes('Q1'))).toBe(true);
    expect(sentPayloads.some((p) => p.includes('A1'))).toBe(true);
    expect(sentPayloads.some((p) => p.includes('Q2'))).toBe(true);
  });

  it('does not echo Feishu-originated user text back to Feishu', async () => {
    const sendText = vi.fn().mockResolvedValue('msg_1');
    const submitToChat = vi.fn().mockResolvedValue(undefined);
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: sendText,
    });

    await controller.handleFeishuText('这是飞书端发过来的消息', submitToChat);

    await controller.handleSessionUpdate({
      sessionId: 'session-1',
      title: 'React 重构',
      lastUserMessageAt: 100,
      lastAssistantMessageAt: 101,
      lastFileWriteAt: 101,
      turns: [
        {
          requestId: 'r1',
          userText: '这是飞书端发过来的消息',
          assistantText: '我收到了',
          timestamp: 100,
        },
      ],
    });

    const sentPayloads = sendText.mock.calls.map((args) => String(args[1]));
    expect(sentPayloads.some((p) => p.includes('这是飞书端发过来的消息'))).toBe(false);
    expect(sentPayloads.some((p) => p.includes('我收到了'))).toBe(true);
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

describe('BridgeController handleFeishuText routing', () => {
  function makeController() {
    const controller = new BridgeController({
      ownerOpenId: 'ou_owner',
      targetChatId: 'oc_target',
      sendFeishuText: vi.fn().mockResolvedValue('msg_1'),
    });
    // seed two sessions
    controller['tracker'].upsert({ sessionId: 'a', title: 'Alpha', lastUserMessageAt: 10, lastAssistantMessageAt: 10, lastFileWriteAt: 10, turns: [] });
    controller['tracker'].upsert({ sessionId: 'b', title: 'Beta', lastUserMessageAt: 20, lastAssistantMessageAt: 20, lastFileWriteAt: 20, turns: [] });
    return controller;
  }

  it('/sessions returns numbered list', async () => {
    const result = await makeController().handleFeishuText('/sessions', vi.fn());
    expect(result).toContain('1. Beta');
    expect(result).toContain('2. Alpha');
  });

  it('/status returns mode and session name', async () => {
    const result = await makeController().handleFeishuText('/status', vi.fn());
    expect(result).toContain('follow-latest');
    expect(result).toContain('Beta');
  });

  it('/switch N locks to chosen index', async () => {
    const controller = makeController();
    const result = await controller.handleFeishuText('/switch 2', vi.fn());
    expect(result).toContain('manual-lock');
    expect(result).toContain('Alpha');
  });

  it('/follow-latest returns to auto-follow', async () => {
    const controller = makeController();
    controller.switchByIndex(2);
    const result = await controller.handleFeishuText('/follow-latest', vi.fn());
    expect(result).toContain('follow-latest');
  });

  it('plain text is forwarded to submitToChat and returns undefined', async () => {
    const submitToChat = vi.fn().mockResolvedValue(undefined);
    const result = await makeController().handleFeishuText('help me fix this bug', submitToChat);
    expect(submitToChat).toHaveBeenCalledWith('help me fix this bug');
    expect(result).toBeUndefined();
  });

  it('/switch with out-of-range index throws', async () => {
    await expect(
      makeController().handleFeishuText('/switch 99', vi.fn()),
    ).rejects.toThrow('Unknown session index: 99');
  });
});
