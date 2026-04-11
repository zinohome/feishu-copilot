import { describe, expect, it } from 'vitest';
import { parseChatSessionJsonl } from '../src/copilot/session-parser';
import { ActiveSessionTracker } from '../src/copilot/active-session-tracker';

describe('parseChatSessionJsonl', () => {
  it('extracts user and assistant turns from the snapshot line', () => {
    const jsonl = [
      JSON.stringify({
        kind: 0,
        v: {
          customTitle: 'React 重构',
          sessionId: 'session-1',
          requests: [
            {
              requestId: 'req-1',
              timestamp: 100,
              message: { text: 'hello' },
              response: [{ kind: 'markdownContent', value: 'world' }],
            },
          ],
        },
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-1.jsonl', jsonl, 200);
    expect(summary.title).toBe('React 重构');
    expect(summary.turns[0]).toEqual({
      requestId: 'req-1',
      userText: 'hello',
      assistantText: 'world',
      timestamp: 100,
    });
  });
});

describe('ActiveSessionTracker', () => {
  it('follows newest user-driven session by default and supports manual lock', () => {
    const tracker = new ActiveSessionTracker();

    tracker.upsert({ sessionId: 'a', title: 'A', lastUserMessageAt: 10, lastAssistantMessageAt: 20, lastFileWriteAt: 20, turns: [] });
    tracker.upsert({ sessionId: 'b', title: 'B', lastUserMessageAt: 30, lastAssistantMessageAt: 40, lastFileWriteAt: 40, turns: [] });
    expect(tracker.getCurrentTarget()?.sessionId).toBe('b');

    tracker.lockToSession('a');
    tracker.upsert({ sessionId: 'b', title: 'B', lastUserMessageAt: 50, lastAssistantMessageAt: 60, lastFileWriteAt: 60, turns: [] });
    expect(tracker.getCurrentTarget()?.sessionId).toBe('a');

    tracker.followLatest();
    expect(tracker.getCurrentTarget()?.sessionId).toBe('b');
  });
});
