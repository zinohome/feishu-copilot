import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SuperpowersSkillLoader {
  loadSkillPrompt(skillFolder: string): string | undefined;
}

export class SuperpowersLoader implements SuperpowersSkillLoader {
  private readonly rootPath: string;

  constructor(sourcePath?: string) {
    const normalized = this.normalizeSourcePath(sourcePath);
    this.rootPath = normalized || this.autoDetectRootPath() || '';
  }

  loadSkillPrompt(skillFolder: string): string | undefined {
    if (!this.rootPath) {
      return undefined;
    }

    const aliases = this.resolveAliases(skillFolder);
    const candidates: string[] = [];
    for (const name of aliases) {
      candidates.push(path.join(this.rootPath, 'skills', name, 'SKILL.md'));
      candidates.push(path.join(this.rootPath, 'agents', `${name}.agent.md`));
      candidates.push(path.join(this.rootPath, `${name}.agent.md`));
    }

    for (const filePath of candidates) {
      try {
        if (!fs.existsSync(filePath)) {
          continue;
        }
        const text = fs.readFileSync(filePath, 'utf8').trim();
        if (text) {
          return text;
        }
      } catch {
        // continue probing other candidate paths
      }
    }

    return undefined;
  }

  private autoDetectRootPath(): string | undefined {
    const home = os.homedir();
    const preferredRoots = [
      path.join(home, '.superpowers-copilot'),
      path.join(home, '.superpowers-copilot', 'agents'),
    ];

    for (const p of preferredRoots) {
      try {
        if (fs.existsSync(p)) {
          return p;
        }
      } catch {
        // keep probing
      }
    }

    const extRoot = path.join(home, '.vscode', 'extensions');
    try {
      const entries = fs.readdirSync(extRoot, { withFileTypes: true });
      const matches = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith('dwaintr.superpowers-vscode-'))
        .map(entry => entry.name)
        .sort();
      const latest = matches[matches.length - 1];
      return latest ? path.join(extRoot, latest) : undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeSourcePath(sourcePath?: string): string | undefined {
    const raw = sourcePath?.trim();
    if (!raw) {
      return undefined;
    }

    const home = os.homedir();
    if (raw === '~') {
      return home;
    }
    if (raw.startsWith('~/')) {
      return path.join(home, raw.slice(2));
    }
    return raw;
  }

  private resolveAliases(skillFolder: string): string[] {
    const aliases = [skillFolder];
    if (skillFolder === 'writing-skills') {
      aliases.push('writing-agents');
    }
    return aliases;
  }
}
