import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuWebhookEvent } from '../app/pipeline';

export interface FeishuWsEventSourceOptions {
  appId: string;
  appSecret: string;
  onMessage: (event: FeishuWebhookEvent) => Promise<void>;
  onError?: (err: { phase: 'start' | 'message'; error: unknown }) => void;
}

export interface FeishuWsEventSourceHandle {
  close: () => void;
  getReconnectInfo?: () => { lastConnectTime: number; nextConnectTime: number };
}

function mapIncomingToPipelineEvent(data: unknown): FeishuWebhookEvent | null {
  const payload =
    data && typeof data === 'object' && 'event' in (data as Record<string, unknown>)
      ? ((data as Record<string, unknown>).event as Record<string, unknown>)
      : (data as Record<string, unknown>);

  if (!payload || typeof payload !== 'object') return null;

  const sender = payload.sender as Record<string, unknown> | undefined;
  const senderId = sender?.sender_id as Record<string, unknown> | undefined;
  const openId =
    (senderId?.open_id as string | undefined) ||
    (sender?.open_id as string | undefined) ||
    '';

  const message = payload.message as Record<string, unknown> | undefined;
  const messageId = (message?.message_id as string | undefined) || '';
  const content = (message?.content as string | undefined) || '';
  const chatId = (message?.chat_id as string | undefined) || '';
  const createTime = (message?.create_time as string | undefined) || `${Date.now()}`;

  if (!openId || !messageId || !chatId) return null;

  return {
    sender: { open_id: openId },
    message: {
      message_id: messageId,
      content,
      chat_id: chatId,
      create_time: createTime,
    },
  };
}

export function startFeishuWsEventSource(options: FeishuWsEventSourceOptions): FeishuWsEventSourceHandle {
  const dispatcher = new Lark.EventDispatcher({});
  dispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      try {
        const mapped = mapIncomingToPipelineEvent(data);
        if (!mapped) {
          return;
        }
        await options.onMessage(mapped);
      } catch (err) {
        options.onError?.({ phase: 'message', error: err });
      }
    },
  } as Record<string, (data: unknown) => Promise<void>>);

  const wsClient = new Lark.WSClient({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: Lark.LoggerLevel.warn,
    autoReconnect: true,
  });

  void wsClient.start({ eventDispatcher: dispatcher }).catch((err) => {
    options.onError?.({ phase: 'start', error: err });
  });

  return {
    close: () => {
      wsClient.close({ force: true });
    },
    getReconnectInfo: () => wsClient.getReconnectInfo(),
  };
}

export { mapIncomingToPipelineEvent };
