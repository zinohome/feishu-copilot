export type OperationKind =
  | 'read-only'
  | 'workspace-write'
  | 'command-run'
  | 'external-network'
  | 'git-write'
  | 'session-control';

export interface PermissionDecision {
  requireApproval: boolean;
  hardDenied: boolean;
}

export function classifyOperation(input: {
  kind: OperationKind;
  command?: string;
}): PermissionDecision {
  if (input.kind === 'read-only' || input.kind === 'session-control') {
    return { requireApproval: false, hardDenied: false };
  }

  if (input.kind === 'command-run') {
    const command = input.command ?? '';
    const isHardDenied = /(git\s+reset\s+--hard\b)|(rm\s+-rf\s+\/)/i.test(command);
    if (isHardDenied) {
      return { requireApproval: false, hardDenied: true };
    }
  }

  return { requireApproval: true, hardDenied: false };
}
