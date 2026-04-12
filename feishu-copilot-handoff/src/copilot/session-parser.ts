import type { CopilotTurn, SessionSummary } from '../types';

function collectPrimitiveFragments(node: unknown): string[] {
  if (typeof node === 'string') {
    return [node];
  }

  if (typeof node === 'number' || typeof node === 'boolean') {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap((item) => collectPrimitiveFragments(item));
  }

  if (!node || typeof node !== 'object') {
    return [];
  }

  const fragments: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'kind') {
      continue;
    }
    fragments.push(...collectPrimitiveFragments(value));
  }
  return fragments;
}

/**
 * Kinds that represent tool calls, internal state, or UI chrome — not user-visible
 * assistant prose.  When we encounter a response part with one of these kinds we
 * skip it so that the final assistantText only contains readable content.
 */
const METADATA_KINDS = new Set([
  'thinking',
  'toolInvocationSerialized',
  'progressTaskSerialized',
  'inlineReference',
  'textEditGroup',
  'elicitationSerialized',
  'mcpServersStarting',
]);

/**
 * Fields on a "rich text" part that carry UI chrome, not user-visible prose.
 * We exclude these from primitive extraction so that booleans, URIs, etc.
 * don't leak into the assistant text.
 */
const UI_CHROME_FIELDS = new Set([
  'supportThemeIcons',
  'supportHtml',
  'supportAlertSyntax',
  'baseUri',
  'uris',
  'id',
  'metadata',
  'isComplete',
  'source',
  'toolCallId',
  'toolId',
  'invocationMessage',
  'presentation',
]);

function isReadablePart(part: unknown): boolean {
  if (!part || typeof part !== 'object') {
    return false;
  }
  const kind = (part as Record<string, unknown>).kind;
  // Parts without a `kind` field are plain text/markdown — always readable.
  if (kind === undefined) {
    return true;
  }
  // markdownContent is explicitly readable.
  if (kind === 'markdownContent') {
    return true;
  }
  // Everything else in METADATA_KINDS is not user-visible prose.
  return false;
}

function extractResponsePartText(part: unknown): string {
  if (!part || typeof part !== 'object') {
    return '';
  }

  // Skip metadata parts entirely — they contain tool-call state, encrypted
  // thinking blobs, progress indicators, etc., not user-visible text.
  if (!isReadablePart(part)) {
    return '';
  }

  // For readable parts, extract only the `value` field (or the text content),
  // not UI chrome fields like supportThemeIcons, baseUri, etc.
  const obj = part as Record<string, unknown>;
  if (typeof obj.value === 'string' && obj.value.length > 0) {
    return obj.value;
  }

  // Fallback: collect primitive fragments but exclude UI chrome fields
  const fragments: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'kind' || UI_CHROME_FIELDS.has(key)) {
      continue;
    }
    if (typeof val === 'string' && val.length > 0) {
      fragments.push(val);
    }
  }
  return fragments.join('\n');
}

function collectAssistantText(response: unknown[] | undefined): string {
  return (response ?? [])
    .map((part) => extractResponsePartText(part))
    .filter((val) => val.length > 0)
    .join('\n');
}

function collectAssistantTextFromEventResponse(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => extractResponsePartText(part))
    .filter((text) => text.length > 0)
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
  const fallbackSessionId = fileName.replace(/\.jsonl$/, '');

  if (lines.length === 0) {
    return {
      sessionId: fallbackSessionId,
      title: fallbackSessionId,
      lastUserMessageAt: 0,
      lastAssistantMessageAt: 0,
      lastFileWriteAt: fileWriteTime,
      turns: [],
    };
  }

  type SnapshotRequest = {
    requestId?: string;
    timestamp?: number;
    message?: { text?: string };
    response?: unknown[];
  };
  type EventTurn = CopilotTurn & { index: number };
  const turnsByIndex = new Map<number, EventTurn>();
  const pendingAppendIndexes: number[] = [];
  const pendingResponseIndexes: number[] = [];
  const pendingResponseIndexSet = new Set<number>();
  let requestIndex = 0;
  let sessionId = fallbackSessionId;
  let title = fallbackSessionId;

  for (const line of lines) {
    let entry: { kind?: number; k?: unknown[]; v?: unknown };
    try {
      entry = JSON.parse(line) as { kind?: number; k?: unknown[]; v?: unknown };
    } catch {
      continue;
    }

    if (!Array.isArray(entry.k)) {
      const snapshot = entry as {
        v?: {
          sessionId?: string;
          customTitle?: string;
          requests?: SnapshotRequest[];
        };
      };
      if (!snapshot.v) {
        continue;
      }

      sessionId = snapshot.v.sessionId || sessionId;
      title = snapshot.v.customTitle?.trim() || title;

      for (const request of snapshot.v.requests ?? []) {
        const idx = requestIndex;
        requestIndex += 1;
        turnsByIndex.set(idx, {
          index: idx,
          requestId: request.requestId ?? `req-${idx}`,
          userText: request.message?.text ?? '',
          assistantText: collectAssistantText(request.response),
          timestamp: request.timestamp ?? fileWriteTime,
        });
      }
      continue;
    }

    if (entry.k[0] !== 'requests') {
      continue;
    }

    // Append request(s): { k: ['requests'], v: [{ requestId, message, timestamp, ...}] }
    if (entry.k.length === 1 && Array.isArray(entry.v)) {
      for (const req of entry.v) {
        if (!req || typeof req !== 'object') {
          continue;
        }
        const request = req as {
          requestId?: string;
          timestamp?: number;
          message?: { text?: string };
          response?: unknown;
        };
        // If response patches for an absolute index arrived first, backfill this append into that slot.
        const responseFirstIdx = pendingResponseIndexes.shift();
        if (responseFirstIdx !== undefined) {
          pendingResponseIndexSet.delete(responseFirstIdx);
          const existing = turnsByIndex.get(responseFirstIdx);
          if (existing) {
            existing.requestId = request.requestId ?? existing.requestId;
            existing.userText = request.message?.text ?? existing.userText;
            existing.timestamp = request.timestamp ?? existing.timestamp;
            turnsByIndex.set(responseFirstIdx, existing);
            continue;
          }
        }

        const idx = requestIndex;
        requestIndex += 1;
        turnsByIndex.set(idx, {
          index: idx,
          requestId: request.requestId ?? `req-${idx}`,
          userText: request.message?.text ?? '',
          assistantText: collectAssistantTextFromEventResponse(request.response),
          timestamp: request.timestamp ?? fileWriteTime,
        });
        pendingAppendIndexes.push(idx);
      }
      continue;
    }

    // Per-request updates: { k: ['requests', idx, ...], v: ... }
    if (typeof entry.k[1] !== 'number') {
      continue;
    }

    const idx = entry.k[1];
    const field = entry.k[2];
    const subfield = entry.k[3];
    requestIndex = Math.max(requestIndex, idx + 1);

    let existing = turnsByIndex.get(idx);
    if (!existing && pendingAppendIndexes.length > 0) {
      const pendingIdx = pendingAppendIndexes.shift();
      if (pendingIdx !== undefined) {
        const pendingTurn = turnsByIndex.get(pendingIdx);
        if (pendingTurn) {
          turnsByIndex.delete(pendingIdx);
          pendingTurn.index = idx;
          turnsByIndex.set(idx, pendingTurn);
          existing = pendingTurn;
        }
      }
    }

    existing ??= {
      index: idx,
      requestId: `req-${idx}`,
      userText: '',
      assistantText: '',
      timestamp: fileWriteTime,
    };

    if (field === 'requestId' && typeof entry.v === 'string') {
      existing.requestId = entry.v;
    }

    if (field === 'timestamp' && typeof entry.v === 'number') {
      existing.timestamp = entry.v;
    }

    if (field === 'message' && !subfield && entry.v && typeof entry.v === 'object') {
      const message = entry.v as { text?: string };
      if (typeof message.text === 'string') {
        existing.userText = message.text;
      }
    }

    if (field === 'message' && subfield === 'text' && typeof entry.v === 'string') {
      existing.userText = entry.v;
    }

    if (field === 'response') {
      if (subfield === undefined) {
        // Full response replacement — only overwrite if the new response
        // contains readable text.  Metadata-only responses (e.g. a final
        // progressTaskSerialized event) must not clobber existing prose.
        const assistantText = collectAssistantTextFromEventResponse(entry.v);
        if (assistantText) {
          existing.assistantText = assistantText;
        }
      } else {
        // Individual response-part patch — skip metadata parts.
        if (typeof entry.v === 'string') {
          // String leaf patches (e.g. k: ['requests', N, 'response', M, 'value'])
          // are always readable text.
          if (entry.v) {
            existing.assistantText = existing.assistantText
              ? `${existing.assistantText}\n${entry.v}`
              : entry.v;
          }
        } else {
          const partText = extractResponsePartText(entry.v);
          if (partText) {
            existing.assistantText = existing.assistantText
              ? `${existing.assistantText}\n${partText}`
              : partText;
          }
        }
      }

      // If this index has response first but no request text yet, queue it for append backfill.
      if (!existing.userText && !pendingResponseIndexSet.has(idx)) {
        pendingResponseIndexes.push(idx);
        pendingResponseIndexSet.add(idx);
      }
    }

    turnsByIndex.set(idx, existing);
  }

  const turns = [...turnsByIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ index, ...turn }) => turn)
    .filter((turn) => turn.userText || turn.assistantText);

  const lastUserMessageAt = turns.reduce((max, turn) => Math.max(max, turn.timestamp), 0);
  const lastAssistantMessageAt = turns.reduce(
    (max, turn) => (turn.assistantText ? Math.max(max, turn.timestamp) : max),
    0,
  );

  return {
    sessionId,
    title,
    lastUserMessageAt,
    lastAssistantMessageAt,
    lastFileWriteAt: fileWriteTime,
    turns,
  };
}
