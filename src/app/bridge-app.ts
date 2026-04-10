import type { CopilotAdapter } from '../copilot/copilot-adapter';
import type { InboundChatMessage } from '../domain/message-types';

export interface BridgeHandleMessageResult {
  finalState: 'done' | 'interrupted';
  finalText: string;
}

export class BridgeApp {
  constructor(private readonly copilot: CopilotAdapter) {}

  async handleMessage(message: InboundChatMessage): Promise<BridgeHandleMessageResult> {
    const chunks = await this.copilot.generate(message);
    let finalText = '';

    for await (const chunk of chunks) {
      finalText += chunk;
    }

    return { finalState: 'done', finalText };
  }

  async handleCancelledMessage(_message: InboundChatMessage): Promise<BridgeHandleMessageResult> {
    return {
      finalState: 'interrupted',
      finalText: 'Request interrupted by newer message.',
    };
  }
}
