import { describe, expect, it } from 'vitest';
import { shouldRestartBridgeForConfigChange } from '../src/extension';

function eventFor(changedKey: string): { affectsConfiguration: (section: string) => boolean } {
  return {
    affectsConfiguration: (section: string) =>
      section === changedKey || changedKey.startsWith(`${section}.`),
  };
}

describe('shouldRestartBridgeForConfigChange', () => {
  it('returns true for feishu appId change when bridge is running', () => {
    const evt = eventFor('feishuCopilot.feishuAppId');
    expect(shouldRestartBridgeForConfigChange(evt, true)).toBe(true);
  });

  it('returns true for feishu appSecret change when bridge is running', () => {
    const evt = eventFor('feishuCopilot.feishuAppSecret');
    expect(shouldRestartBridgeForConfigChange(evt, true)).toBe(true);
  });

  it('returns true for ownerOpenId change when bridge is running', () => {
    const evt = eventFor('feishuCopilot.ownerOpenId');
    expect(shouldRestartBridgeForConfigChange(evt, true)).toBe(true);
  });

  it('returns true for superpowersSourcePath change when bridge is running', () => {
    const evt = eventFor('feishuCopilot.superpowersSourcePath');
    expect(shouldRestartBridgeForConfigChange(evt, true)).toBe(true);
  });

  it('returns false for credential changes when bridge is not running', () => {
    const appIdEvt = eventFor('feishuCopilot.feishuAppId');
    const appSecretEvt = eventFor('feishuCopilot.feishuAppSecret');
    expect(shouldRestartBridgeForConfigChange(appIdEvt, false)).toBe(false);
    expect(shouldRestartBridgeForConfigChange(appSecretEvt, false)).toBe(false);
  });
});
