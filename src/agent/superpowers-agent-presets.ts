export interface SuperpowersAgentPreset {
  id: string;
  displayName: string;
  description: string;
  skillFolder: string;
}

export const SUPERPOWERS_DEFAULT_AGENT_ID = 'superpowers';

export const SUPERPOWERS_AGENT_PRESETS: SuperpowersAgentPreset[] = [
  {
    id: 'brainstorming',
    displayName: 'Brainstorming',
    description: 'Design and spec a feature through collaborative dialogue before coding.',
    skillFolder: 'brainstorming',
  },
  {
    id: 'tdd',
    displayName: 'Test-Driven Development',
    description: 'Implement features using test-driven development.',
    skillFolder: 'test-driven-development',
  },
  {
    id: 'debug',
    displayName: 'Systematic Debugging',
    description: 'Debug bugs and unexpected behavior methodically.',
    skillFolder: 'systematic-debugging',
  },
  {
    id: 'plan',
    displayName: 'Writing Plans',
    description: 'Write a complete implementation plan from requirements.',
    skillFolder: 'writing-plans',
  },
  {
    id: 'execute',
    displayName: 'Executing Plans',
    description: 'Execute an existing implementation plan step by step.',
    skillFolder: 'executing-plans',
  },
  {
    id: 'subagent',
    displayName: 'Subagent-Driven Development',
    description: 'Dispatch focused subagents per task with review gates.',
    skillFolder: 'subagent-driven-development',
  },
  {
    id: 'parallel',
    displayName: 'Dispatching Parallel Agents',
    description: 'Run independent tasks in parallel when safe.',
    skillFolder: 'dispatching-parallel-agents',
  },
  {
    id: 'review',
    displayName: 'Requesting Code Review',
    description: 'Prepare work and request high-signal code review.',
    skillFolder: 'requesting-code-review',
  },
  {
    id: 'receive-review',
    displayName: 'Receiving Code Review',
    description: 'Process and validate incoming review feedback rigorously.',
    skillFolder: 'receiving-code-review',
  },
  {
    id: 'verify',
    displayName: 'Verification Before Completion',
    description: 'Verify evidence before claiming work complete.',
    skillFolder: 'verification-before-completion',
  },
  {
    id: 'worktree',
    displayName: 'Using Git Worktrees',
    description: 'Create isolated worktrees for feature execution.',
    skillFolder: 'using-git-worktrees',
  },
  {
    id: 'finish',
    displayName: 'Finishing Development Branch',
    description: 'Finalize implementation and choose merge/PR strategy.',
    skillFolder: 'finishing-a-development-branch',
  },
  {
    id: 'write-skill',
    displayName: 'Writing Skills',
    description: 'Create and maintain reusable SKILL modules.',
    skillFolder: 'writing-skills',
  },
  {
    id: 'superpowers',
    displayName: 'Using Superpowers',
    description: 'Learn and apply Superpowers workflows effectively.',
    skillFolder: 'using-superpowers',
  },
];
