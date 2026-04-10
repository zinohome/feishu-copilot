import type { InboundChatMessage } from '../domain/message-types';

export interface CopilotAdapter {
  generate(message: InboundChatMessage): AsyncIterable<string> | Promise<AsyncIterable<string>>;
}
