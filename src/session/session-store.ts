import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SUPERPOWERS_DEFAULT_AGENT_ID } from '../agent/superpowers-agent-presets';
import type { SessionStoreMode } from './store-path-resolver';

export interface SessionMessage {
  role: 'user' | 'assistant';
  text: string;
  timestampMs: number;
  /** 'feishu' | 'vscode' */
  source: 'feishu' | 'vscode';
}

export interface FeishuSession {
  id: string;
  /** Feishu chat_id or open_id used as the session key */
  feishuKey: string;
  label: string;
  selectedAgentId: string;
  createdAt: number;
  lastActiveAt: number;
  messages: SessionMessage[];
  archived: boolean;
}

export interface SessionStoreChangeEvent {
  sessionId: string;
  reason: 'create' | 'append' | 'rename' | 'archive' | 'setSelectedAgent';
  messageSource?: SessionMessage['source'];
}

export interface SessionStoreOptions {
  storePath?: string;
  storeMode?: SessionStoreMode;
}

export class SessionStore {
  private readonly sessions = new Map<string, FeishuSession>();
  private readonly storePath: string;
  private readonly storeMode: SessionStoreMode;

  private readonly _onDidChange = new vscode.EventEmitter<SessionStoreChangeEvent>();
  readonly onDidChange = this._onDidChange.event;

  constructor(context: vscode.ExtensionContext, options?: SessionStoreOptions) {
    this.storePath = options?.storePath ?? path.join(context.globalStorageUri.fsPath, 'sessions.json');
    this.storeMode = options?.storeMode ?? 'editor-local-fallback';
    this.load();
  }

  getStorageInfo(): { storePath: string; storeMode: SessionStoreMode } {
    return {
      storePath: this.storePath,
      storeMode: this.storeMode,
    };
  }

  private normalizeSession(session: FeishuSession): FeishuSession {
    if (!Array.isArray((session as { messages?: unknown }).messages)) {
      session.messages = [];
    }
    if (!session.selectedAgentId) {
      session.selectedAgentId = SUPERPOWERS_DEFAULT_AGENT_ID;
    }
    return session;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        const data = JSON.parse(raw) as FeishuSession[];
        for (const s of data) {
          this.sessions.set(s.id, this.normalizeSession(s));
        }
      }
    } catch {
      // corrupt data – start fresh
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify([...this.sessions.values()], null, 2), 'utf8');
    } catch {
      // best-effort
    }
  }

  /** Return all non-archived sessions sorted newest first */
  list(): FeishuSession[] {
    return [...this.sessions.values()]
      .map(s => this.normalizeSession(s))
      .filter(s => !s.archived)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /** Return all sessions including archived */
  listAll(): FeishuSession[] {
    return [...this.sessions.values()]
      .map(s => this.normalizeSession(s))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  get(id: string): FeishuSession | undefined {
    const s = this.sessions.get(id);
    return s ? this.normalizeSession(s) : undefined;
  }

  /** Find or create a session by feishu key (chat_id / open_id) */
  getOrCreate(feishuKey: string, label: string): FeishuSession {
    for (const s of this.sessions.values()) {
      if (s.feishuKey === feishuKey && !s.archived) {
        return s;
      }
    }
    const id = `feishu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const session: FeishuSession = {
      id,
      feishuKey,
      label,
      selectedAgentId: SUPERPOWERS_DEFAULT_AGENT_ID,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: [],
      archived: false,
    };
    this.sessions.set(id, session);
    this.persist();
    this._onDidChange.fire({ sessionId: id, reason: 'create' });
    return session;
  }

  appendMessage(sessionId: string, msg: SessionMessage): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return;
    }
    s.messages.push(msg);
    s.lastActiveAt = msg.timestampMs;
    this.persist();
    this._onDidChange.fire({ sessionId, reason: 'append', messageSource: msg.source });
  }

  rename(sessionId: string, label: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return;
    }
    s.label = label;
    this.persist();
    this._onDidChange.fire({ sessionId, reason: 'rename' });
  }

  archive(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return;
    }
    s.archived = true;
    this.persist();
    this._onDidChange.fire({ sessionId, reason: 'archive' });
  }

  setSelectedAgent(sessionId: string, agentId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return;
    }
    s.selectedAgentId = agentId;
    s.lastActiveAt = Date.now();
    this.persist();
    this._onDidChange.fire({ sessionId, reason: 'setSelectedAgent' });
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
