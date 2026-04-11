const BASE_URL = 'https://open.feishu.cn/open-apis';

export class FeishuApiError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = 'FeishuApiError';
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  token?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as { code: number; msg?: string } & Record<string, unknown>;
  if (payload.code !== 0) {
    throw new FeishuApiError(payload.msg ?? 'Unknown Feishu error', payload.code);
  }
  return payload as T;
}

export async function getTenantAccessToken(
  appId: string,
  appSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const result = await postJson<{ tenant_access_token: string }>(
    `${BASE_URL}/auth/v3/tenant_access_token/internal`,
    { app_id: appId, app_secret: appSecret },
    undefined,
    fetchImpl,
  );
  return result.tenant_access_token;
}

export async function sendFeishuText(
  token: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const result = await postJson<{ data: { message_id: string } }>(
    `${BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
    {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
    token,
    fetchImpl,
  );
  return result.data.message_id;
}
