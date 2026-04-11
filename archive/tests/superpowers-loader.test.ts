import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SuperpowersLoader } from '../archive/src/agent/superpowers-loader';

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('SuperpowersLoader', () => {
  it('loads prompt from agents/*.agent.md layout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-agents-'));
    tempDirs.push(root);
    const agentsDir = path.join(root, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'brainstorming.agent.md'), 'brainstorming prompt', 'utf8');

    const loader = new SuperpowersLoader(root);
    expect(loader.loadSkillPrompt('brainstorming')).toBe('brainstorming prompt');
  });

  it('supports alias from writing-skills to writing-agents', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-alias-'));
    tempDirs.push(root);
    const agentsDir = path.join(root, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'writing-agents.agent.md'), 'writing agents prompt', 'utf8');

    const loader = new SuperpowersLoader(root);
    expect(loader.loadSkillPrompt('writing-skills')).toBe('writing agents prompt');
  });

  it('expands ~/ source path to home directory', () => {
    const dirName = `.sp-loader-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const root = path.join(os.homedir(), dirName);
    tempDirs.push(root);
    const agentsDir = path.join(root, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'brainstorming.agent.md'), 'home path prompt', 'utf8');

    const loader = new SuperpowersLoader(`~/${dirName}`);
    expect(loader.loadSkillPrompt('brainstorming')).toBe('home path prompt');
  });
});
