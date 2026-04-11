import type { SessionSummary } from '../types';

export function renderSessionSwitch(summary: SessionSummary): string {
  return [
    '已切换接力目标',
    `Session: ${summary.title}`,
    '状态: 后续飞书输入将直接提交到该会话',
  ].join('\n');
}

export function renderMirroredTurn(summary: SessionSummary): string {
  const turn = summary.turns.at(-1);
  if (!turn) {
    return `当前接力会话: ${summary.title}`;
  }

  return [
    `[当前接力会话] ${summary.title}`,
    '',
    '你:',
    turn.userText,
    '',
    'Copilot:',
    turn.assistantText,
  ].join('\n');
}
