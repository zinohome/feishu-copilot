import type { ExtensionConfig } from './types';

export interface ConfigurationLike {
  get<T>(key: string, defaultValue: T): T;
}

export function readExtensionConfig(config: ConfigurationLike): ExtensionConfig {
  return {
    feishuAppId: config.get('feishuAppId', '').trim(),
    feishuAppSecret: config.get('feishuAppSecret', '').trim(),
    ownerOpenId: config.get('ownerOpenId', '').trim(),
    targetChatId: config.get('targetChatId', '').trim(),
    statusCardEnabled: config.get('statusCardEnabled', true),
    maxMirroredSessions: config.get('maxMirroredSessions', 8),
  };
}
