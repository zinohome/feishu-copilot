import type { SessionSelectionMode, SessionSummary } from '../types';

export class ActiveSessionTracker {
  private readonly sessions = new Map<string, SessionSummary>();
  private mode: SessionSelectionMode = 'follow-latest';
  private lockedSessionId: string | undefined;

  upsert(summary: SessionSummary): void {
    this.sessions.set(summary.sessionId, summary);
  }

  listRecent(limit = 8): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((left, right) => right.lastUserMessageAt - left.lastUserMessageAt)
      .slice(0, limit);
  }

  lockToSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.mode = 'manual-lock';
    this.lockedSessionId = sessionId;
  }

  followLatest(): void {
    this.mode = 'follow-latest';
    this.lockedSessionId = undefined;
  }

  getMode(): SessionSelectionMode {
    return this.mode;
  }

  getCurrentTarget(): SessionSummary | undefined {
    if (this.mode === 'manual-lock' && this.lockedSessionId) {
      return this.sessions.get(this.lockedSessionId);
    }

    return [...this.sessions.values()].sort((left, right) => {
      if (right.lastUserMessageAt !== left.lastUserMessageAt) {
        return right.lastUserMessageAt - left.lastUserMessageAt;
      }
      return right.lastFileWriteAt - left.lastFileWriteAt;
    })[0];
  }
}
