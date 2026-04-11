import { describe, expect, it, vi } from 'vitest';

const registerMock = vi.fn();
const startMock = vi.fn().mockResolvedValue(undefined);
const closeMock = vi.fn();
const getReconnectInfoMock = vi.fn().mockReturnValue({
  lastConnectTime: 100,
  nextConnectTime: 200,
});

vi.mock('@larksuiteoapi/node-sdk', () => {
  class EventDispatcher {
    register = registerMock;
  }

  class WSClient {
    start = startMock;
    close = closeMock;
    getReconnectInfo = getReconnectInfoMock;
  }

  return {
    EventDispatcher,
    WSClient,
    LoggerLevel: { info: 'info' },
  };
});

import { mapIncomingToPipelineEvent, startFeishuWsEventSource } from '../archive/src/feishu/ws-event-source';

describe('mapIncomingToPipelineEvent', () => {
  it('maps flattened message event payload', () => {
    const mapped = mapIncomingToPipelineEvent({
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_id: 'm_1',
        content: '{"text":"hello"}',
        chat_id: 'oc_1',
        create_time: '1712726400000',
      },
    });

    expect(mapped).toEqual({
      sender: { open_id: 'ou_1' },
      message: {
        message_id: 'm_1',
        content: '{"text":"hello"}',
        chat_id: 'oc_1',
        create_time: '1712726400000',
      },
    });
  });

  it('returns null when payload misses required ids', () => {
    expect(mapIncomingToPipelineEvent({ message: { message_id: 'm_1' } })).toBeNull();
  });
});

describe('startFeishuWsEventSource', () => {
  it('starts sdk ws client and exposes close/reconnect info', async () => {
    const handle = startFeishuWsEventSource({
      appId: 'cli_xxx',
      appSecret: 'sec_xxx',
      onMessage: async () => {},
    });

    expect(registerMock).toHaveBeenCalledOnce();
    expect(startMock).toHaveBeenCalledOnce();

    expect(handle.getReconnectInfo?.()).toEqual({
      lastConnectTime: 100,
      nextConnectTime: 200,
    });

    handle.close();
    expect(closeMock).toHaveBeenCalledWith({ force: true });
  });

  it('reports onMessage errors through onError', async () => {
    const onError = vi.fn();
    let handler: ((data: unknown) => Promise<void>) | undefined;
    registerMock.mockImplementation((events: Record<string, (data: unknown) => Promise<void>>) => {
      handler = events['im.message.receive_v1'];
    });

    startFeishuWsEventSource({
      appId: 'cli_xxx',
      appSecret: 'sec_xxx',
      onMessage: async () => {
        throw new Error('boom');
      },
      onError,
    });

    await handler?.({
      sender: { sender_id: { open_id: 'ou_1' } },
      message: { message_id: 'm_1', content: '{}', chat_id: 'oc_1', create_time: '1' },
    });

    expect(onError).toHaveBeenCalledWith({
      phase: 'message',
      error: expect.any(Error),
    });
  });

  it('reports ws start failure through onError', async () => {
    const onError = vi.fn();
    startMock.mockRejectedValueOnce(new Error('start failed'));

    startFeishuWsEventSource({
      appId: 'cli_xxx',
      appSecret: 'sec_xxx',
      onMessage: async () => {},
      onError,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith({
      phase: 'start',
      error: expect.any(Error),
    });
  });
});
