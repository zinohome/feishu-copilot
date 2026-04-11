import type { CopilotTurn, SessionSummary } from '../types';

function collectAssistantText(response: Array<{ kind?: string; value?: string }> | undefined): string {
  return (response ?? [])
    .filter((part) => part.kind === 'markdownContent' || (part.kind !== 'thinking' && part.kind !== 'toolInvocationSerialized' && part.kind !== 'prepareToolInvocation' && part.kind !== 'mcpServersStarting' && !part.kind?.startsWith('mcp')))
    .map((part) => part.value ?? '')
    .filter((val) => val.trim())
    .join('\n');
}

/**
 * Parse a VS Code/Cursor chat session file in .json format
 * Format: { version: 3, requests: [...], sessionId: "...", ... }
 */
export function parseChatSessionJson(
  fileName: string,
  content: string,
  fileWriteTime: number,
): SessionSummary {
  let sessionData: any;
  try {
    sessionData = JSON.parse(content);
  } catch {
    console.warn('[session-parser] failed to parse JSON:', fileName);
    return {
      sessionId: fileName.replace(/\.json$/, ''),
      title: fileName.replace(/\.json$/, ''),
      lastUserMessageAt: 0,
      lastAssistantMessageAt: 0,
      lastFileWriteAt: fileWriteTime,
      turns: [],
    };
  }

  const requests = sessionData.requests ?? [];
  const turns: CopilotTurn[] = requests
    .filter((req: any) => req.requestId && req.message)
    .map((request: any) => ({
      requestId: request.requestId,
      userText: request.message?.text ?? '',
      assistantText: collectAssistantText(request.response),
      timestamp: request.timestamp ?? fileWriteTime,
    }));

  const lastUserMessageAt = turns.reduce((max, turn) => Math.max(max, turn.timestamp), 0);
  const lastAssistantMessageAt = turns.reduce(
    (max, turn) => (turn.assistantText ? Math.max(max, turn.timestamp) : max),
    0,
  );

  return {
    sessionId: sessionData.sessionId || fileName.replace(/\.json$/, ''),
    title: sessionData.title?.trim() || fileName.replace(/\.json$/, ''),
    lastUserMessageAt,
    lastAssistantMessageAt,
    lastFileWriteAt: fileWriteTime,
    turns,
  };
}

/**
 * Legacy: parse JSONL format (if still needed)
 */
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
