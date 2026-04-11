import { ActiveSessionTracker } from '../copilot/active-session-tracker';
import type { SessionSummary } from '../types';
import { renderMirroredTurn, renderSessionSwitch } from './feishu-renderer';

export interface BridgeControllerOptions {
  ownerOpenId: string;
  targetChatId: string;
  sendFeishuText: (chatId: string, text: string) => Promise<string>;
}

export class BridgeController {
  private readonly tracker = new ActiveSessionTracker();
  private lastMirroredRequestIdBySession = new Map<string, string>();
  private lastTargetSessionId: string | undefined;

  constructor(private readonly options: BridgeControllerOptions) {}

  async handleSessionUpdate(summary: SessionSummary): Promise<void> {
    this.tracker.upsert(summary);
    const currentTarget = this.tracker.getCurrentTarget();
    if (!currentTarget || currentTarget.sessionId !== summary.sessionId) {
      return;
    }

    if (this.lastTargetSessionId !== currentTarget.sessionId) {
      this.lastTargetSessionId = currentTarget.sessionId;
      await this.options.sendFeishuText(this.options.targetChatId, renderSessionSwitch(currentTarget));
    }

    const lastTurn = currentTarget.turns.at(-1);
    if (!lastTurn) {
      return;
    }

    const lastMirrored = this.lastMirroredRequestIdBySession.get(currentTarget.sessionId);
    if (lastMirrored === lastTurn.requestId) {
      return;
    }

    this.lastMirroredRequestIdBySession.set(currentTarget.sessionId, lastTurn.requestId);
    await this.options.sendFeishuText(this.options.targetChatId, renderMirroredTurn(currentTarget));
  }

  listRecentSessions(limit = 8): SessionSummary[] {
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
