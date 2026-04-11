import * as Lark from '@larksuiteoapi/node-sdk';

export interface FeishuInboundMessage {
  senderOpenId: string;
  chatId: string;
  messageId: string;
  text: string;
  createTime: number;
}

export interface FeishuEventSourceOptions {
  appId: string;
  appSecret: string;
  onMessage: (message: FeishuInboundMessage) => Promise<void>;
  onError?: (error: unknown) => void;
}

export function startFeishuEventSource(options: FeishuEventSourceOptions): { dispose: () => void } {
  const dispatcher = new Lark.EventDispatcher({});
  dispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      const event = data?.event ?? data;
      // Feishu delivers non-text messages (images, files, cards) with a different content schema.
      // An unparseable or text-absent payload is silently ignored rather than crashing the WS loop.
      let text: string;
      try {
        text = (JSON.parse(event.message.content) as { text?: string }).text ?? '';
      } catch {
        return;
      }
      if (!text) {
        return;
      }
      await options.onMessage({
        senderOpenId: event.sender.sender_id.open_id,
        chatId: event.message.chat_id,
        messageId: event.message.message_id,
        text,
        createTime: Number(event.message.create_time),
      });
    },
  } as Record<string, (payload: unknown) => Promise<void>>);

  const client = new Lark.WSClient({
    appId: options.appId,
    appSecret: options.appSecret,
    autoReconnect: true,
    loggerLevel: Lark.LoggerLevel.warn,
  });

  void client.start({ eventDispatcher: dispatcher }).catch((error) => options.onError?.(error));
  return { dispose: () => client.close({ force: true }) };
}
