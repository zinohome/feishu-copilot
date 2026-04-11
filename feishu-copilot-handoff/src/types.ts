export interface ExtensionConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  ownerOpenId: string;
  targetChatId: string;
  statusCardEnabled: boolean;
  maxMirroredSessions: number;
}

export interface CopilotTurn {
  requestId: string;
  userText: string;
  assistantText: string;
  timestamp: number;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  lastUserMessageAt: number;
  lastAssistantMessageAt: number;
  lastFileWriteAt: number;
  turns: CopilotTurn[];
}

export type SessionSelectionMode = 'follow-latest' | 'manual-lock';
