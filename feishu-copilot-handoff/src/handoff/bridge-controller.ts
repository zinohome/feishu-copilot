import { ActiveSessionTracker } from '../copilot/active-session-tracker';
import type { SessionSummary } from '../types';
import { renderAssistantMessage, renderSessionSwitch, renderUserMessage } from './feishu-renderer';

type OutboundEventType = 'session-switch' | 'user-message' | 'assistant-message';
type OutboundRole = 'system' | 'user' | 'assistant';

interface OutboundEvent {
  id: string;
  sessionId: string;
  reqKey?: string;
  type: OutboundEventType;
  role: OutboundRole;
  payload: string;
}

const BOOTSTRAP_TAIL_WINDOW = 12;

export interface BridgeControllerOptions {
  ownerOpenId: string;
  targetChatId?: string;
  maxMirroredSessions?: number;
  sendFeishuText: (chatId: string, text: string) => Promise<string>;
}

export class BridgeController {
  private readonly tracker = new ActiveSessionTracker();
  private sentUserReqKeys = new Set<string>();
  private lastSentAssistantByReqKey = new Map<string, string>();
  private pendingRemoteUserTexts = new Map<string, number>();
  private processedTurnCountBySession = new Map<string, number>();
  private outboundQueue: OutboundEvent[] = [];
  private queuedEventIds = new Set<string>();
  private queueDraining = false;
  private lastTargetSessionId: string | undefined;
  private targetChatId: string | undefined;

  constructor(private readonly options: BridgeControllerOptions) {
    this.targetChatId = options.targetChatId?.trim() || undefined;
  }

  setTargetChatId(chatId: string): void {
    const trimmed = chatId.trim();
    this.targetChatId = trimmed || undefined;
  }

  private normalizeUserText(text: string): string {
    return text.replace(/\r\n/g, '\n').trim();
  }

  private markRemoteUserText(text: string): void {
    const normalized = this.normalizeUserText(text);
    if (!normalized) {
      return;
    }
    this.pendingRemoteUserTexts.set(normalized, (this.pendingRemoteUserTexts.get(normalized) ?? 0) + 1);
  }

  private consumeRemoteUserText(text: string): boolean {
    const normalized = this.normalizeUserText(text);
    if (!normalized) {
      return false;
    }
    const count = this.pendingRemoteUserTexts.get(normalized) ?? 0;
    if (count <= 0) {
      return false;
    }
    if (count === 1) {
      this.pendingRemoteUserTexts.delete(normalized);
    } else {
      this.pendingRemoteUserTexts.set(normalized, count - 1);
    }
    return true;
  }

  private enqueueEvent(event: OutboundEvent): void {
    if (this.queuedEventIds.has(event.id)) {
      return;
    }

    // Keep only the latest unsent assistant event for the same request.
    if (event.type === 'assistant-message' && event.reqKey) {
      const staleIds: string[] = [];
      this.outboundQueue = this.outboundQueue.filter((queued) => {
        const keep = !(queued.type === 'assistant-message' && queued.reqKey === event.reqKey);
        if (!keep) {
          staleIds.push(queued.id);
        }
        return keep;
      });
      for (const staleId of staleIds) {
        this.queuedEventIds.delete(staleId);
      }
    }

    this.outboundQueue.push(event);
    this.queuedEventIds.add(event.id);
  }

  private async drainQueue(): Promise<void> {
    if (this.queueDraining || !this.targetChatId) {
      return;
    }

    this.queueDraining = true;
    try {
      while (this.outboundQueue.length > 0) {
        const event = this.outboundQueue[0];

        try {
          await this.options.sendFeishuText(this.targetChatId, event.payload);

          // Ack event only after successful send.
          if (event.type === 'user-message' && event.reqKey) {
            this.sentUserReqKeys.add(event.reqKey);
          }
          if (event.type === 'assistant-message' && event.reqKey) {
            this.lastSentAssistantByReqKey.set(event.reqKey, event.payload);
          }

          this.outboundQueue.shift();
          this.queuedEventIds.delete(event.id);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn('[bridge-controller] outbound send failed, will retry:', event.type, errMsg);
          break;
        }
      }
    } finally {
      this.queueDraining = false;
    }
  }

  async handleSessionUpdate(summary: SessionSummary): Promise<void> {
    this.tracker.upsert(summary);
    const currentTarget = this.tracker.getCurrentTarget();
    const skipReason = !currentTarget
      ? 'no current target'
      : currentTarget.sessionId !== summary.sessionId
      ? `session mismatch: ${currentTarget.sessionId} !== ${summary.sessionId}`
      : !this.targetChatId
      ? 'targetChatId not set'
      : undefined;
    
    if (skipReason) {
      console.log('[bridge-controller] handleSessionUpdate skipped:', skipReason);
      return;
    }

    // After skipReason check, currentTarget is definitely defined
    const target = currentTarget!;
    
    console.log('[bridge-controller] handleSessionUpdate:', {
      sessionId: target.sessionId,
      title: target.title,
      turns: target.turns.length,
      targetChatId: this.targetChatId,
    });

    if (this.lastTargetSessionId !== target.sessionId) {
      this.lastTargetSessionId = target.sessionId;
      console.log('[bridge-controller] session switched, sending switch message');
      this.enqueueEvent({
        id: `switch:${target.sessionId}`,
        sessionId: target.sessionId,
        type: 'session-switch',
        role: 'system',
        payload: renderSessionSwitch(target),
      });
    }

    if (target.turns.length === 0) {
      return;
    }

    let processedCount = this.processedTurnCountBySession.get(target.sessionId);
    if (processedCount === undefined) {
      // On fresh start/reconnect, replay a recent tail window so delayed assistant
      // replies on earlier turns are not missed.
      processedCount = Math.max(0, target.turns.length - BOOTSTRAP_TAIL_WINDOW);
    }
    const startIndex = Math.max(0, processedCount - 1);
    const pendingTurns = target.turns.slice(startIndex);

    for (const turn of pendingTurns) {
      const reqKey = `${target.sessionId}:${turn.requestId}`;

      // Send user message when a new request arrives
      if (!this.sentUserReqKeys.has(reqKey) && turn.userText) {
        if (this.consumeRemoteUserText(turn.userText)) {
          // This user text was submitted from Feishu already, so avoid echoing it back.
          this.sentUserReqKeys.add(reqKey);
        } else {
          console.log('[bridge-controller] sending user message for requestId:', turn.requestId);
          this.enqueueEvent({
            id: `user:${reqKey}`,
            sessionId: target.sessionId,
            reqKey,
            type: 'user-message',
            role: 'user',
            payload: renderUserMessage(turn),
          });
        }
      }

      // Send assistant reply when content arrives or changes
      const lastAssistantText = this.lastSentAssistantByReqKey.get(reqKey) ?? '';
      if (turn.assistantText && turn.assistantText !== lastAssistantText) {
        const assistantSig = `${turn.requestId}:${turn.assistantText}`;
        console.log('[bridge-controller] sending assistant reply, sig:', assistantSig.slice(0, 60));
        this.enqueueEvent({
          id: `assistant:${reqKey}:${turn.assistantText}`,
          sessionId: target.sessionId,
          reqKey,
          type: 'assistant-message',
          role: 'assistant',
          payload: renderAssistantMessage(turn),
        });
      }
    }

    this.processedTurnCountBySession.set(target.sessionId, target.turns.length);
    await this.drainQueue();
  }

  listRecentSessions(limit = this.options.maxMirroredSessions ?? 8): SessionSummary[] {
    return this.tracker.listRecent(limit);
  }

  lockSession(sessionId: string): void {
    this.tracker.lockToSession(sessionId);
  }

  followLatest(): void {
    this.tracker.followLatest();
  }

  renderSessionsList(): string {
    return this.listRecentSessions()
      .map((session, index) => `${index + 1}. ${session.title}`)
      .join('\n');
  }

  switchByIndex(index: number): void {
    const target = this.listRecentSessions()[index - 1];
    if (!target) {
      throw new Error(`Unknown session index: ${index}`);
    }
    this.lockSession(target.sessionId);
  }

  getStatusText(): string {
    const target = this.tracker.getCurrentTarget();
    return [
      `mode: ${this.tracker.getMode()}`,
      `session: ${target?.title ?? 'none'}`,
      `targetChatId: ${this.targetChatId ?? 'auto-pending'}`,
    ].join('\n');
  }

  async handleFeishuText(
    text: string,
    submitToChat: (text: string) => Promise<void>,
  ): Promise<string | undefined> {
    const trimmed = text.trim();
    if (trimmed === '/sessions') {
      return this.renderSessionsList();
    }

    if (trimmed === '/follow-latest') {
      this.followLatest();
      return this.getStatusText();
    }

    if (trimmed === '/status') {
      return this.getStatusText();
    }

    const match = /^\/switch\s+(\d+)$/.exec(trimmed);
    if (match) {
      this.switchByIndex(Number(match[1]));
      return this.getStatusText();
    }

    await submitToChat(text);
    this.markRemoteUserText(text);
    return undefined;
  }
}
