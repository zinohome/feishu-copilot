import * as vscode from 'vscode';
import type { SessionStore, FeishuSession, SessionStoreChangeEvent } from './session-store';
import { buildPromptWithSessionHistory } from './session-prompt-context';
import type { CopilotAdapter } from '../copilot/copilot-adapter';
import type { InboundChatMessage } from '../domain/message-types';
import type { AgentRegistry } from '../agent/agent-registry';

export const FEISHU_SESSION_SCHEME = 'feishu-session';
export const FEISHU_SESSION_TYPE = 'feishu';
const NO_RUNNABLE_AGENT_ID = '__no_runnable_agent__';

export interface FeishuSessionMirror {
  mirrorTurn(session: FeishuSession, turn: { userText: string; assistantText: string }): Promise<void>;
}

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
      response: [],
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
    references: [],
    toolReferences: [],
  } as unknown as vscode.ChatSession['history'][number];
}

function buildHistory(messages: FeishuSession['messages'] | undefined): vscode.ChatSession['history'] {
  const safeMessages = Array.isArray(messages)
    ? messages.filter((m): m is FeishuSession['messages'][number] => Boolean(m && typeof m === 'object'))
    : [];
  return safeMessages.map(makeHistoryTurn);
}

export class FeishuChatSessionManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private controller: vscode.ChatSessionItemController | undefined;
  private participant: vscode.ChatParticipant | undefined;
  private mirror: FeishuSessionMirror | undefined;
  private lastOpenedSessionId: string | undefined;
  private refreshNonce = 0;

  constructor(
    private readonly store: SessionStore,
    private readonly copilot: CopilotAdapter,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  setMirror(mirror: FeishuSessionMirror | undefined): void {
    this.mirror = mirror;
  }

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
      this.store.onDidChange((event) => {
        void this.handleStoreChange(event);
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

  private async handleStoreChange(event: SessionStoreChangeEvent): Promise<void> {
    const cts = new vscode.CancellationTokenSource();
    try {
      await this.refreshItems(cts.token);
    } finally {
      cts.dispose();
    }

    if (
      event.reason === 'append' &&
      event.messageSource === 'feishu' &&
      event.sessionId === this.lastOpenedSessionId
    ) {
      const refreshUri = sessionUri(event.sessionId).with({
        query: `refresh=${Date.now()}-${++this.refreshNonce}`,
      });
      await vscode.commands.executeCommand('vscode.open', refreshUri, {
        preview: false,
        preserveFocus: true,
      });
    }
  }

  private makeItem(session: FeishuSession): vscode.ChatSessionItem {
    const item = this.controller!.createChatSessionItem(sessionUri(session.id), session.label);
    item.description = new vscode.MarkdownString(
      `Agent: ${session.selectedAgentId} | Last active: ${new Date(session.lastActiveAt).toLocaleString()}`,
    );
    item.timing = {
      created: session.createdAt,
      lastRequestStarted: (session.messages?.length ?? 0) > 0 ? session.lastActiveAt : undefined,
    };
    return item;
  }

  private async handleNewSession(
    context: vscode.ChatSessionItemControllerNewItemHandlerContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatSessionItem> {
    const sharedSession = this.store
      .list()
      .find(s => !s.archived && Boolean(s.feishuKey) && !s.feishuKey.startsWith('vscode-'));
    if (sharedSession) {
      return this.makeItem(sharedSession);
    }

    const prompt = context.request.prompt;
    const label = prompt.slice(0, 40) || `Feishu Session ${Date.now()}`;
    const session = this.store.getOrCreate(`vscode-${Date.now()}`, label);
    return this.makeItem(session);
  }

  private buildContentProvider(): vscode.ChatSessionContentProvider {
    return {
      provideChatSessionContent: (resource: vscode.Uri, token: vscode.CancellationToken): vscode.ChatSession => {
        try {
          const sessionId = sessionIdFromUri(resource);
          this.lastOpenedSessionId = sessionId;
          const session = this.store.get(sessionId);
          if (session && !Array.isArray((session as { messages?: unknown }).messages)) {
            session.messages = [];
          }

          const requestHandler: vscode.ChatRequestHandler = async (request, ctx, stream, reqToken) => {
            if (!session) {
              stream.markdown('Session not found.');
              return;
            }
            await this.handleStoredSessionRequest(session, request, ctx, stream, reqToken);
          };

          return {
            title: session?.label,
            history: session ? buildHistory(session.messages) : [],
            requestHandler,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const fallbackHandler: vscode.ChatRequestHandler = async (_request, _ctx, stream, _reqToken) => {
            stream.markdown(`⚠️ Failed to open session content: ${msg}`);
          };
          return {
            title: 'Feishu Session',
            history: [],
            requestHandler: fallbackHandler,
          };
        }
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

  private shouldMirrorSession(session: FeishuSession): boolean {
    return Boolean(this.mirror) && Boolean(session.feishuKey) && !session.feishuKey.startsWith('vscode-');
  }

  private resolveStoredSessionFromContext(context: vscode.ChatContext): FeishuSession | undefined {
    const sessionResource = context.chatSessionContext?.chatSessionItem.resource;
    if (sessionResource?.scheme === FEISHU_SESSION_SCHEME) {
      return this.store.get(sessionIdFromUri(sessionResource));
    }

    return this.store
      .list()
      .find(s => !s.archived && Boolean(s.feishuKey) && !s.feishuKey.startsWith('vscode-'));
  }

  async openLatestSharedSession(): Promise<boolean> {
    const latest = this.store
      .list()
      .find(s => !s.archived && Boolean(s.feishuKey) && !s.feishuKey.startsWith('vscode-'));
    if (!latest) {
      return false;
    }
    await vscode.commands.executeCommand('vscode.open', sessionUri(latest.id), {
      preview: false,
    });
    return true;
  }

  private async handleStoredSessionRequest(
    session: FeishuSession,
    request: vscode.ChatRequest,
    ctx: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    reqToken: vscode.CancellationToken,
  ): Promise<void> {
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

    const runnableAgent = this.agentRegistry.getRunnableById(session.selectedAgentId);
    const rawPrompt = buildPromptWithSessionHistory(session.messages, userText);
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

    if (fullResponse && this.shouldMirrorSession(session)) {
      try {
        await this.mirror?.mirrorTurn(session, {
          userText,
          assistantText: fullResponse,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stream.markdown(`\n\n⚠️ Failed to sync this turn to Feishu: ${msg}`);
      }
    }
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
    const storedSession = this.resolveStoredSessionFromContext(context);
    if (storedSession) {
      await this.handleStoredSessionRequest(storedSession, request, context, stream, token);
      return;
    }
    stream.markdown(
      'This request is not bound to a Feishu shared session. Open a Feishu Session item and send the message there.',
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
