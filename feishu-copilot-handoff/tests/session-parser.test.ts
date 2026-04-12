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
      assistantText: 'final answer',
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
      assistantText: 'latest answer',
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
      assistantText: '当然。',
      timestamp: 200,
    });
    expect(summary.lastUserMessageAt).toBe(200);
    expect(summary.lastAssistantMessageAt).toBe(200);
  });

  it('updates assistant text from indexed response-part patches', () => {
    const indexedJsonl = [
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-idx',
            timestamp: 333,
            message: { text: 'question' },
          },
        ],
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response', 0],
        v: { kind: 'markdownContent', value: 'first chunk' },
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response', 1, 'value'],
        v: 'second chunk',
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-indexed.jsonl', indexedJsonl, 400);
    expect(summary.turns).toHaveLength(1);
    expect(summary.turns[0]).toEqual({
      requestId: 'req-idx',
      userText: 'question',
      assistantText: 'first chunk\nsecond chunk',
      timestamp: 333,
    });
  });

  it('rebinds when response absolute index arrives before append request event', () => {
    const responseFirstJsonl = [
      JSON.stringify({
        kind: 2,
        k: ['requests', 233, 'response'],
        v: [{ kind: 'markdownContent', value: 'late mapped answer' }],
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-late-bind',
            timestamp: 444,
            message: { text: 'late mapped question' },
          },
        ],
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-response-first.jsonl', responseFirstJsonl, 500);
    expect(summary.turns).toHaveLength(1);
    expect(summary.turns[0]).toEqual({
      requestId: 'req-late-bind',
      userText: 'late mapped question',
      assistantText: 'late mapped answer',
      timestamp: 444,
    });
  });

  it('filters out metadata response parts and preserves readable text', () => {
    const metadataJsonl = [
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-meta',
            timestamp: 555,
            message: { text: 'show me the code' },
          },
        ],
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response'],
        v: [
          { kind: 'thinking', value: 'internal reasoning' },
          { value: 'Here is the code:' },
          { kind: 'toolInvocationSerialized', invocationMessage: 'apply patch', isComplete: true },
          { kind: 'markdownContent', value: '```js\nconsole.log("hello")\n```' },
        ],
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-metadata.jsonl', metadataJsonl, 600);
    expect(summary.turns).toHaveLength(1);
    expect(summary.turns[0].assistantText).toBe('Here is the code:\n```js\nconsole.log("hello")\n```');
  });

  it('does not overwrite readable assistant text with metadata-only response', () => {
    const overwriteJsonl = [
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'req-overwrite',
            timestamp: 666,
            message: { text: 'hello' },
          },
        ],
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response'],
        v: [
          { value: 'readable answer' },
        ],
      }),
      // A later response event replaces the entire response with metadata only
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response'],
        v: [
          { kind: 'progressTaskSerialized', title: '已压缩对话', completed: false },
        ],
      }),
    ].join('\n');

    const summary = parseChatSessionJsonl('session-overwrite.jsonl', overwriteJsonl, 700);
    expect(summary.turns).toHaveLength(1);
    // The metadata-only response should NOT overwrite the readable text
    expect(summary.turns[0].assistantText).toBe('readable answer');
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
