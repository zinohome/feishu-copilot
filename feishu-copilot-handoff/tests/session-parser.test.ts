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

  it('extracts turns from modern event-log jsonl format', () => {
    const eventJsonl = [
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-100',
            timestamp: 123,
            message: { text: 'hello test' },
          },
        ],
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response'],
        v: [
          { kind: 'thinking', value: 'internal' },
          { value: 'final answer' },
        ],
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-event.jsonl', eventJsonl, 200);
    expect(summary.turns).toHaveLength(1);
    expect(summary.turns[0]).toEqual({
      requestId: 'req-100',
      userText: 'hello test',
      assistantText: 'internal\nfinal answer',
      timestamp: 123,
    });
  });

  it('merges snapshot-first jsonl with later request and response events', () => {
    const hybridJsonl = [
      JSON.stringify({
        kind: 0,
        v: {
          customTitle: 'Hybrid 会话',
          sessionId: 'session-hybrid',
          requests: [
            {
              requestId: 'req-1',
              timestamp: 100,
              message: { text: 'first question' },
              response: [{ kind: 'markdownContent', value: 'first answer' }],
            },
          ],
        },
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-2',
            timestamp: 200,
            message: { text: 'latest question' },
          },
        ],
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 1, 'response'],
        v: [
          { kind: 'thinking', value: 'internal' },
          { value: 'latest answer' },
        ],
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-hybrid.jsonl', hybridJsonl, 300);
    expect(summary.sessionId).toBe('session-hybrid');
    expect(summary.title).toBe('Hybrid 会话');
    expect(summary.turns).toHaveLength(2);
    expect(summary.turns[0]).toEqual({
      requestId: 'req-1',
      userText: 'first question',
      assistantText: 'first answer',
      timestamp: 100,
    });
    expect(summary.turns[1]).toEqual({
      requestId: 'req-2',
      userText: 'latest question',
      assistantText: 'internal\nlatest answer',
      timestamp: 200,
    });
    expect(summary.lastUserMessageAt).toBe(200);
    expect(summary.lastAssistantMessageAt).toBe(200);
  });

  it('rebinds appended requests when later response patches use absolute indexes', () => {
    const gapJsonl = [
      JSON.stringify({
        kind: 0,
        v: {
          customTitle: '错位复现',
          sessionId: 'session-gap',
          requests: [],
        },
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-8',
            timestamp: 200,
            message: { text: '是吗？' },
          },
        ],
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 7, 'response'],
        v: [
          { kind: 'thinking', value: 'internal' },
          { value: '当然。' },
        ],
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-gap.jsonl', gapJsonl, 300);
    expect(summary.sessionId).toBe('session-gap');
    expect(summary.title).toBe('错位复现');
    expect(summary.turns).toHaveLength(1);
    expect(summary.turns[0]).toEqual({
      requestId: 'req-8',
      userText: '是吗？',
      assistantText: 'internal\n当然。',
      timestamp: 200,
    });
    expect(summary.lastUserMessageAt).toBe(200);
    expect(summary.lastAssistantMessageAt).toBe(200);
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
