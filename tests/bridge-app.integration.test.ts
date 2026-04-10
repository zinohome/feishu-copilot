import { describe, expect, it } from 'vitest';
import { BridgeApp } from '../src/app/bridge-app';
import type { CopilotAdapter } from '../src/copilot/copilot-adapter';

describe('BridgeApp integration', () => {
  it('composes finalText from copilot stream chunks', async () => {
    const copilot: CopilotAdapter = {
      async *generate() {
        yield 'part-1';
        yield 'part-2';
        yield 'done';
      },
    };

    const app = new BridgeApp(copilot);
    const result = await app.handleMessage({
      userId: 'u-1',
      messageId: 'm-1',
      chatType: 'p2p',
      text: 'hello',
      timestampMs: 1712726400000,
    });

    expect(result.finalState).toBe('done');
    expect(result.finalText).toBe('part-1part-2done');
  });

  it('returns interrupted state when request is cancelled', async () => {
    const copilot: CopilotAdapter = {
      async *generate() {
        yield 'unused';
      },
    };

    const app = new BridgeApp(copilot);
    const result = await app.handleCancelledMessage({
      userId: 'u-1',
      messageId: 'm-2',
      chatType: 'p2p',
      text: 'hello',
      timestampMs: 1712726400001,
    });

    expect(result.finalState).toBe('interrupted');
    expect(result.finalText).toBe('Request interrupted by newer message.');
  });
});
