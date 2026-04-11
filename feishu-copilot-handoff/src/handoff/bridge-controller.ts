import { ActiveSessionTracker } from '../copilot/active-session-tracker';
import type { SessionSummary } from '../types';
import { renderMirroredTurn, renderSessionSwitch } from './feishu-renderer';

export interface BridgeControllerOptions {
  ownerOpenId: string;
  targetChatId?: string;
  maxMirroredSessions?: number;
  sendFeishuText: (chatId: string, text: string) => Promise<string>;
}

export class BridgeController {
  private readonly tracker = new ActiveSessionTracker();
  private lastMirroredSignatureBySession = new Map<string, string>();
  private lastTargetSessionId: string | undefined;
  private targetChatId: string | undefined;

  constructor(private readonly options: BridgeControllerOptions) {
    this.targetChatId = options.targetChatId?.trim() || undefined;
  }

  setTargetChatId(chatId: string): void {
    const trimmed = chatId.trim();
    this.targetChatId = trimmed || undefined;
  }

  async handleSessionUpdate(summary: SessionSummary): Promise<void> {
    this.tracker.upsert(summary);
    const currentTarget = this.tracker.getCurrentTarget();
    if (!currentTarget || currentTarget.sessionId !== summary.sessionId || !this.targetChatId) {
      return;
    }

    if (this.lastTargetSessionId !== currentTarget.sessionId) {
      this.lastTargetSessionId = currentTarget.sessionId;
      await this.options.sendFeishuText(this.targetChatId, renderSessionSwitch(currentTarget));
    }

    const lastTurn = currentTarget.turns.at(-1);
    if (!lastTurn) {
      return;
    }

    const signature = `${lastTurn.requestId}:${lastTurn.userText}:${lastTurn.assistantText}`;
    const lastMirrored = this.lastMirroredSignatureBySession.get(currentTarget.sessionId);
    if (lastMirrored === signature) {
      return;
    }

    this.lastMirroredSignatureBySession.set(currentTarget.sessionId, signature);
    await this.options.sendFeishuText(this.targetChatId, renderMirroredTurn(currentTarget));
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
    return undefined;
  }
}
