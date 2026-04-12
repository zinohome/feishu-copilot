/**
 * SessionMonitor — streams Copilot chat session events from a JSONL file.
 *
 * Architecture:
 *   - Monitors the file as a tail-f would: tracks processed line count,
 *     reads only new content on each poll.
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

/** Maximum age for a message to be considered valid for Feishu handoff (30 minutes). */
const MAX_AGE_MS = 30 * 60 * 1000;

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
  'undoStop',
  'codeblockUri',
  'questionCarousel',
  'workspaceEdit',
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
  
  const obj = part as Record<string, unknown>;
  const kind = obj.kind as string | undefined;

  // 1. Explicitly ignore metadata kinds
  if (kind && METADATA_KINDS.has(kind)) {
    // Special case: toolInvocationSerialized has a visible message
    if (kind === 'toolInvocationSerialized' && typeof obj.invocationMessage === 'object') {
      const inv = obj.invocationMessage as { value?: string };
      if (inv.value) return `[[NOTE]]正在运行：${inv.value}[[/NOTE]]`;
    }
    return '';
  }

  // 2. Direct string value (most common for markdownContent or plain parts)
  if (typeof obj.value === 'string' && obj.value.length > 0) {
    return obj.value;
  }

  // 3. Fallback: only collect specific known text fields, NOT a generic loop
  if (typeof obj.text === 'string' && obj.text.length > 0) return obj.text;
  if (typeof obj.markdown === 'string' && obj.markdown.length > 0) return obj.markdown;

  return '';
}

export type StreamEvent =
  | { type: 'user-message'; requestId: string; text: string; timestamp: number }
  | { type: 'assistant-message'; requestId: string; text: string; timestamp: number };

interface FileState {
  /** Number of non-empty lines already processed from this file. */
  processedLines: number;
  /** Maps parser-index → requestId (populated as append events are seen). */
  indexToRequestId: Map<number, string>;
  /** Tracks accumulated assistant parts per index for incremental patches. */
  accumulatedPartsByIndex: Map<number, Map<number, string>>;
  /** Tracks the merged assistant text per index. */
  mergedTextByIndex: Map<number, string>;
  /** Tracks timestamp per requestId to filter out old assistant patches. */
  requestTimestamps: Map<string, number>;
  /** Tracks user query per requestId to avoid echoing it back as assistant text. */
  accumulatedUserTextByReqId: Map<string, string>;
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
  return parts.join('\n\n');
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

  /** Tracks messageId sent to Feishu for each requestId (enabling PATCH updates). */
  private feishuMessageIds = new Map<string, string>();

  constructor(
    private readonly sendFeishuMessage: (
      text: string,
      meta?: { role: 'user' | 'assistant' },
    ) => Promise<string | undefined>,
    private readonly updateFeishuMessage: (
      messageId: string,
      text: string,
      meta?: { role: 'user' | 'assistant' },
    ) => Promise<void>,
    private readonly onSessionSwitch?: (sessionId: string, title: string) => void,
    private readonly isTestMode: boolean = false,
    private readonly logger?: (msg: string) => void,
  ) {}

  private log(msg: string): void {
    if (this.logger) this.logger(msg);
    else console.log(msg);
  }

  /**
   * Process new content from a JSONL file since last read.
   * Call this on every poll cycle.
   *
   * Uses line-count based tracking: we remember the number of non-empty
   * lines already processed so the next poll starts exactly where we left
   * off.  This avoids the byte-offset mismatch bug caused by
   * content.split('\n').filter(Boolean) discarding empty lines.
   *
   * On bootstrap (first read or file truncation): we scan ALL lines to
   * build internal index/state mappings but do NOT enqueue any messages.
   * This prevents historical chat records from flooding Feishu on every
   * extension restart.
   *
   * @param filePath  Absolute path to the .jsonl file
   * @param content  Full file content (we track line count internally)
   */
  async processFile(filePath: string, content: string): Promise<void> {
    const lines = content.split('\n').filter(Boolean);
    const totalLines = lines.length;

    let fileState = this.sessionState.fileStates.get(filePath);
    if (!fileState) {
      fileState = {
        processedLines: 0,
        indexToRequestId: new Map(),
        accumulatedPartsByIndex: new Map(),
        mergedTextByIndex: new Map(),
        requestTimestamps: new Map(),
        accumulatedUserTextByReqId: new Map(),
      };
      this.sessionState.fileStates.set(filePath, fileState);
    }

    // Detect bootstrap: first read OR file was rotated/truncated.
    const isBootstrap = fileState.processedLines === 0 || totalLines < fileState.processedLines;
    if (isBootstrap) {
      fileState.processedLines = 0;
      fileState.indexToRequestId.clear();
      fileState.accumulatedPartsByIndex.clear();
      fileState.mergedTextByIndex.clear();
      fileState.requestTimestamps.clear();
      fileState.accumulatedUserTextByReqId.clear();
      console.log('[session-monitor] bootstrap: rebuilding index for', path.basename(filePath));
    }

    // Determine which lines to process.
    // Bootstrap: start from 0 to scan everything for state building.
    // Normal:    start from processedLines to read only new lines.
    const startLine = isBootstrap ? 0 : fileState.processedLines;

    // No new lines — nothing to do.
    if (startLine >= totalLines) return;

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
        const requests = v.requests as Array<{ requestId?: string; timestamp?: number; message?: { text?: string }; response?: unknown[] }> | undefined;
        if (Array.isArray(requests)) {
          let idx = parserIndexBase;
          for (const req of requests) {
            const rId = req.requestId;
            if (rId) {
              fileState.indexToRequestId.set(idx, rId);
              const ts = req.timestamp ?? Date.now();
              fileState.requestTimestamps.set(rId, ts);
              if (req.message?.text) {
                fileState.accumulatedUserTextByReqId.set(rId, req.message.text.trim());
              }

              const isOld = ts < Date.now() - MAX_AGE_MS;
              const skipMsg = (!this.isTestMode && isBootstrap) || isOld;
              if (skipMsg) {
                // Bootstrap or too old: mark as already-sent so subsequent polls
                // won't re-send historical messages.
                this.sentUserReqKeys.add(rId);
              } else {
                // Normal mode: emit user message for snapshot request
                const text = req.message?.text?.trim();
                if (text) {
                  if (!this.sentUserReqKeys.has(rId)) {
                    this.sentUserReqKeys.add(rId);
                    this.pendingEvents.push({
                      type: 'user-message',
                      requestId: rId,
                      text,
                      timestamp: ts,
                    });
                  }
                }
              }

              // Extract inline response from snapshot request if present
              if (Array.isArray(req.response) && req.response.length > 0) {
                const inlineText = extractResponseText(req.response);
                if (inlineText) {
                  fileState.mergedTextByIndex.set(idx, inlineText);
                  const partsMap = new Map<number, string>();
                  req.response.forEach((p, pi) => {
                    const pt = extractReadableText(p);
                    if (pt) partsMap.set(pi, pt);
                  });
                  fileState.accumulatedPartsByIndex.set(idx, partsMap);

                  if (skipMsg) {
                    this.lastSentAssistantByReqKey.set(rId, inlineText);
                  }
                  // Non-skip snapshot responses will be emitted by the second pass
                  // via k:["requests", N, "response"] patches if present.
                }
              }
            }
            idx++;
          }
        }
      }
    }

    // Second pass: emit events for each new line.
    // During bootstrap: we only build index/state mappings — NO messages
    // are enqueued.
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
          response?: unknown[];
        }>;
        for (const req of requests) {
          const idx = fileState.indexToRequestId.size;
          const rId = req.requestId;
          if (!rId) continue;

          const placeholder = `__idx_${idx}__`;
          if (fileState.indexToRequestId.get(idx) === placeholder) {
            console.log(`[session-monitor] migrating state from ${placeholder} to ${rId}`);
            this.migrateIdState(placeholder, rId);
          }
          fileState.indexToRequestId.set(idx, rId);

          const ts = req.timestamp ?? Date.now();
          fileState.requestTimestamps.set(rId, ts);
          if (req.message?.text) {
            fileState.accumulatedUserTextByReqId.set(rId, req.message.text.trim());
          }

          const isOld = ts < Date.now() - MAX_AGE_MS;
          const skipMsg = (!this.isTestMode && isBootstrap) || isOld;

          // --- Enqueue user message ---
          if (skipMsg) {
            this.sentUserReqKeys.add(rId);
          } else {
            const text = req.message?.text?.trim();
            if (text && !this.sentUserReqKeys.has(rId)) {
              this.sentUserReqKeys.add(rId);
              this.pendingEvents.push({
                type: 'user-message',
                requestId: rId,
                text,
                timestamp: ts,
              });
            }
          }

          // --- Extract inline response if present ---
          if (Array.isArray(req.response) && req.response.length > 0) {
            const inlineText = extractResponseText(req.response);
            if (inlineText) {
              fileState.mergedTextByIndex.set(idx, inlineText);
              // Populate parts map for consistency
              const partsMap = new Map<number, string>();
              req.response.forEach((p, pi) => {
                const pt = extractReadableText(p);
                if (pt) partsMap.set(pi, pt);
              });
              fileState.accumulatedPartsByIndex.set(idx, partsMap);

              // Sanitize text (same as the response patch handler below)
              let sanitized = inlineText
                .replace(/\\\[(.*?)\\\]/gs, '$1')
                .replace(/\\\((.*?)\\\)/gs, '$1')
                .replace(/\$+(.*?)\$+/gs, '$1')
                .replace(/\\overline\{(.*?)\}/g, '$1')
                .replace(/\[([^\]]+)\]\((file|vscode):[^\)]+\)/g, '$1 (local file)');

              // Skip echo
              const userQuery = fileState.accumulatedUserTextByReqId.get(rId);
              if (sanitized === userQuery) {
                console.log(`[session-monitor] skipping inline assistant text echo for ${rId}`);
              } else if (skipMsg) {
                this.lastSentAssistantByReqKey.set(rId, sanitized);
              } else {
                const lastSent = this.lastSentAssistantByReqKey.get(rId) ?? '';
                if (sanitized !== lastSent) {
                  this.lastSentAssistantByReqKey.set(rId, sanitized);
                  this.pendingEvents.push({
                    type: 'assistant-message',
                    requestId: rId,
                    text: sanitized,
                    timestamp: Date.now(),
                  });
                  console.log(`[session-monitor] enqueued INLINE assistant response for ${rId}, len=${sanitized.length}`);
                }
              }
            }
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
      let requestId = fileState.indexToRequestId.get(idx);
      if (!requestId) {
        requestId = `__idx_${idx}__`;
        fileState.indexToRequestId.set(idx, requestId);
      }
      const reqKey = requestId;

      // k: ['requests', N, 'response', ...] → response data
      if (field === 'response') {
        let text = '';

        if (subfield === undefined) {
          // Whole response array update
          const newText = extractResponseText(entry.v as unknown[]);
          if (newText) {
            fileState.mergedTextByIndex.set(idx, newText);
            // Also reset/populate parts map for consistency
            const partsMap = new Map<number, string>();
            if (Array.isArray(entry.v)) {
              entry.v.forEach((p, i) => {
                const pt = extractReadableText(p);
                if (pt) partsMap.set(i, pt);
              });
            }
            fileState.accumulatedPartsByIndex.set(idx, partsMap);
            text = newText;
          }
        } else if (typeof subfield === 'number') {
          // Update to a specific part
          let partsMap = fileState.accumulatedPartsByIndex.get(idx);
          if (!partsMap) {
            partsMap = new Map<number, string>();
            fileState.accumulatedPartsByIndex.set(idx, partsMap);
          }

          if (subsubfield === 'value') {
            // Incremental string patch to value field of this part
            const existingPart = partsMap.get(subfield) ?? '';
            const updatedPart = typeof entry.v === 'string' ? existingPart + entry.v : existingPart;
            partsMap.set(subfield, updatedPart);
          } else if (subsubfield === undefined) {
            // Whole part object replacement
            const pt = extractReadableText(entry.v);
            partsMap.set(subfield, pt);
          }
          // Other subsubfields (kind, invocationMessage, etc.) are only handled via the whole-part path above

          // Re-merge all parts for this request
          const sortedParts = Array.from(partsMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([, v]) => v)
            .filter(Boolean);
          
          text = sortedParts.join('\n\n');
          fileState.mergedTextByIndex.set(idx, text);
        } else if (subfield === 'value') {
          // Legacy/Fallback: direct value patch on the whole response (rare in modern logs)
          const existing = fileState.mergedTextByIndex.get(idx) ?? '';
          const updated = typeof entry.v === 'string' ? existing + entry.v : existing;
          fileState.mergedTextByIndex.set(idx, updated);
          text = updated;
        }

        if (!text) continue;

        // Strip LaTeX math delimiters and local non-HTTP URLs that Feishu card markdown rejects
        text = text
          .replace(/\\\[(.*?)\\\]/gs, '$1')
          .replace(/\\\((.*?)\\\)/gs, '$1')
          .replace(/\$+(.*?)\$+/gs, '$1')
          .replace(/\\overline\{(.*?)\}/g, '$1')
          .replace(/\[([^\]]+)\]\((file|vscode):[^\)]+\)/g, '$1 (local file)');

        // HEURISTIC: Skip if assistant text is identical to user query (echo bug)
        const userQuery = fileState.accumulatedUserTextByReqId.get(requestId);
        if (text === userQuery) {
          console.log(`[session-monitor] skipping assistant text echo of user query for ${requestId}`);
          continue;
        }

        // Retrieve the timestamp we recorded for this request
        const reqTs = fileState.requestTimestamps.get(requestId) ?? Date.now();
        const isOld = reqTs < Date.now() - MAX_AGE_MS;
        const skipMsg = (!this.isTestMode && isBootstrap) || isOld;

        if (skipMsg) {
          this.lastSentAssistantByReqKey.set(reqKey, text);
          continue;
        }

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

    // Advance the processed line count so the next poll starts after
    // the last line we just handled.  This is simple and reliable —
    // immune to the empty-line filtering byte-offset mismatch.
    fileState.processedLines = totalLines;
  }

  /**
   * Drain all pending events to Feishu in FIFO order.
   * Call this after processFile returns.
   *
   * Before draining, we stable-sort events so that for each requestId
   * the user-message always precedes any assistant-message.  This
   * eliminates race-conditions where a RESP_PATCH for request N arrives
   * in the same poll cycle as an APPEND for request N+1, causing
   * the assistant reply to appear before the user question in Feishu.
   */
  async drainQueue(): Promise<void> {
    // Stable sort: keep overall insertion order, but within the same
    // requestId push user-message before assistant-message.
    if (this.pendingEvents.length > 1) {
      const indexed = this.pendingEvents.map((e, i) => ({ e, i }));
      indexed.sort((a, b) => {
        if (a.e.requestId === b.e.requestId) {
          const aOrder = a.e.type === 'user-message' ? 0 : 1;
          const bOrder = b.e.type === 'user-message' ? 0 : 1;
          if (aOrder !== bOrder) return aOrder - bOrder;
        }
        return a.i - b.i; // preserve original insertion order otherwise
      });
      this.pendingEvents = indexed.map(x => x.e);
    }

    while (this.pendingEvents.length > 0) {
      const event = this.pendingEvents.shift()!;
      try {
        const role = event.type === 'user-message' ? 'user' : 'assistant';
        const msgKey = `${event.type}:${event.requestId}`;
        const existingMsgId = this.feishuMessageIds.get(msgKey);

        if (existingMsgId) {
          await this.updateFeishuMessage(existingMsgId, event.text, { role });
        } else {
          const msgId = await this.sendFeishuMessage(event.text, { role });
          if (msgId) {
            this.feishuMessageIds.set(msgKey, msgId);
          }
        }
      } catch (err) {
        console.warn('[session-monitor] send/update failed, re-queueing:', err);
        this.pendingEvents.unshift(event);
        break; // Stop draining, try again next tick
      }
    }
  }

  private migrateIdState(oldId: string, newId: string): void {
    // 1. Migrate user sent state
    if (this.sentUserReqKeys.has(oldId)) {
      this.sentUserReqKeys.delete(oldId);
      this.sentUserReqKeys.add(newId);
    }

    // 2. Migrate assistant text state
    const lastText = this.lastSentAssistantByReqKey.get(oldId);
    if (lastText !== undefined) {
      this.lastSentAssistantByReqKey.delete(oldId);
      this.lastSentAssistantByReqKey.set(newId, lastText);
    }

    // 3. Migrate Feishu message IDs (VERY IMPORTANT for PATCH)
    const userMsgKey = `user-message:${oldId}`;
    const newUserMsgKey = `user-message:${newId}`;
    const existingUserMsgId = this.feishuMessageIds.get(userMsgKey);
    if (existingUserMsgId) {
      this.feishuMessageIds.delete(userMsgKey);
      this.feishuMessageIds.set(newUserMsgKey, existingUserMsgId);
    }

    const assistantMsgKey = `assistant-message:${oldId}`;
    const newAssistantMsgKey = `assistant-message:${newId}`;
    const existingAssistantMsgId = this.feishuMessageIds.get(assistantMsgKey);
    if (existingAssistantMsgId) {
      this.feishuMessageIds.delete(assistantMsgKey);
      this.feishuMessageIds.set(newAssistantMsgKey, existingAssistantMsgId);
    }
  }

  getSessionId(): string {
    return this.sessionState.sessionId;
  }

  getTitle(): string {
    return this.sessionState.title;
  }
}
