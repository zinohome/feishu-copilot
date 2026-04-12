const BASE_URL = 'https://open.feishu.cn/open-apis';

export class FeishuApiError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = 'FeishuApiError';
  }
}

async function requestJson<T>(
  url: string,
  body: unknown,
  token?: string,
  fetchImpl: typeof fetch = fetch,
  method: string = 'POST'
): Promise<T> {
  const response = await fetchImpl(url, {
    method,
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
  const result = await requestJson<{ tenant_access_token: string }>(
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
  const result = await requestJson<{ data: { message_id: string } }>(
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

/**
 * Parses text containing [[NOTE]]...[[/NOTE]] markers into Feishu Card 2.0 markdown elements.
 * NOTE sections (tool invocations) are rendered as blockquotes so they look visually smaller/lighter.
 * Regular sections are standard markdown elements.
 */
function parseContentToElements(text: string): Array<{ tag: string; content: string }> {
  const elements: Array<{ tag: string; content: string }> = [];
  const parts = text.split(/(\[\[NOTE\]\][\s\S]*?\[\[\/NOTE\]\])/g);

  for (const part of parts) {
    if (part.startsWith('[[NOTE]]') && part.endsWith('[[/NOTE]]')) {
      const inner = part.slice('[[NOTE]]'.length, -'[[/NOTE]]'.length).trim();
      if (inner) {
        // Render as blockquote lines so it's visually indented/distinct
        const quoted = inner.split('\n').map(l => `> ${l}`).join('\n');
        elements.push({ tag: 'markdown', content: quoted });
      }
    } else {
      const content = part.trim();
      if (content) {
        elements.push({ tag: 'markdown', content });
      }
    }
  }

  if (elements.length === 0) {
    elements.push({ tag: 'markdown', content: text });
  }
  return elements;
}

/** Build an interactive card using Feishu JSON 2.0 schema. */
function buildInteractiveCard(text: string, role: 'user' | 'assistant'): object {
  const elements = parseContentToElements(text);
  if (role === 'user') {
    return {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: '👤' },
      },
      body: { elements },
    };
  }
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      template: 'green',
      title: { tag: 'plain_text', content: '💻' },
    },
    body: { elements },
  };
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
  const card = buildInteractiveCard(text, role);
  const cardJson = JSON.stringify(card);
  console.log(`[feishu-client] send ${role} interactive card, body len=${cardJson.length}`);

  try {
    const result = await requestJson<{ data: { message_id: string } }>(
      `${BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: 'interactive',
        content: cardJson,
      },
      token,
      fetchImpl,
    );
    console.log(`[feishu-client] sent ${role} card: ${result.data.message_id}`);
    return result.data.message_id;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[feishu-client] interactive send failed (${errMsg}), fallback to text`);
    return sendFeishuText(token, chatId, text, fetchImpl);
  }
}

export async function updateFeishuMirrorMessage(
  token: string,
  messageId: string,
  text: string,
  meta?: MirrorMessageMeta,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const role = meta?.type === 'user-message' ? 'user' : 'assistant';
  const card = buildInteractiveCard(text, role);
  const cardJson = JSON.stringify(card);

  try {
    const result = await requestJson<{ data: { message_id: string } }>(
      `${BASE_URL}/im/v1/messages/${messageId}`,
      { content: cardJson },
      token,
      fetchImpl,
      'PATCH'
    );
    return result.data.message_id;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[feishu-client] interactive PATCH failed (${errMsg}), fallback text PATCH`);
    const fallbackResult = await requestJson<{ data: { message_id: string } }>(
      `${BASE_URL}/im/v1/messages/${messageId}`,
      { content: JSON.stringify({ text }) },
      token,
      fetchImpl,
      'PATCH'
    );
    return fallbackResult.data.message_id;
  }
}
