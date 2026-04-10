export interface BridgeConfig {
  ownerOpenId: string;
  workspaceAllowlist: string[];
  approvalTimeoutMs: number;
  cardPatchIntervalMs: number;
}
