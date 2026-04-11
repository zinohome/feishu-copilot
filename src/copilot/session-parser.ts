import type { CopilotTurn, SessionSummary } from '../types';

function collectAssistantText(response: Array<{ kind?: string; value?: string }> | undefined): string {
  return (response ?? [])
    .filter((part) => part.kind === 'markdownContent')
    .map((part) => part.value ?? '')
    .join('');
}

export function parseChatSessionJsonl(fileName: string, content: string, fileWriteTime: number): SessionSummary {
  const lines = content.split('\n').filter(Boolean);
  const snapshot = JSON.parse(lines[0]) as {
    v: {
      sessionId: string;
      customTitle?: string;
      requests?: Array<{
        requestId: string;
        timestamp: number;
        message?: { text?: string };
        response?: Array<{ kind?: string; value?: string }>;
      }>;
    };
  };

  const turns: CopilotTurn[] = (snapshot.v.requests ?? []).map((request) => ({
    requestId: request.requestId,
    userText: request.message?.text ?? '',
    assistantText: collectAssistantText(request.response),
    timestamp: request.timestamp,
  }));

  const lastUserMessageAt = turns.reduce((max, turn) => Math.max(max, turn.timestamp), 0);
  const lastAssistantMessageAt = turns.reduce(
    (max, turn) => (turn.assistantText ? Math.max(max, turn.timestamp) : max),
    0,
  );

  return {
    sessionId: snapshot.v.sessionId || fileName.replace(/\.jsonl$/, ''),
    title: snapshot.v.customTitle?.trim() || fileName.replace(/\.jsonl$/, ''),
    lastUserMessageAt,
    lastAssistantMessageAt,
    lastFileWriteAt: fileWriteTime,
    turns,
  };
}
