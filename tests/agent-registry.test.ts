import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/agent/agent-registry';

describe('AgentRegistry with canonical superpowers agents', () => {
  it('exposes canonical runnable agent ids', () => {
    const registry = new AgentRegistry({
      loader: {
        loadSkillPrompt: (skillFolder: string) => `prompt:${skillFolder}`,
      },
    });

    const ids = registry.listRunnable().map(a => a.id);
    expect(ids).toEqual([
      'brainstorming',
      'tdd',
      'debug',
      'plan',
      'execute',
      'subagent',
      'parallel',
      'review',
      'receive-review',
      'verify',
      'worktree',
      'finish',
      'write-skill',
      'superpowers',
    ]);
  });

  it('formats feishu list as runnable-only without participant placeholders', () => {
    const registry = new AgentRegistry({
      loader: {
        loadSkillPrompt: (skillFolder: string) => `prompt:${skillFolder}`,
      },
    });

    const text = registry.formatForFeishu('debug');
    expect(text).toContain('debug *current*');
    expect(text).not.toContain('visible-only');
    expect(text).not.toContain('participant:');
  });

  it('returns superpowers as default agent id', () => {
    const registry = new AgentRegistry({
      loader: {
        loadSkillPrompt: (skillFolder: string) => `prompt:${skillFolder}`,
      },
    });

    expect(registry.getDefaultAgentId()).toBe('superpowers');
  });
});
