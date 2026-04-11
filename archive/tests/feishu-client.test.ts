import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FeishuApiError,
  getToken,
  replyCard,
  sendCard,
  sendText,
  updateCard,
} from '../archive/src/feishu/feishu-client';

const BASE_URL = 'https://open.feishu.cn/open-apis';

function mockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
  });
}

describe('getToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ code: 0, tenant_access_token: 'test-token', expire: 7200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the correct URL with app_id and app_secret', async () => {
    const token = await getToken('my-app-id', 'my-app-secret');

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/auth/v3/tenant_access_token/internal`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      app_id: 'my-app-id',
      app_secret: 'my-app-secret',
    });
    expect(token).toBe('test-token');
  });

  it('throws FeishuApiError when code is non-zero', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ code: 10003, msg: 'app_id not exist', tenant_access_token: '' }),
    );

    await expect(getToken('bad-id', 'bad-secret')).rejects.toThrow(FeishuApiError);
    await expect(getToken('bad-id', 'bad-secret')).rejects.toMatchObject({ code: 10003 });
  });
});

describe('sendText', () => {
  const TOKEN = 'bearer-token';
  const CHAT_ID = 'oc_abc123';
  const MESSAGE_ID = 'om_xyz789';

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ code: 0, data: { message_id: MESSAGE_ID } }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the correct URL with Authorization header and body', async () => {
    const msgId = await sendText(TOKEN, CHAT_ID, 'Hello world');

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/im/v1/messages?receive_id_type=chat_id`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body as string);
    expect(body.receive_id).toBe(CHAT_ID);
    expect(body.msg_type).toBe('text');
    expect(JSON.parse(body.content)).toEqual({ text: 'Hello world' });
    expect(msgId).toBe(MESSAGE_ID);
  });

  it('throws FeishuApiError on API failure', async () => {
    vi.stubGlobal('fetch', mockFetch({ code: 230001, msg: 'Bot not in chat' }));

    await expect(sendText(TOKEN, CHAT_ID, 'Hi')).rejects.toThrow(FeishuApiError);
    await expect(sendText(TOKEN, CHAT_ID, 'Hi')).rejects.toMatchObject({ code: 230001 });
  });
});

describe('sendCard', () => {
  const TOKEN = 'bearer-token';
  const CHAT_ID = 'oc_abc123';
  const MESSAGE_ID = 'om_card001';
  const CARD_CONTENT = JSON.stringify({ type: 'template', data: { template_id: 'tpl_1' } });

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ code: 0, data: { message_id: MESSAGE_ID } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends interactive message with correct body', async () => {
    const msgId = await sendCard(TOKEN, CHAT_ID, CARD_CONTENT);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/im/v1/messages?receive_id_type=chat_id`);
    const body = JSON.parse(init.body as string);
    expect(body.msg_type).toBe('interactive');
    expect(body.content).toBe(CARD_CONTENT);
    expect(msgId).toBe(MESSAGE_ID);
  });
});

describe('updateCard', () => {
  const TOKEN = 'bearer-token';
  const MESSAGE_ID = 'om_card001';
  const CARD_CONTENT = JSON.stringify({ type: 'template', data: { template_id: 'tpl_2' } });

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ code: 0 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends PATCH request to correct URL', async () => {
    await updateCard(TOKEN, MESSAGE_ID, CARD_CONTENT);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/im/v1/messages/${MESSAGE_ID}`);
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string);
    expect(body.msg_type).toBe('interactive');
    expect(body.content).toBe(CARD_CONTENT);
  });
});

describe('replyCard', () => {
  const TOKEN = 'bearer-token';
  const PARENT_MESSAGE_ID = 'om_parent001';
  const REPLY_MESSAGE_ID = 'om_reply001';
  const CARD_CONTENT = JSON.stringify({ type: 'template', data: { template_id: 'tpl_3' } });

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ code: 0, data: { message_id: REPLY_MESSAGE_ID } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends POST to /reply endpoint and returns message_id', async () => {
    const msgId = await replyCard(TOKEN, PARENT_MESSAGE_ID, CARD_CONTENT);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/im/v1/messages/${PARENT_MESSAGE_ID}/reply`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.msg_type).toBe('interactive');
    expect(msgId).toBe(REPLY_MESSAGE_ID);
  });
});
