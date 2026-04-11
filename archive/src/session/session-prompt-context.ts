import type { FeishuSession } from './session-store';

const MAX_CONTEXT_MESSAGES = 50;

function isSessionMessage(value: unknown): value is FeishuSession['messages'][number] {
  return Boolean(value && typeof value === 'object');
}

function formatSourceLabel(source: FeishuSession['messages'][number]['source']): string {
  return source === 'feishu' ? 'Feishu' : 'VS Code';
}

export function buildPromptWithSessionHistory(
  messages: FeishuSession['messages'] | undefined,
  currentUserText: string,
): string {
  const safeMessages = Array.isArray(messages)
    ? messages.filter(isSessionMessage)
    : [];

  const historicalMessages = safeMessages.filter((message, index) => {
    return !(
      index === safeMessages.length - 1 &&
      message.role === 'user' &&
      message.text === currentUserText
    );
  });

  const contextLines = historicalMessages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(message => `[${formatSourceLabel(message.source)} ${message.role}]: ${message.text}`)
    .join('\n');

  return contextLines ? `${contextLines}\n[user]: ${currentUserText}` : currentUserText;
}