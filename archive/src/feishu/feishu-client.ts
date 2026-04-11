const BASE_URL = 'https://open.feishu.cn/open-apis';

export class FeishuApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = 'FeishuApiError';
  }
}

async function post<T>(url: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { code: number; msg: string } & Record<string, unknown>;

  if (json.code !== 0) {
    throw new FeishuApiError(`Feishu API error: ${json.msg}`, json.code);
  }

  return json as T;
}

async function patch<T>(url: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { code: number; msg: string } & Record<string, unknown>;

  if (json.code !== 0) {
    throw new FeishuApiError(`Feishu API error: ${json.msg}`, json.code);
  }

  return json as T;
}

export async function getToken(appId: string, appSecret: string): Promise<string> {
  const data = await post<{ tenant_access_token: string }>(
    `${BASE_URL}/auth/v3/tenant_access_token/internal`,
    { app_id: appId, app_secret: appSecret },
  );
  return data.tenant_access_token;
}

export async function sendText(token: string, chatId: string, text: string): Promise<string> {
  const data = await post<{ data: { message_id: string } }>(
    `${BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
    {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
    token,
  );
  return data.data.message_id;
}

export async function sendCard(
  token: string,
  chatId: string,
  cardContent: string,
): Promise<string> {
  const data = await post<{ data: { message_id: string } }>(
    `${BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
    {
      receive_id: chatId,
      msg_type: 'interactive',
      content: cardContent,
    },
    token,
  );
  return data.data.message_id;
}

export async function updateCard(
  token: string,
  messageId: string,
  cardContent: string,
): Promise<void> {
  await patch<unknown>(
    `${BASE_URL}/im/v1/messages/${encodeURIComponent(messageId)}`,
    {
      msg_type: 'interactive',
      content: cardContent,
    },
    token,
  );
}

export async function replyCard(
  token: string,
  messageId: string,
  cardContent: string,
): Promise<string> {
  const data = await post<{ data: { message_id: string } }>(
    `${BASE_URL}/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
    {
      msg_type: 'interactive',
      content: cardContent,
    },
    token,
  );
  return data.data.message_id;
}
