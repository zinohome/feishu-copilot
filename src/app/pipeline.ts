import { CardRenderer } from '../card/card-renderer';
import type { BridgeConfig } from '../config/types';
import type { CopilotAdapter } from '../copilot/copilot-adapter';
import type { InboundChatMessage } from '../domain/message-types';
import { sendCard, sendText, updateCard } from '../feishu/feishu-client';
import { SessionRouter } from '../session/session-router';

export interface FeishuWebhookEvent {
  sender: {
    open_id: string;
  };
  message: {
    message_id: string;
    /** JSON string: {"text":"..."} */
    content: string;
    chat_id: string;
    /** Millisecond timestamp as string */
    create_time: string;
  };
}

export interface PipelineOptions {
  config: BridgeConfig;
  copilot: CopilotAdapter;
  feishuToken: string;
}

const THINKING_CARD = JSON.stringify({
  config: { wide_screen_mode: true },
  elements: [{ tag: 'div', text: { tag: 'lark_md', content: '⏳ Thinking...' } }],
});

function makeTextCard(text: string): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }],
  });
}

export class Pipeline {
  private readonly sessionRouter = new SessionRouter();

  constructor(private readonly options: PipelineOptions) {}

  async handleInbound(event: FeishuWebhookEvent): Promise<void> {
    const { config, copilot, feishuToken } = this.options;

    // a. Whitelist check
    if (event.sender.open_id !== config.ownerOpenId) {
      return;
    }

    // b. Extract text from content JSON
    let text: string;
    try {
      const parsed = JSON.parse(event.message.content) as { text?: string };
      text = parsed.text ?? '';
    } catch {
      text = event.message.content;
    }

    // c. Build InboundChatMessage
    const message: InboundChatMessage = {
      userId: event.sender.open_id,
      messageId: event.message.message_id,
      chatType: 'p2p',
      text,
      timestampMs: Number(event.message.create_time),
    };

    // d. Enqueue in SessionRouter (cancels any previous request for this user)
    const requestState = this.sessionRouter.enqueue(message.userId, message.messageId);

    try {
      // e. Send initial thinking card
      const cardMessageId = await sendCard(feishuToken, event.message.chat_id, THINKING_CARD);

      // f. Create CardRenderer; onFlush updates the card
      const renderer = new CardRenderer({
        throttleMs: config.cardPatchIntervalMs,
        onFlush: (currentText, _reason) => {
          void updateCard(feishuToken, cardMessageId, makeTextCard(currentText));
        },
      });

      // g. Stream copilot chunks into renderer
      const chunks = await copilot.generate(message);
      for await (const chunk of chunks) {
        renderer.pushChunk(chunk);
      }

      // h. Interrupted by a newer request
      if (requestState.cancelled) {
        await updateCard(
          feishuToken,
          cardMessageId,
          makeTextCard('⚠️ Request interrupted by newer message.'),
        );
        return;
      }

      // i. Finalize – triggers final onFlush which updates the card
      renderer.finalize();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await sendText(feishuToken, event.message.chat_id, `❌ Error: ${errMsg}`);
    }
  }
}
