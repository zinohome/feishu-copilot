import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SUPERPOWERS_DEFAULT_AGENT_ID } from '../agent/superpowers-agent-presets';

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

export class SessionStore {
  private readonly sessions = new Map<string, FeishuSession>();
  private readonly storePath: string;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(context: vscode.ExtensionContext) {
    this.storePath = path.join(context.globalStorageUri.fsPath, 'sessions.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        const data = JSON.parse(raw) as FeishuSession[];
        for (const s of data) {
          if (!s.selectedAgentId) {
            s.selectedAgentId = SUPERPOWERS_DEFAULT_AGENT_ID;
          }
          this.sessions.set(s.id, s);
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
      .filter(s => !s.archived)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /** Return all sessions including archived */
  listAll(): FeishuSession[] {
    return [...this.sessions.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  get(id: string): FeishuSession | undefined {
    return this.sessions.get(id);
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
    this._onDidChange.fire();
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
    this._onDidChange.fire();
  }

  rename(sessionId: string, label: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return;
    }
    s.label = label;
    this.persist();
    this._onDidChange.fire();
  }

  archive(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return;
    }
    s.archived = true;
    this.persist();
    this._onDidChange.fire();
  }

  setSelectedAgent(sessionId: string, agentId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return;
    }
    s.selectedAgentId = agentId;
    s.lastActiveAt = Date.now();
    this.persist();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
