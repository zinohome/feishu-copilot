import type { CopilotTurn, SessionSummary } from '../types';

/** 仅在会话首次接入或切换时发送 */
export function renderSessionSwitch(summary: SessionSummary): string {
  return ` 🔗 **当前会话**\n${summary.title}`;
}

/** 用户消息：直接发原文，不加前缀 */
export function renderUserMessage(turn: CopilotTurn): string {
  return `👤 ${turn.userText}`;
}

/** Copilot 回复：直接发 Markdown 原文，不加前缀 */
export function renderAssistantMessage(turn: CopilotTurn): string {
  return ` ${turn.assistantText}`;
}
