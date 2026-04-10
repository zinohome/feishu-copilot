import type { InboundChatMessage } from '../domain/message-types';

export interface CopilotAdapter {
  generate(message: InboundChatMessage, signal?: AbortSignal): AsyncIterable<string> | Promise<AsyncIterable<string>>;
}
