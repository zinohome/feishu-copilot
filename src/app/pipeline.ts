import { CardRenderer } from '../card/card-renderer';
import type { BridgeConfig } from '../config/types';
import type { CopilotAdapter } from '../copilot/copilot-adapter';
import type { InboundChatMessage } from '../domain/message-types';
import { sendCard, sendText, updateCard } from '../feishu/feishu-client';
import { SessionRouter } from '../session/session-router';
import type { SessionStore } from '../session/session-store';
import type { FeishuChatSessionManager } from '../session/feishu-chat-session-manager';
import type { AgentRegistry } from '../agent/agent-registry';

export interface FeishuWebhookEvent {
  sender: {
    open_id: string;
  };
  message: {
    message_id: string;
    /** JSON string: {"text":"..."} */
    content: string;
    chat_id: string;
    /** Millisecond timestamp as string */
    create_time: string;
  };
}

export interface PipelineOptions {
  config: BridgeConfig;
  copilot: CopilotAdapter;
  feishuToken: string;
  sessionStore?: SessionStore;
  sessionManager?: FeishuChatSessionManager;
  agentRegistry?: AgentRegistry;
}

const THINKING_CARD = JSON.stringify({
  config: { wide_screen_mode: true },
  elements: [{ tag: 'div', text: { tag: 'lark_md', content: '⏳ Thinking...' } }],
});

function makeTextCard(text: string): string {
  return JSON.stringify({
    config: { wide_screen_mode: true },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }],
  });
}

export class Pipeline {
  private readonly sessionRouter = new SessionRouter();

  constructor(private readonly options: PipelineOptions) {}

  async handleInbound(event: FeishuWebhookEvent): Promise<void> {
    const { config, copilot, feishuToken, sessionStore, sessionManager, agentRegistry } = this.options;

    // a. Sender authorization check
    if (!config.ownerOpenId) {
      return;
    }
    if (event.sender.open_id !== config.ownerOpenId) {
      return;
    }

    // b. Extract text from content JSON
    let text: string;
    try {
      const parsed = JSON.parse(event.message.content) as { text?: string };
      text = parsed.text ?? '';
    } catch {
      text = event.message.content;
    }

    // c. Build InboundChatMessage
    const message: InboundChatMessage = {
      userId: event.sender.open_id,
      messageId: event.message.message_id,
      chatType: 'p2p',
      text,
      timestampMs: Number(event.message.create_time),
    };

    // c2. Resolve shared session state when session store is enabled
    let sessionId: string | undefined;
    let selectedAgentId = agentRegistry?.getDefaultAgentId() ?? 'superpowers';
    const feishuKey = event.message.chat_id || event.sender.open_id;
    if (sessionStore) {
      const label = `飞书 ${feishuKey.slice(0, 12)}`;
      const session = sessionStore.getOrCreate(feishuKey, label);
      sessionId = session.id;
      selectedAgentId = session.selectedAgentId || (agentRegistry?.getDefaultAgentId() ?? 'superpowers');

      // Auto-heal stale session agent ids (e.g. skill removed or source path changed)
      if (agentRegistry && !agentRegistry.getRunnableById(selectedAgentId)) {
        selectedAgentId = agentRegistry.getDefaultAgentId();
        sessionStore.setSelectedAgent(session.id, selectedAgentId);
      }
    }

    // c3. Handle /agent commands before normal LLM routing
    const cmd = text.trim();
    const agentMatch = /^\/agent(?:\s+([\s\S]*))?$/.exec(cmd);
    if (agentMatch) {
      if (!agentRegistry) {
        await sendText(feishuToken, event.message.chat_id, 'Agent registry is not enabled.');
        return;
      }

      const subCommand = (agentMatch[1] ?? '').trim();

      if (subCommand === 'list') {
        await sendText(feishuToken, event.message.chat_id, agentRegistry.formatForFeishu(selectedAgentId));
        return;
      }

      if (subCommand === 'current') {
        const current = agentRegistry.getById(selectedAgentId);
        const currentText = current
          ? `Current agent: ${current.id} (${current.displayName})`
          : `Current agent id: ${selectedAgentId} (not found in registry)`;
        await sendText(feishuToken, event.message.chat_id, currentText);
        return;
      }

      const useMatch = /^use\s+(\S+)$/.exec(subCommand);
      if (useMatch) {
        const target = useMatch[1];
        const agent = agentRegistry.getRunnableById(target);
        if (!agent) {
          await sendText(
            feishuToken,
            event.message.chat_id,
            `Unknown runnable agent: ${target}\n\n${agentRegistry.formatForFeishu(selectedAgentId)}`,
          );
          return;
        }

        if (!sessionStore || !sessionId) {
          await sendText(
            feishuToken,
            event.message.chat_id,
            'Agent switching requires session storage support.',
          );
          return;
        }

        sessionStore.setSelectedAgent(sessionId, target);
        await sendText(feishuToken, event.message.chat_id, `Switched agent to ${target}.`);
        return;
      }

      await sendText(
        feishuToken,
        event.message.chat_id,
        'Usage:\n/agent list\n/agent current\n/agent use <agentId>',
      );
      return;
    }

    if (sessionStore && sessionId) {
      sessionStore.appendMessage(sessionId, {
        role: 'user',
        text,
        timestampMs: message.timestampMs,
        source: 'feishu',
      });
    }

    // c4. Notify Copilot Chat session list that this session is active
    if (sessionManager && sessionId) {
      sessionManager.notifySessionActive(sessionId);
    }

    // d. Enqueue in SessionRouter (cancels previous request in the same chat session)
    const routingKey = event.message.chat_id || message.userId;
    const requestState = this.sessionRouter.enqueue(routingKey, message.messageId);

    let cardMessageId: string | undefined;
    try {
      // e. Send initial thinking card
      cardMessageId = await sendCard(feishuToken, event.message.chat_id, THINKING_CARD);
      const currentCardMessageId = cardMessageId;

      // f. Create CardRenderer; onFlush updates the card
      const renderer = new CardRenderer({
        throttleMs: config.cardPatchIntervalMs,
        onFlush: (currentText, _reason) => {
          void updateCard(feishuToken, currentCardMessageId, makeTextCard(currentText));
        },
      });

      // g. Resolve agent and stream chunks into renderer
      const runnableAgent = agentRegistry?.getRunnableById(selectedAgentId);
      const effectiveMessage: InboundChatMessage = runnableAgent?.systemPrompt
        ? {
            ...message,
            text: `[Agent: ${runnableAgent.id}]\n${runnableAgent.systemPrompt}\n\nUser request:\n${message.text}`,
          }
        : message;

      const chunks = await copilot.generate(effectiveMessage, requestState.abortController.signal);
      for await (const chunk of chunks) {
        renderer.pushChunk(chunk);
      }

        // g2. Capture full response text for session store
        let fullResponseText = '';

      // h. Interrupted by a newer request
      if (requestState.cancelled) {
        await updateCard(
          feishuToken,
          cardMessageId,
          makeTextCard('⚠️ Request interrupted by newer message.'),
        );
          if (sessionManager && sessionId) {
            sessionManager.notifySessionDone(sessionId);
          }
        return;
      }

      // i. Finalize – triggers final onFlush which updates the card
       fullResponseText = renderer.finalize();

        // i2. Persist assistant response
      if (sessionStore && sessionId) {
        sessionStore.appendMessage(sessionId, {
          role: 'assistant',
          text: fullResponseText,
          timestampMs: Date.now(),
          source: 'feishu',
        });
      }
      if (sessionManager && sessionId) {
        sessionManager.notifySessionDone(sessionId);
      }
    } catch (err) {
      const interrupted = requestState.cancelled ||
        (err instanceof Error && err.name === 'AbortError');
      if (interrupted) {
        if (cardMessageId) {
          await updateCard(
            feishuToken,
            cardMessageId,
            makeTextCard('⚠️ Request interrupted by newer message.'),
          );
        }
        if (sessionManager && sessionId) {
          sessionManager.notifySessionDone(sessionId);
        }
        return;
      }

      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await sendText(feishuToken, event.message.chat_id, `❌ Error: ${errMsg}`);
      if (sessionManager && sessionId) {
        sessionManager.notifySessionDone(sessionId);
      }
    } finally {
      this.sessionRouter.complete(routingKey, requestState.requestId);
    }
  }
}
