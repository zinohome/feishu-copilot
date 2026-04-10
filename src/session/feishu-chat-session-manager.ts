import * as vscode from 'vscode';
import type { SessionStore, FeishuSession } from './session-store';
import type { CopilotAdapter } from '../copilot/copilot-adapter';
import type { InboundChatMessage } from '../domain/message-types';
import type { AgentRegistry } from '../agent/agent-registry';

export const FEISHU_SESSION_SCHEME = 'feishu-session';
export const FEISHU_SESSION_TYPE = 'feishu';
const NO_RUNNABLE_AGENT_ID = '__no_runnable_agent__';

function sessionUri(sessionId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: FEISHU_SESSION_SCHEME, path: `/${sessionId}` });
}

function sessionIdFromUri(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, '');
}

function makeHistoryTurn(
  message: FeishuSession['messages'][number],
): vscode.ChatSession['history'][number] {
  if (message.role === 'user') {
    return {
      prompt: message.text,
      participant: 'feishu-copilot.chat',
      command: undefined,
      references: [],
      toolReferences: [],
    } as unknown as vscode.ChatSession['history'][number];
  }

  return {
    response: [new vscode.ChatResponseMarkdownPart(message.text)],
    result: {
      metadata: {
        source: message.source,
        timestampMs: message.timestampMs,
      },
    },
    participant: 'feishu-copilot.chat',
    command: undefined,
  } as unknown as vscode.ChatSession['history'][number];
}

function buildHistory(messages: FeishuSession['messages']): vscode.ChatSession['history'] {
  return messages.map(makeHistoryTurn);
}

export class FeishuChatSessionManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private controller: vscode.ChatSessionItemController | undefined;
  private participant: vscode.ChatParticipant | undefined;

  constructor(
    private readonly store: SessionStore,
    private readonly copilot: CopilotAdapter,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  register(context: vscode.ExtensionContext): void {
    this.participant = vscode.chat.createChatParticipant(
      'feishu-copilot.chat',
      this.handleVsCodeRequest.bind(this),
    );
    this.participant.iconPath = new vscode.ThemeIcon('comment-discussion');
    this.disposables.push(this.participant);

    const chat = vscode.chat as typeof vscode.chat & {
      createChatSessionItemController(
        type: string,
        refresh: vscode.ChatSessionItemControllerRefreshHandler,
      ): vscode.ChatSessionItemController;
      registerChatSessionContentProvider(
        scheme: string,
        provider: vscode.ChatSessionContentProvider,
        participant: vscode.ChatParticipant,
      ): vscode.Disposable;
    };

    this.controller = chat.createChatSessionItemController(
      FEISHU_SESSION_TYPE,
      this.refreshItems.bind(this),
    );
    this.controller.newChatSessionItemHandler = this.handleNewSession.bind(this);
    this.controller.getChatSessionInputState = this.getChatSessionInputState.bind(this);
    this.disposables.push(this.controller);

    const providerDisposable = chat.registerChatSessionContentProvider(
      FEISHU_SESSION_SCHEME,
      this.buildContentProvider(),
      this.participant,
    );
    this.disposables.push(providerDisposable);

    this.disposables.push(
      this.store.onDidChange(() => {
        const cts = new vscode.CancellationTokenSource();
        void this.refreshItems(cts.token).finally(() => cts.dispose());
      }),
    );

  }

  private async refreshItems(token: vscode.CancellationToken): Promise<void> {
    if (!this.controller) {
      return;
    }
    const items = this.store.list().map(s => this.makeItem(s));
    this.controller.items.replace(items);
  }

  private makeItem(session: FeishuSession): vscode.ChatSessionItem {
    const item = this.controller!.createChatSessionItem(sessionUri(session.id), session.label);
    item.description = new vscode.MarkdownString(
      `Agent: ${session.selectedAgentId} | Last active: ${new Date(session.lastActiveAt).toLocaleString()}`,
    );
    item.timing = {
      created: session.createdAt,
      lastRequestStarted: session.messages.length > 0 ? session.lastActiveAt : undefined,
    };
    return item;
  }

  private async handleNewSession(
    context: vscode.ChatSessionItemControllerNewItemHandlerContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatSessionItem> {
    const prompt = context.request.prompt;
    const label = prompt.slice(0, 40) || `Feishu Session ${Date.now()}`;
    const session = this.store.getOrCreate(`vscode-${Date.now()}`, label);
    return this.makeItem(session);
  }

  private buildContentProvider(): vscode.ChatSessionContentProvider {
    return {
      provideChatSessionContent: (resource: vscode.Uri, token: vscode.CancellationToken): vscode.ChatSession => {
        const sessionId = sessionIdFromUri(resource);
        const session = this.store.get(sessionId);

        const requestHandler: vscode.ChatRequestHandler = async (request, ctx, stream, reqToken) => {
          if (!session) {
            stream.markdown('Session not found.');
            return;
          }

          const selectedFromInput = this.getSelectedAgentIdFromInputState(
            ctx.chatSessionContext?.inputState,
          );
          if (
            selectedFromInput &&
            this.agentRegistry.getRunnableById(selectedFromInput) &&
            selectedFromInput !== session.selectedAgentId
          ) {
            this.store.setSelectedAgent(session.id, selectedFromInput);
            session.selectedAgentId = selectedFromInput;
          }

          // Auto-heal stale session agent ids for VS Code path as well
          const normalizedAgentId = this.resolveValidAgentId(session.selectedAgentId);
          if (normalizedAgentId !== session.selectedAgentId) {
            this.store.setSelectedAgent(session.id, normalizedAgentId);
            session.selectedAgentId = normalizedAgentId;
          }

          const userText = request.prompt;
          const nowMs = Date.now();

          this.store.appendMessage(session.id, {
            role: 'user',
            text: userText,
            timestampMs: nowMs,
            source: 'vscode',
          });

          const recentMsgs = session.messages.slice(-20);
          const contextLines = recentMsgs
            .slice(0, -1)
            .map(m => `[${m.source === 'feishu' ? 'Feishu' : 'VS Code'} ${m.role}]: ${m.text}`)
            .join('\n');

          const runnableAgent = this.agentRegistry.getRunnableById(session.selectedAgentId);
          const rawPrompt = contextLines ? `${contextLines}\n[user]: ${userText}` : userText;
          const inbound: InboundChatMessage = {
            userId: session.feishuKey,
            messageId: `vscode-${nowMs}`,
            chatType: 'p2p',
            text: runnableAgent?.systemPrompt
              ? `[Agent: ${runnableAgent.id}]\n${runnableAgent.systemPrompt}\n\nUser request:\n${rawPrompt}`
              : rawPrompt,
            timestampMs: nowMs,
          };

          let fullResponse = '';
          let cancelled = false;
          try {
            const ac = new AbortController();
            reqToken.onCancellationRequested(() => {
              cancelled = true;
              ac.abort();
            });
            const chunks = await this.copilot.generate(inbound, ac.signal);
            for await (const chunk of chunks) {
              stream.markdown(chunk);
              fullResponse += chunk;
            }
          } catch (err) {
            if (cancelled || reqToken.isCancellationRequested || (err instanceof Error && err.name === 'AbortError')) {
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            stream.markdown(`\n\n⚠️ Error: ${msg}`);
            fullResponse = `Error: ${msg}`;
          }

          this.store.appendMessage(session.id, {
            role: 'assistant',
            text: fullResponse,
            timestampMs: Date.now(),
            source: 'vscode',
          });
        };

        return {
          title: session?.label,
          history: session ? buildHistory(session.messages) : [],
          requestHandler,
        };
      },
    };
  }

  private getSelectedAgentIdFromInputState(
    inputState: vscode.ChatSessionInputState | undefined,
  ): string | undefined {
    if (!inputState) {
      return undefined;
    }
    const group = inputState.groups.find(g => g.id === 'agent');
    return group?.selected?.id;
  }

  private async getChatSessionInputState(
    sessionResource: vscode.Uri | undefined,
    context: { previousInputState: vscode.ChatSessionInputState | undefined },
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatSessionInputState> {
    if (!this.controller) {
      throw new Error('Session controller is not initialized');
    }

    const sessionId = sessionResource ? sessionIdFromUri(sessionResource) : undefined;
    const session = sessionId ? this.store.get(sessionId) : undefined;
    const selectedAgentId = this.resolveValidAgentId(session?.selectedAgentId);

    if (session && selectedAgentId !== session.selectedAgentId) {
      this.store.setSelectedAgent(session.id, selectedAgentId);
    }

    const items: vscode.ChatSessionProviderOptionItem[] = this.agentRegistry
      .listRunnable()
      .map(agent => ({
        id: agent.id,
        name: agent.displayName,
        description: agent.description,
        default: agent.id === selectedAgentId,
      }));

    if (items.length === 0) {
      items.push({
        id: NO_RUNNABLE_AGENT_ID,
        name: 'No runnable agents',
        description: 'Set feishuCopilot.superpowersSourcePath to your Superpowers extension root',
        default: true,
      });
    }

    const selected = items.find(i => i.id === selectedAgentId) ?? items[0];
    const group: vscode.ChatSessionProviderOptionGroup = {
      id: 'agent',
      name: 'Agent',
      description: 'Select agent for this session',
      items,
      selected,
    };

    return this.controller.createChatSessionInputState([group]);
  }

  private resolveValidAgentId(candidate: string | undefined): string {
    const fallback = this.agentRegistry.getDefaultAgentId();
    if (!candidate) {
      return fallback;
    }
    return this.agentRegistry.getRunnableById(candidate)?.id ?? fallback;
  }

  notifySessionActive(sessionId: string): void {
    if (!this.controller) {
      return;
    }
    const item = this.controller.items.get(sessionUri(sessionId));
    if (item) {
      item.status = vscode.ChatSessionStatus.InProgress;
      item.description = new vscode.MarkdownString('⏳ Feishu is responding...');
    }
  }

  notifySessionDone(sessionId: string): void {
    if (!this.controller) {
      return;
    }
    const session = this.store.get(sessionId);
    const item = this.controller.items.get(sessionUri(sessionId));
    if (item && session) {
      item.status = vscode.ChatSessionStatus.Completed;
      item.description = new vscode.MarkdownString(
        `Agent: ${session.selectedAgentId} | Last active: ${new Date(session.lastActiveAt).toLocaleString()}`,
      );
    }
  }

  private async handleVsCodeRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const inbound: InboundChatMessage = {
      userId: 'vscode-inline',
      messageId: `vscode-${Date.now()}`,
      chatType: 'p2p',
      text: request.prompt,
      timestampMs: Date.now(),
    };

    const ac = new AbortController();
    let cancelled = false;
    token.onCancellationRequested(() => {
      cancelled = true;
      ac.abort();
    });

    try {
      const chunks = await this.copilot.generate(inbound, ac.signal);
      for await (const chunk of chunks) {
        stream.markdown(chunk);
      }
    } catch (err) {
      if (cancelled || token.isCancellationRequested || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      stream.markdown(`⚠️ Error: ${msg}`);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
