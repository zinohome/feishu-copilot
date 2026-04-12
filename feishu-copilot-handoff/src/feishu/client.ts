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

export type MirrorMessageMeta = {
  role?: 'system' | 'user' | 'assistant';
  type?: 'session-switch' | 'user-message' | 'assistant-message';
};

function buildInteractiveCard(text: string, role: 'user' | 'assistant') {
  const card: {
    config: { wide_screen_mode: boolean; enable_forward: boolean };
    elements: Array<{ tag: 'markdown'; content: string }>;
  } = {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: text,
      },
    ],
  };

  return card;
}

export async function sendFeishuMirrorMessage(
  token: string,
  chatId: string,
  text: string,
  meta?: MirrorMessageMeta,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (meta?.type !== 'user-message' && meta?.type !== 'assistant-message') {
    return sendFeishuText(token, chatId, text, fetchImpl);
  }

  const role = meta.type === 'user-message' ? 'user' : 'assistant';
  try {
    const result = await postJson<{ data: { message_id: string } }>(
      `${BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(buildInteractiveCard(text, role)),
      },
      token,
      fetchImpl,
    );
    return result.data.message_id;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('[feishu-client] interactive send failed, fallback to text:', errMsg);
    return sendFeishuText(token, chatId, text, fetchImpl);
  }
}
