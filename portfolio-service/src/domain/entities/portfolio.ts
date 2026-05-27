export interface PositionEntry {
  capability: string;
  provider: string;
  chainId: number;
  asset: string;
  balanceWei: string;
  valueUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface CapabilityPosition {
  capability: string;
  positions: PositionEntry[];
  totalValueUsd: number;
}

export interface PortfolioSummary {
  userAddress: string;
  chainId?: number;
  capabilities: CapabilityPosition[];
  totalValueUsd: number;
  generatedAt: string;
}
