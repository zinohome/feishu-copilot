export interface InboundChatMessage {
  userId: string;
  messageId: string;
  chatType: 'p2p';
  text: string;
  timestampMs: number;
}

export interface OutboundCardUpdate {
  cardMessageId: string;
  phase: 'thinking' | 'streaming' | 'done' | 'error' | 'interrupted';
  text: string;
}
