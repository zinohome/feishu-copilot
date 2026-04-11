import {
  SUPERPOWERS_AGENT_PRESETS,
  SUPERPOWERS_DEFAULT_AGENT_ID,
} from './superpowers-agent-presets';
import { SuperpowersLoader, type SuperpowersSkillLoader } from './superpowers-loader';

export interface AgentDefinition {
  id: string;
  displayName: string;
  description: string;
  source: 'superpowers';
  runnable: boolean;
  systemPrompt?: string;
}

export interface AgentRegistryOptions {
  superpowersSourcePath?: string;
  loader?: SuperpowersSkillLoader;
}

export class AgentRegistry {
  private readonly allAgents: AgentDefinition[];
  private readonly defaultAgentId: string;

  constructor(options: AgentRegistryOptions = {}) {
    const loader = options.loader ?? new SuperpowersLoader(options.superpowersSourcePath);
    this.allAgents = SUPERPOWERS_AGENT_PRESETS.map(preset => {
      const prompt = loader.loadSkillPrompt(preset.skillFolder);
      return {
        id: preset.id,
        displayName: preset.displayName,
        description: preset.description,
        source: 'superpowers' as const,
        runnable: Boolean(prompt),
        systemPrompt: prompt,
      };
    });

    const canonicalDefault = this.allAgents.find(
      a => a.id === SUPERPOWERS_DEFAULT_AGENT_ID && a.runnable,
    );
    this.defaultAgentId = canonicalDefault?.id ?? this.listRunnable()[0]?.id ?? SUPERPOWERS_DEFAULT_AGENT_ID;
  }

  getDefaultAgentId(): string {
    return this.defaultAgentId;
  }

  listAll(): AgentDefinition[] {
    return this.listRunnable();
  }

  listRunnable(): AgentDefinition[] {
    return this.allAgents.filter(a => a.runnable);
  }

  getById(id: string): AgentDefinition | undefined {
    return this.allAgents.find(a => a.id === id);
  }

  getRunnableById(id: string): AgentDefinition | undefined {
    return this.listRunnable().find(a => a.id === id);
  }

  formatForFeishu(currentId?: string): string {
    const agents = this.listRunnable();
    const lines: string[] = [];
    if (agents.length === 0) {
      lines.push('No runnable agents found.');
      lines.push('Set feishuCopilot.superpowersSourcePath to your Superpowers extension root.');
      return lines.join('\n');
    }

    lines.push('Available agents:');
    for (const agent of agents) {
      const mark = currentId === agent.id ? ' *current*' : '';
      lines.push(`- ${agent.id}${mark}: ${agent.displayName} - ${agent.description}`);
    }
    lines.push('');
    lines.push('Use: /agent use <agentId>');
    return lines.join('\n');
  }
}
