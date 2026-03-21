export interface WalletCreateInput {
  userId: string;
  chain: string;
  address?: string;
  walletType: 'ton' | 'evm' | 'smart_wallet' | 'panorama_wallet';
  metadata?: Record<string, unknown>;
}

export interface WalletLinkInput extends WalletCreateInput {
  address: string;
  providerWalletId?: string;
  publicKey?: string;
}

export interface WalletCreateResult {
  address?: string;
  providerWalletId?: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
}

export interface SignaturePayload {
  message: string;
  typedData?: Record<string, unknown>;
}

export interface WalletSessionRegistrationInput {
  chain: string;
  sessionId?: string;
  delegationId?: string;
  publicKey?: string;
  expiresAt?: string;
  capabilities?: string[];
  allowedChains?: number[];
  metadata?: Record<string, unknown>;
}

export interface WalletSessionRegistrationResult {
  providerSessionId?: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface SignedIntentInput {
  intentId: string;
  signature: string;
}

export interface ExecutionPlanInput {
  intentId: string;
  walletAddress: string;
  signedIntent: string;
  txData: Record<string, unknown>;
  route?: Record<string, unknown>;
  action?: 'swap' | 'stake' | 'supply' | 'withdraw' | 'borrow' | 'repay';
  chainId?: number;
  walletMetadata?: Record<string, unknown>;
}

export interface ExecutionResult {
  status: 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  providerReference?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface WalletExecutionContext {
  walletAddress: string;
  provider: string;
  providerWalletId?: string;
  capabilities: string[];
}

export type WalletExecutionStrategy = 'client' | 'delegated' | 'hybrid';

export interface ExecutionEligibilityInput {
  walletAddress: string;
  action: 'swap' | 'stake' | 'supply' | 'withdraw' | 'borrow' | 'repay';
  chainId?: number;
  metadata?: Record<string, unknown>;
}

export interface WalletProviderAdapterPort {
  readonly provider: 'thirdweb' | 'wdk';
  createWallet(input: WalletCreateInput): Promise<WalletCreateResult>;
  linkWallet(input: WalletLinkInput): Promise<WalletCreateResult>;
  registerSession(input: WalletSessionRegistrationInput, metadata?: Record<string, unknown>): Promise<WalletSessionRegistrationResult>;
  prepareSignature(intentId: string, payload: Record<string, unknown>): Promise<SignaturePayload>;
  signIntent(input: SignedIntentInput): Promise<{ signedIntent: string }>;
  assertExecutionAllowed(input: ExecutionEligibilityInput): Promise<void>;
  executePlan(input: ExecutionPlanInput): Promise<ExecutionResult>;
  getExecutionContext(walletAddress: string, metadata?: Record<string, unknown>): Promise<WalletExecutionContext>;
  getExecutionStrategy(metadata?: Record<string, unknown>): WalletExecutionStrategy;
}
