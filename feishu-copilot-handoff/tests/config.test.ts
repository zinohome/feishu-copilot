import { describe, expect, it } from 'vitest';
import { readExtensionConfig } from '../src/config';

const makeConfig = (values: Record<string, unknown>) => ({
  get<T>(key: string, defaultValue: T): T {
    return (key in values ? (values[key] as T) : defaultValue);
  },
});

describe('readExtensionConfig', () => {
  it('returns trimmed settings and defaults', () => {
    const config = readExtensionConfig(makeConfig({
      feishuAppId: ' cli_app ',
      feishuAppSecret: ' secret ',
      ownerOpenId: ' ou_123 ',
      targetChatId: ' oc_123 ',
    }));

    expect(config).toEqual({
      feishuAppId: 'cli_app',
      feishuAppSecret: 'secret',
      ownerOpenId: 'ou_123',
      targetChatId: 'oc_123',
      statusCardEnabled: true,
      maxMirroredSessions: 8,
    });
  });
});
