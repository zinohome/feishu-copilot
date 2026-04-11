import { describe, expect, it, vi } from 'vitest';
import { getTenantAccessToken, sendFeishuText } from '../src/feishu/client';

describe('feishu client', () => {
  it('fetches tenant access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ code: 0, tenant_access_token: 'token_123' }),
    });

    const token = await getTenantAccessToken('app', 'secret', fetchMock as typeof fetch);
    expect(token).toBe('token_123');
  });

  it('sends text to configured chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ code: 0, data: { message_id: 'msg_1' } }),
    });

    const messageId = await sendFeishuText(
      'token_123',
      'oc_123',
      'hello',
      fetchMock as typeof fetch,
    );

    expect(messageId).toBe('msg_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
