/**
 * DCA Capability Port — domain contract for ERC-4337 automation providers.
 *
 * Every automation adapter (ERC4337, future custodial, etc.) implements IDCAProvider.
 * The capability slug is "automation" (CAPABILITY_SLUGS), matching the sprint naming.
 *
 * Invariant: session keys NEVER appear in method return types. Any method that internally
 * retrieves a session key must consume it and return only on-chain artifacts (tx hashes, addresses).
 */

import type { ICapabilityProvider, ProviderHealth } from '@panorama/capability';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface SmartAccountPermissions {
  approvedTargets: string[];
  nativeTokenLimitPerTransaction: string;
  startTimestamp: number;
  endTimestamp: number;
}

export interface SmartAccount {
  address: string;
  userId: string;
  name: string;
  createdAt: number;
  sessionKeyAddress: string;
  expiresAt: number;
  permissions: SmartAccountPermissions;
}

export interface DCAStrategyRecord {
  strategyId: string;
  smartAccountId: string;
  fromToken: string;
  toToken: string;
  fromChainId: number;
  toChainId: number;
  amount: string;
  interval: 'daily' | 'weekly' | 'monthly';
  lastExecuted: number;
  nextExecution: number;
  isActive: boolean;
}

export interface ExecutionHistoryEntry {
  timestamp: number;
  txHash: string;
  amount: string;
  fromToken: string;
  toToken: string;
  status: 'success' | 'failed';
  error?: string;
}

// ─── Request types ────────────────────────────────────────────────────────────

export interface CreateAccountReq {
  userId: string;
  name: string;
  permissions: {
    approvedTargets: string[];
    nativeTokenLimit: string;
    durationDays: number;
  };
}

export interface CreateStrategyReq {
  /** Required for non-Base chains (smart account DCA). */
  smartAccountId?: string;
  /** Required for Base chain (DCAVault, non-custodial). */
  userAddress?: string;
  /** Optional upfront deposit amount for DCAVault orders. */
  depositAmount?: string;
  fromToken: string;
  toToken: string;
  fromChainId: number;
  toChainId: number;
  amount: string;
  interval: 'daily' | 'weekly' | 'monthly';
}

export interface SignAndExecuteReq {
  smartAccountAddress: string;
  userId: string;
  to: string;
  /** Amount in native token units (e.g. ETH). */
  value: string;
  chainId: number;
  data?: string;
}

export interface ValidatePermissionsReq {
  smartAccountAddress: string;
  to: string;
  value: string;
}

export interface WithdrawReq {
  smartAccountAddress: string;
  userId: string;
  tokenAddress: string;
  amount: string;
  decimals?: number;
  chainId: number;
}

export interface SupportsRouteParams {
  fromChainId: number;
  toChainId: number;
  fromToken?: string;
  toToken?: string;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface CreateAccountResult {
  smartAccountAddress: string;
  sessionKeyAddress: string;
  expiresAt: Date;
}

/** Discriminated union: direct DB strategy vs unsigned vault bundle. */
export type CreateStrategyResult =
  | {
      type: 'created';
      strategyId: string;
      nextExecution: Date;
    }
  | {
      type: 'vault_unsigned';
      steps: unknown[];
      description: string;
      metadata: unknown;
    };

export interface GetStrategiesResult {
  strategies: DCAStrategyRecord[];
  vaultOrders: unknown[];
}

export interface GetHistoryResult {
  history: ExecutionHistoryEntry[];
  vaultHistory: unknown[];
}

export interface ScheduledExecutionResult {
  transactionHash: string;
  chainId: number;
  status: 'submitted' | 'confirmed' | 'failed';
  executedAt: string;
  strategyId?: string;
  gasUsed?: string;
}

export type TransactionResult = ScheduledExecutionResult;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ─── Provider port ────────────────────────────────────────────────────────────

/**
 * IDCAProvider — capability port for all DCA / automation adapters.
 *
 * Extends ICapabilityProvider, which mandates:
 *   - `readonly name: string`
 *   - `readonly metadata: ProviderMetadata` (capability: "automation")
 *   - optional `healthCheck(): Promise<ProviderHealth>`
 */
export interface IDCAProvider extends ICapabilityProvider {
  // ── Smart account lifecycle ──────────────────────────────────────────────────
  createAccount(req: CreateAccountReq): Promise<CreateAccountResult>;
  getAccount(address: string): Promise<SmartAccount | null>;
  getUserAccounts(userId: string): Promise<SmartAccount[]>;

  // ── Strategy management ──────────────────────────────────────────────────────
  createStrategy(req: CreateStrategyReq): Promise<CreateStrategyResult>;
  getStrategies(smartAccountId: string): Promise<GetStrategiesResult>;
  toggleStrategy(id: string, active: boolean): Promise<void>;
  deleteStrategy(id: string): Promise<void>;
  getHistory(smartAccountId: string, limit?: number): Promise<GetHistoryResult>;

  // ── Transaction execution ────────────────────────────────────────────────────
  signAndExecute(req: SignAndExecuteReq): Promise<TransactionResult>;
  validatePermissions(req: ValidatePermissionsReq): Promise<ValidationResult>;
  withdraw(req: WithdrawReq): Promise<TransactionResult>;

  // ── Routing & health ─────────────────────────────────────────────────────────
  supportsRoute(params: SupportsRouteParams): Promise<boolean>;
  healthCheck(): Promise<ProviderHealth>;
}
