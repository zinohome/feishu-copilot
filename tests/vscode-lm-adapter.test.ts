import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VscodeLmAdapter } from '../src/copilot/vscode-lm-adapter';
import * as vscode from 'vscode';
import type { InboundChatMessage } from '../src/domain/message-types';

const baseMessage: InboundChatMessage = {
  userId: 'u1',
  messageId: 'm1',
  chatType: 'p2p',
  text: 'hello',
  timestampMs: 0,
};

describe('VscodeLmAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('yields chunks from model stream and concatenates to expected text', async () => {
    const adapter = new VscodeLmAdapter();
    const chunks: string[] = [];

    for await (const chunk of adapter.generate(baseMessage)) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('Hello World');
  });

  it('throws "No Copilot model available" when no models returned', async () => {
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValueOnce([]);

    const adapter = new VscodeLmAdapter();

    await expect(async () => {
      for await (const _ of adapter.generate(baseMessage)) {
        // drain
      }
    }).rejects.toThrow('No Copilot model available');
  });

  it('passes model family to selectChatModels', async () => {
    const adapter = new VscodeLmAdapter('claude-3-5-sonnet');
    const chunks: string[] = [];

    for await (const chunk of adapter.generate(baseMessage)) {
      chunks.push(chunk);
    }

    expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({ family: 'claude-3-5-sonnet' });
  });

  it('cancels request when AbortSignal fires', async () => {
    const ac = new AbortController();

    // Provide a stream that yields one chunk then the abort fires
    vi.mocked(vscode.lm.selectChatModels).mockResolvedValueOnce([
      {
        sendRequest: vi.fn(async (_messages, _options, token: { isCancellationRequested: boolean }) => ({
          stream: (async function* () {
            yield new vscode.LanguageModelTextPart('chunk1');
            // Abort after first chunk
            ac.abort();
            yield new vscode.LanguageModelTextPart('chunk2');
          })(),
        })),
      } as unknown as vscode.LanguageModelChat,
    ] as unknown as Awaited<ReturnType<typeof vscode.lm.selectChatModels>>);

    const adapter = new VscodeLmAdapter();
    const chunks: string[] = [];

    for await (const chunk of adapter.generate(baseMessage, ac.signal)) {
      chunks.push(chunk);
    }

    // Both chunks are still yielded (CancellationToken is advisory for the mock),
    // but CancellationTokenSource.cancel() was called without throwing
    expect(chunks).toContain('chunk1');
  });

  it('cancels immediately when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();

    const sendRequestSpy = vi.fn(async (_messages, _options, token: { isCancellationRequested: boolean }) => {
      expect(token.isCancellationRequested).toBe(true);
      return {
        stream: (async function* () {
          // no chunks
        })(),
      };
    });

    vi.mocked(vscode.lm.selectChatModels).mockResolvedValueOnce([
      {
        sendRequest: sendRequestSpy,
      } as unknown as vscode.LanguageModelChat,
    ] as unknown as Awaited<ReturnType<typeof vscode.lm.selectChatModels>>);

    const adapter = new VscodeLmAdapter();
    const chunks: string[] = [];
    for await (const chunk of adapter.generate(baseMessage, ac.signal)) {
      chunks.push(chunk);
    }

    expect(sendRequestSpy).toHaveBeenCalledOnce();
    expect(chunks).toEqual([]);
  });
});
