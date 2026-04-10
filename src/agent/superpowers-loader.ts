import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SuperpowersSkillLoader {
  loadSkillPrompt(skillFolder: string): string | undefined;
}

export class SuperpowersLoader implements SuperpowersSkillLoader {
  private readonly rootPath: string;

  constructor(sourcePath?: string) {
    this.rootPath = sourcePath?.trim() || this.autoDetectRootPath() || '';
  }

  loadSkillPrompt(skillFolder: string): string | undefined {
    if (!this.rootPath) {
      return undefined;
    }

    const filePath = path.join(this.rootPath, 'skills', skillFolder, 'SKILL.md');
    try {
      if (!fs.existsSync(filePath)) {
        return undefined;
      }
      const text = fs.readFileSync(filePath, 'utf8').trim();
      return text || undefined;
    } catch {
      return undefined;
    }
  }

  private autoDetectRootPath(): string | undefined {
    const extRoot = path.join(os.homedir(), '.vscode', 'extensions');
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
}
