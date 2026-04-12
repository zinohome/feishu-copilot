/**
 * SessionMonitor — streams Copilot chat session events from a JSONL file.
 *
 * Architecture:
 *   - Monitors the file as a tail-f would: tracks byte offset, reads only new content on each poll.
 *   - Emits events immediately as they appear — no waiting for "complete responses".
 *   - Deduplicates by requestId so user messages are sent at most once, and assistant
 *     messages are sent at most once per requestId (always the latest content).
 *
 * Event flow:
 *   k: ['requests']  + message.text  → user-message event
 *   k: ['requests', N, 'response']   → assistant-message event for request at index N
 *
 * No index mapping, no turn reconstruction, no waiting for response/request pairing.
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import type { CopilotTurn } from '../types';

/** Fields on a "rich text" part that carry UI chrome, not user-visible prose. */
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

/** Kinds that represent tool calls, internal state, or UI chrome — not user-visible prose. */
const METADATA_KINDS = new Set([
  'thinking',
  'toolInvocationSerialized',
  'progressTaskSerialized',
  'inlineReference',
  'textEditGroup',
  'elicitationSerialized',
  'mcpServersStarting',
]);

function isReadablePart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const kind = (part as Record<string, unknown>).kind;
  if (kind === undefined) return true;       // plain text/markdown — always readable
  if (kind === 'markdownContent') return true;
  return false;
}

function extractReadableText(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  if (!isReadablePart(part)) return '';

  const obj = part as Record<string, unknown>;

  // toolInvocationSerialized: extract invocationMessage.value if present
  const toolPart = part as { kind?: string; invocationMessage?: { value?: string } };
  if (toolPart.kind === 'toolInvocationSerialized' && toolPart.invocationMessage?.value) {
    return toolPart.invocationMessage.value;
  }

  // Direct string value
  if (typeof obj.value === 'string' && obj.value.length > 0) {
    return obj.value;
  }

  // Fallback: collect primitive values but skip UI chrome fields
  const fragments: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'kind' || UI_CHROME_FIELDS.has(key)) continue;
    if (typeof val === 'string' && val.length > 0) fragments.push(val);
  }
  return fragments.join('\n');
}

export type StreamEvent =
  | { type: 'user-message'; requestId: string; text: string; timestamp: number }
  | { type: 'assistant-message'; requestId: string; text: string; timestamp: number };

interface FileState {
  /** Absolute byte offset of the last successfully processed line. */
  offset: number;
  /** Total line count at last read (for bootstrap detection). */
  lineCount: number;
  /** Maps parser-index → requestId (populated as append events are seen). */
  indexToRequestId: Map<number, string>;
  /** Tracks accumulated assistant text per index for incremental patches. */
  accumulatedTextByIndex: Map<number, string>;
}

interface SessionState {
  sessionId: string;
  title: string;
  fileStates: Map<string, FileState>;
}

/**
 * Extract text from a whole response array.
 * Returns empty string if no readable text is found.
 */
function extractResponseText(response: unknown[]): string {
  if (!Array.isArray(response)) return '';
  const parts = response
    .map((p) => extractReadableText(p))
    .filter((t) => t.length > 0);
  return parts.join('\n');
}

/**
 * Given an index N in response patches, find the corresponding requestId.
 * For append events we track parserIndex→requestId directly.
 * For snapshot events, parserIndex starts at 0 and goes up by snapshot length.
 * We lazily compute this from the tracked snapshot size.
 */
function getRequestIdForIndex(state: SessionState, filePath: string, index: number): string | undefined {
  const fs2 = state.fileStates.get(filePath);
  return fs2?.indexToRequestId.get(index);
}

export class SessionMonitor {
  /** Tracks per-session state across polls. */
  private sessionState: SessionState = {
    sessionId: 'unknown',
    title: 'unknown',
    fileStates: new Map(),
  };

  /** Dedupe: requestIds whose user messages have already been sent. */
  private sentUserReqKeys = new Set<string>();

  /** Dedupe: requestId → latest assistant text already sent. */
  private lastSentAssistantByReqKey = new Map<string, string>();

  /** Last known target sessionId (for session-switch detection). */
  private lastTargetSessionId: string | undefined;

  /** Pending events to be drained in the next drainQueue call. */
  private pendingEvents: StreamEvent[] = [];

  constructor(
    private readonly sendFeishuText: (
      text: string,
      meta?: { role: 'user' | 'assistant' },
    ) => Promise<void>,
    private readonly onSessionSwitch?: (sessionId: string, title: string) => void,
  ) {}

  /**
   * Process new content from a JSONL file since last read.
   * Call this on every poll cycle.
   *
   * @param filePath  Absolute path to the .jsonl file
   * @param content  Full file content (we track offset internally)
   */
  async processFile(filePath: string, content: string): Promise<void> {
    const lines = content.split('\n').filter(Boolean);
    const totalLines = lines.length;

    let fileState = this.sessionState.fileStates.get(filePath);
    if (!fileState) {
      fileState = {
        offset: 0,
        lineCount: 0,
        indexToRequestId: new Map(),
        accumulatedTextByIndex: new Map(),
      };
      this.sessionState.fileStates.set(filePath, fileState);
    }

    // Detect bootstrap: if file was rotated/truncated, re-read from start.
    // Also bootstrap on first read (offset === 0).
    // On bootstrap: we rebuild index mapping but do NOT send messages from snapshots.
    // Incremental events (kind=2) are still sent normally since they represent new data.
    const isBootstrap = fileState.offset === 0 || totalLines < fileState.lineCount;
    if (isBootstrap) {
      fileState.offset = 0;
      fileState.indexToRequestId.clear();
      fileState.accumulatedTextByIndex.clear();
      console.log('[session-monitor] bootstrap: rebuilding index for', path.basename(filePath));
    }

    // Determine which lines to process
    let startLine = 0;
    if (!isBootstrap && fileState.offset > 0) {
      // Normal mode: find the line corresponding to the offset
      let currentOffset = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for newline
        if (currentOffset + lineLength > fileState.offset) {
          startLine = i;
          break;
        }
        currentOffset += lineLength;
      }
    }

    if (startLine >= totalLines) return; // No new lines

    const newLines = lines.slice(startLine);
    const parserIndexBase = fileState.indexToRequestId.size;

    // First pass: handle kind=0 snapshot to seed sessionId/title and initial requestId mapping
    for (let i = 0; i < newLines.length; i++) {
      const line = newLines[i];
      let entry: { kind?: number; k?: unknown; v?: unknown };
      try {
        entry = JSON.parse(line) as { kind?: number; k?: unknown; v?: unknown };
      } catch {
        continue;
      }

      if (entry.kind === 0 && entry.v && typeof entry.v === 'object') {
        const v = entry.v as Record<string, unknown>;
        const newSessionId = (v.sessionId as string) || this.sessionState.sessionId;
        const newTitle = (v.customTitle as string)?.trim() || this.sessionState.title;

        // Emit session switch when sessionId changes
        if (newSessionId && newSessionId !== this.lastTargetSessionId) {
          this.onSessionSwitch?.(newSessionId, newTitle);
        }
        this.lastTargetSessionId = newSessionId;

        this.sessionState.sessionId = newSessionId;
        this.sessionState.title = newTitle;

        // Build index mapping from snapshot requests.
        // During bootstrap: don't send messages from snapshot (they're history).
        // During normal polls: send messages from snapshot.
        const requests = v.requests as Array<{ requestId?: string; timestamp?: number; message?: { text?: string } }> | undefined;
        if (Array.isArray(requests)) {
          let idx = parserIndexBase;
          for (const req of requests) {
            if (req.requestId) {
              fileState.indexToRequestId.set(idx, req.requestId);

              if (!isBootstrap) {
                // Normal mode: emit user message for snapshot request
                const text = req.message?.text?.trim();
                if (text) {
                  const reqKey = req.requestId;
                  if (!this.sentUserReqKeys.has(reqKey)) {
                    this.sentUserReqKeys.add(reqKey);
                    this.pendingEvents.push({
                      type: 'user-message',
                      requestId: req.requestId,
                      text,
                      timestamp: req.timestamp ?? Date.now(),
                    });
                  }
                }
              }
            }
            idx++;
          }
        }
      }
    }

    // Second pass: emit events for each new line
    // During bootstrap: incremental events (kind=2) are still sent since they represent
    // new data that just appeared. Only snapshot data (kind=0) is suppressed above.
    for (let i = 0; i < newLines.length; i++) {
      const line = newLines[i];
      let entry: { kind?: number; k?: unknown[]; v?: unknown };
      try {
        entry = JSON.parse(line) as { kind?: number; k?: unknown[]; v?: unknown };
      } catch {
        continue;
      }

      // Skip non-request events (kind=1 global state patches, etc.)
      if (!Array.isArray(entry.k) || entry.k[0] !== 'requests') continue;

      // k: ['requests'] → append request(s)
      if (entry.k.length === 1 && Array.isArray(entry.v)) {
        const requests = entry.v as Array<{
          requestId?: string;
          timestamp?: number;
          message?: { text?: string };
        }>;
        for (const req of requests) {
          if (!req.requestId) continue;
          const idx = fileState.indexToRequestId.size;
          fileState.indexToRequestId.set(idx, req.requestId);

          const text = req.message?.text?.trim();
          if (!text) continue;

          const reqKey = req.requestId;
          if (!this.sentUserReqKeys.has(reqKey)) {
            this.sentUserReqKeys.add(reqKey);
            this.pendingEvents.push({
              type: 'user-message',
              requestId: req.requestId,
              text,
              timestamp: req.timestamp ?? Date.now(),
            });
          }
        }
        continue;
      }

      // k: ['requests', N, ...] → indexed patch for existing request
      if (entry.k.length < 3 || typeof entry.k[1] !== 'number') continue;

      const idx = entry.k[1] as number;
      const field = entry.k[2] as string;
      const subfield = entry.k[3] as string | undefined;
      const subsubfield = entry.k[4] as string | undefined;

      // Map index → requestId
      if (!fileState.indexToRequestId.has(idx)) {
        fileState.indexToRequestId.set(idx, `__idx_${idx}__`);
      }
      const requestId = fileState.indexToRequestId.get(idx) ?? `__idx_${idx}__`;
      const reqKey = requestId;

      // k: ['requests', N, 'response', undefined] → full response replacement
      // k: ['requests', N, 'response', M, 'value'] → incremental text patch
      if (field === 'response') {
        let text = '';

        if (subfield === undefined) {
          const newText = extractResponseText(entry.v as unknown[]);
          if (newText) {
            fileState.accumulatedTextByIndex.set(idx, newText);
            text = newText;
          }
        } else if (typeof subfield === 'number' && subsubfield === 'value') {
          const existing = fileState.accumulatedTextByIndex.get(idx) ?? '';
          const updated = typeof entry.v === 'string' ? existing + entry.v : existing;
          fileState.accumulatedTextByIndex.set(idx, updated);
          text = updated;
        } else if (subfield === 'value') {
          const existing = fileState.accumulatedTextByIndex.get(idx) ?? '';
          const updated = typeof entry.v === 'string' ? existing + entry.v : existing;
          fileState.accumulatedTextByIndex.set(idx, updated);
          text = updated;
        } else {
          const partText = extractReadableText(entry.v);
          if (partText) {
            fileState.accumulatedTextByIndex.set(idx, partText);
            text = partText;
          }
        }

        if (!text) continue;

        const lastSent = this.lastSentAssistantByReqKey.get(reqKey) ?? '';
        if (text !== lastSent) {
          this.lastSentAssistantByReqKey.set(reqKey, text);
          this.pendingEvents.push({
            type: 'assistant-message',
            requestId,
            text,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Update offset to the end of the file for next read
    fileState.offset = content.length;
    fileState.lineCount = totalLines;
  }

  /**
   * Drain all pending events to Feishu in FIFO order.
   * Call this after processFile returns.
   */
  async drainQueue(): Promise<void> {
    while (this.pendingEvents.length > 0) {
      const event = this.pendingEvents.shift()!;
      try {
        const role = event.type === 'user-message' ? 'user' : 'assistant';
        const prefix = event.type === 'user-message' ? '👤 ' : '🤖 ';
        await this.sendFeishuText(prefix + event.text, { role });
      } catch (err) {
        console.warn('[session-monitor] send failed, re-queueing:', err);
        this.pendingEvents.unshift(event);
        break;
      }
    }
  }

  getSessionId(): string {
    return this.sessionState.sessionId;
  }

  getTitle(): string {
    return this.sessionState.title;
  }
}
