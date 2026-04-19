export type StrategyActionType = 'swap' | 'lending' | 'liquid_staking' | 'liquidity_pool';

export interface SmartAccountPermissions {
  approvedTargets: string[];
  nativeTokenLimitPerTransaction: string;
  startTimestamp: number;
  endTimestamp: number;
}

export interface SmartAccountData {
  address: string;
  userId: string;
  name: string;
  createdAt: number;
  sessionKeyAddress: string;
  expiresAt: number;
  permissions: SmartAccountPermissions;
}

export interface DCAStrategy {
  strategyId?: string;
  smartAccountId: string;
  actionType: StrategyActionType;
  fromToken: string;
  toToken: string;
  fromChainId: number;
  toChainId: number;
  amount: string;
  interval: 'daily' | 'weekly' | 'monthly';
  lastExecuted: number;
  nextExecution: number;
  isActive: boolean;
  // Lending-specific
  protocol?: string;
  lendingAction?: 'supply' | 'borrow';
  // LP-specific
  amountB?: string;
  tokenB?: string;
}

export interface ExecutionHistory {
  timestamp: number;
  txHash: string;
  amount: string;
  fromToken: string;
  toToken: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface CreateSmartAccountRequest {
  userId: string;
  name: string;
  permissions: {
    approvedTargets: string[];
    nativeTokenLimit: string;
    durationDays: number;
  };
}

export interface CreateStrategyRequest {
  smartAccountId: string;
  actionType?: StrategyActionType; // defaults to 'swap' for backwards compat
  fromToken: string;
  toToken: string;
  fromChainId: number;
  toChainId: number;
  amount: string;
  interval: 'daily' | 'weekly' | 'monthly';
  // Lending-specific
  protocol?: string;
  action?: 'supply' | 'borrow';
  // LP-specific
  amountB?: string;
  tokenB?: string;
}
