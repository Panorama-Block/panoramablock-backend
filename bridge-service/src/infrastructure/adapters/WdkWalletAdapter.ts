import {
  ExecutionEligibilityInput,
  WalletExecutionStrategy,
  WalletCreateInput,
  WalletCreateResult,
  ExecutionPlanInput,
  ExecutionResult,
  SignaturePayload,
  SignedIntentInput,
  WalletLinkInput,
  WalletSessionRegistrationInput,
  WalletSessionRegistrationResult,
  WalletExecutionContext,
  WalletProviderAdapterPort,
} from '../../domain/ports/WalletProviderAdapterPort';
import { randomUUID } from 'crypto';
import { HDNodeWallet, JsonRpcProvider, TransactionRequest, Wallet } from 'ethers';
import { BridgeRuntimeConfig, createBridgeRuntimeConfigFromEnv, resolveRpcUrl } from '../../config/runtime';

type SupportedChain = 'evm' | 'ton';

type WdkWalletAdapterOptions = {
  supportedChains?: SupportedChain[];
  evmRpcUrl?: string;
  tonRpcUrl?: string;
  seed?: string;
  requireSession?: boolean;
  simulateExecution?: boolean;
  runtimeConfig?: BridgeRuntimeConfig;
};

type WdkSessionRecord = {
  sessionId?: string;
  delegationId?: string;
  expiresAt?: string;
  capabilities: string[];
  allowedChains?: number[];
  publicKey?: string;
  metadata?: Record<string, unknown>;
};

export class WdkWalletAdapter implements WalletProviderAdapterPort {
  readonly provider = 'wdk' as const;
  private readonly supportedChains: SupportedChain[];
  private readonly requireSession: boolean;
  private readonly simulateExecution: boolean;
  private readonly runtimeConfigured: boolean;
  private readonly chainConfig: Record<SupportedChain, { rpcUrl?: string }>;
  private readonly runtimeConfig: BridgeRuntimeConfig;

  constructor(options: WdkWalletAdapterOptions = {}) {
    const supportedChains = options.supportedChains || this.parseSupportedChains(process.env.WDK_SUPPORTED_CHAINS || 'evm,ton');
    this.supportedChains = supportedChains;
    this.requireSession = options.requireSession ?? process.env.WDK_REQUIRE_SESSION !== 'false';
    this.simulateExecution = options.simulateExecution ?? process.env.WDK_SIMULATE_EXECUTION === 'true';
    this.runtimeConfig = options.runtimeConfig || createBridgeRuntimeConfigFromEnv();
    this.chainConfig = {
      evm: { rpcUrl: options.evmRpcUrl || process.env.WDK_EVM_RPC_URL },
      ton: { rpcUrl: options.tonRpcUrl || process.env.WDK_TON_RPC_URL },
    };

    for (const chain of this.supportedChains) {
      if (!this.chainConfig[chain].rpcUrl) {
        throw new Error(`WDK_${chain.toUpperCase()}_RPC_URL is required when ${chain} support is enabled`);
      }
    }

    this.runtimeConfigured = Boolean(options.seed || process.env.WDK_SEED);
  }

  async createWallet(input: WalletCreateInput): Promise<WalletCreateResult> {
    throw this.createProviderError(409, 'WDK_LINK_REQUIRED', 'WDK wallets are client-managed. Use wallet link/register instead of create.');
  }

  async linkWallet(input: WalletLinkInput): Promise<WalletCreateResult> {
    const chainFamily = this.resolveChainFamily(input.chain, input.walletType);
    this.assertChainSupported(chainFamily);
    this.assertAddress(input.address, chainFamily);

    if (chainFamily === 'ton' && !input.publicKey && typeof input.metadata?.publicKey !== 'string') {
      throw this.createProviderError(400, 'WDK_PUBLIC_KEY_REQUIRED', 'publicKey is required to link TON WDK wallets.');
    }

    return {
      address: input.address,
      providerWalletId: input.providerWalletId || `${input.chain.toLowerCase()}:${input.address.toLowerCase()}`,
      metadata: {
        mode: 'client-managed',
        chainFamily,
        runtimeConfigured: this.runtimeConfigured,
        supportedChains: this.supportedChains,
      },
    };
  }

  async registerSession(
    input: WalletSessionRegistrationInput,
    metadata?: Record<string, unknown>
  ): Promise<WalletSessionRegistrationResult> {
    const chainFamily = this.resolveChainFamily(input.chain);
    this.assertChainSupported(chainFamily);

    const capabilities = Array.isArray(input.capabilities) && input.capabilities.length > 0
      ? input.capabilities
      : ['sign_intent', 'execute_swap', 'execute_stake', 'execute_lending'];

    if (!input.sessionId && !input.delegationId) {
      throw this.createProviderError(400, 'WDK_SESSION_ID_REQUIRED', 'sessionId or delegationId is required for WDK session registration.');
    }

    if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
      throw this.createProviderError(400, 'WDK_SESSION_INVALID', 'expiresAt must be a valid ISO timestamp.');
    }

    return {
      providerSessionId: input.sessionId || input.delegationId,
      capabilities,
      metadata: {
        ...(metadata || {}),
        wdk: {
          ...(((metadata || {}).wdk as Record<string, unknown>) || {}),
          chainFamily,
          session: {
            sessionId: input.sessionId,
            delegationId: input.delegationId,
            expiresAt: input.expiresAt,
            capabilities,
            allowedChains: input.allowedChains,
            publicKey: input.publicKey,
            ...(input.metadata || {}),
          },
          runtimeConfigured: this.runtimeConfigured,
        },
      },
    };
  }

  async prepareSignature(intentId: string, payload: Record<string, unknown>): Promise<SignaturePayload> {
    return {
      message: `Approve Panorama intent ${intentId}`,
      typedData: payload,
    };
  }

  async signIntent(input: SignedIntentInput): Promise<{ signedIntent: string }> {
    return {
      signedIntent: input.signature,
    };
  }

  async assertExecutionAllowed(input: ExecutionEligibilityInput): Promise<void> {
    const metadata = (input.metadata || {}) as Record<string, unknown>;
    const session = this.readSession(metadata);

    if (this.requireSession && !session) {
      throw this.createProviderError(409, 'WDK_SESSION_REQUIRED', 'A WDK delegated session must be registered before execution.');
    }
    if (!session) {
      return;
    }

    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      throw this.createProviderError(409, 'WDK_SESSION_EXPIRED', 'The registered WDK session has expired.');
    }

    if (
      typeof input.chainId === 'number' &&
      Array.isArray(session.allowedChains) &&
      session.allowedChains.length > 0 &&
      !session.allowedChains.includes(input.chainId)
    ) {
      throw this.createProviderError(403, 'WDK_SESSION_CHAIN_DENIED', `The registered WDK session does not allow chain ${input.chainId}.`);
    }

    const requiredCapability = this.requiredCapabilityForAction(input.action);
    if (requiredCapability && !session.capabilities.includes(requiredCapability)) {
      throw this.createProviderError(403, 'WDK_SESSION_CAPABILITY_DENIED', `The registered WDK session does not allow ${input.action}.`);
    }
  }

  async executePlan(input: ExecutionPlanInput): Promise<ExecutionResult> {
    await this.assertExecutionAllowed({
      walletAddress: input.walletAddress,
      action: input.action || 'swap',
      chainId: input.chainId,
      metadata: input.walletMetadata,
    });

    if (!this.runtimeConfigured && !this.simulateExecution) {
      throw this.createProviderError(
        503,
        'WDK_RUNTIME_UNAVAILABLE',
        'WDK runtime is not configured for backend execution. Configure WDK_SEED or enable WDK_SIMULATE_EXECUTION for development.'
      );
    }

    const session = this.readSession((input.walletMetadata || {}) as Record<string, unknown>);

    if (!this.simulateExecution) {
      const chainId = Number(input.chainId || this.extractChainId(input));
      if (!chainId || Number.isNaN(chainId)) {
        throw this.createProviderError(400, 'WDK_CHAIN_ID_REQUIRED', 'chainId is required for live WDK execution.');
      }

      const transactions = this.extractTransactions(input, chainId);
      if (transactions.length === 0) {
        throw this.createProviderError(400, 'WDK_TXDATA_REQUIRED', 'No executable transaction payload was provided by the prepared swap plan.');
      }

      const signer = this.createEvmSigner(chainId);
      if (signer.address.toLowerCase() !== input.walletAddress.toLowerCase()) {
        throw this.createProviderError(
          409,
          'WDK_SIGNER_MISMATCH',
          `Configured WDK signer ${signer.address} does not match linked wallet ${input.walletAddress}.`
        );
      }

      const txHashes: string[] = [];
      for (const tx of transactions) {
        const submitted = await signer.sendTransaction(this.normalizeTransaction(tx));
        txHashes.push(submitted.hash);
      }

      return {
        status: 'submitted',
        txHash: txHashes[txHashes.length - 1],
        providerReference: session?.sessionId || session?.delegationId || input.intentId,
        metadata: {
          mode: 'wdk-runtime',
          action: input.action || 'swap',
          allTxHashes: txHashes,
          transactionsCount: txHashes.length,
        },
      };
    }

    return {
      status: 'submitted',
      txHash: this.simulateExecution ? `wdk-sim-${randomUUID()}` : undefined,
      providerReference: session?.sessionId || session?.delegationId || input.intentId,
      metadata: {
        mode: this.simulateExecution ? 'wdk-simulated' : 'wdk-runtime',
        action: input.action || 'swap',
      },
    };
  }

  async getExecutionContext(walletAddress: string, metadata?: Record<string, unknown>): Promise<WalletExecutionContext> {
    const session = this.readSession(metadata || {});
    const capabilities = session?.capabilities || ['sign_intent'];

    return {
      walletAddress,
      provider: this.provider,
      providerWalletId: typeof metadata?.providerWalletId === 'string' ? metadata.providerWalletId : undefined,
      capabilities,
    };
  }

  getExecutionStrategy(metadata?: Record<string, unknown>): WalletExecutionStrategy {
    if (this.hasDelegatedAuthority((metadata || {}) as Record<string, unknown>)) {
      return 'delegated';
    }

    return 'client';
  }

  private parseSupportedChains(value: string): SupportedChain[] {
    const parsed = value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item): item is SupportedChain => item === 'evm' || item === 'ton');
    return parsed.length > 0 ? parsed : ['evm'];
  }

  private resolveChainFamily(chain: string, walletType?: string): SupportedChain {
    const normalizedChain = chain.toLowerCase();
    if (walletType === 'ton' || normalizedChain.includes('ton')) {
      return 'ton';
    }
    return 'evm';
  }

  private assertChainSupported(chainFamily: SupportedChain): void {
    if (!this.supportedChains.includes(chainFamily)) {
      throw this.createProviderError(400, 'WDK_CHAIN_UNSUPPORTED', `WDK is not configured for ${chainFamily} wallets.`);
    }
  }

  private assertAddress(address: string, chainFamily: SupportedChain): void {
    if (!address || address.trim().length === 0) {
      throw this.createProviderError(400, 'WDK_ADDRESS_REQUIRED', 'address is required to link a WDK wallet.');
    }
    if (chainFamily === 'evm' && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw this.createProviderError(400, 'WDK_INVALID_ADDRESS', 'EVM wallet address must be a valid 20-byte hex address.');
    }
  }

  private readSession(metadata: Record<string, unknown>): WdkSessionRecord | null {
    const wdk = (metadata.wdk || {}) as Record<string, unknown>;
    const session = (wdk.session || metadata.session || {}) as Record<string, unknown>;
    const capabilities = Array.isArray(session.capabilities)
      ? session.capabilities.map(String)
      : [];

    if (!session.sessionId && !session.delegationId && capabilities.length === 0 && !session.expiresAt) {
      return null;
    }

    return {
      sessionId: typeof session.sessionId === 'string' ? session.sessionId : undefined,
      delegationId: typeof session.delegationId === 'string' ? session.delegationId : undefined,
      expiresAt: typeof session.expiresAt === 'string' ? session.expiresAt : undefined,
      capabilities,
      allowedChains: Array.isArray(session.allowedChains) ? session.allowedChains.map((value) => Number(value)) : undefined,
      publicKey: typeof session.publicKey === 'string' ? session.publicKey : undefined,
      metadata: session,
    };
  }

  private hasDelegatedAuthority(metadata: Record<string, unknown>): boolean {
    const session = this.readSession(metadata);
    return Boolean(session?.sessionId || session?.delegationId);
  }

  private requiredCapabilityForAction(action: ExecutionEligibilityInput['action']): string {
    switch (action) {
      case 'swap':
        return 'execute_swap';
      case 'stake':
      case 'request_unlock':
      case 'redeem':
        return 'execute_stake';
      case 'supply':
      case 'withdraw':
      case 'borrow':
      case 'repay':
        return 'execute_lending';
      default:
        return '';
    }
  }

  private createProviderError(status: number, code: string, message: string): Error & { status: number; code: string } {
    const error = new Error(message) as Error & { status: number; code: string };
    error.status = status;
    error.code = code;
    return error;
  }

  private extractChainId(input: ExecutionPlanInput): number | undefined {
    const txData = input.txData || {};
    const route = (input.route || {}) as Record<string, unknown>;
    const routeTransactions = Array.isArray(route.transactions) ? route.transactions : [];
    return Number((txData.chainId as number | string | undefined) || ((routeTransactions[0] as any)?.chainId));
  }

  private extractTransactions(input: ExecutionPlanInput, chainId: number): Array<Record<string, unknown>> {
    const route = (input.route || {}) as Record<string, unknown>;
    const routeTransactions = Array.isArray(route.transactions) ? route.transactions : [];

    if (routeTransactions.length > 0) {
      return routeTransactions
        .map((transaction) => transaction as Record<string, unknown>)
        .filter((transaction) => Number(transaction.chainId || chainId) === chainId);
    }

    return Object.keys(input.txData || {}).length > 0 ? [input.txData] : [];
  }

  private createEvmSigner(chainId: number): Wallet | HDNodeWallet {
    const rpcUrl = this.resolveRpcUrl(chainId);
    if (!rpcUrl) {
      throw this.createProviderError(503, 'WDK_RPC_UNAVAILABLE', `No RPC URL configured for chainId ${chainId}.`);
    }

    const seed = process.env.WDK_SEED || '';
    if (!seed) {
      throw this.createProviderError(503, 'WDK_RUNTIME_UNAVAILABLE', 'WDK_SEED is required for live backend execution.');
    }

    const provider = new JsonRpcProvider(rpcUrl);
    if (/^0x[a-fA-F0-9]{64}$/.test(seed.trim())) {
      return new Wallet(seed.trim(), provider);
    }

    return HDNodeWallet.fromPhrase(seed.trim()).connect(provider);
  }

  private resolveRpcUrl(chainId: number): string | undefined {
    const byChainId = process.env[`WDK_RPC_${chainId}`];
    if (byChainId) {
      return byChainId;
    }
    return resolveRpcUrl(chainId, this.runtimeConfig) || this.chainConfig.evm.rpcUrl;
  }

  private normalizeTransaction(transaction: Record<string, unknown>): TransactionRequest {
    const normalized: TransactionRequest = {
      to: typeof transaction.to === 'string' ? transaction.to : undefined,
      data: typeof transaction.data === 'string' ? transaction.data : undefined,
      value: this.normalizeBigNumberish(transaction.value),
      gasLimit: this.normalizeBigNumberish(transaction.gasLimit),
      gasPrice: this.normalizeBigNumberish(transaction.gasPrice),
      maxFeePerGas: this.normalizeBigNumberish(transaction.maxFeePerGas),
      maxPriorityFeePerGas: this.normalizeBigNumberish(transaction.maxPriorityFeePerGas),
      nonce: typeof transaction.nonce === 'number' ? transaction.nonce : undefined,
      chainId: typeof transaction.chainId === 'number' ? transaction.chainId : undefined,
    };

    return normalized;
  }

  private normalizeBigNumberish(value: unknown): bigint | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      return BigInt(value);
    }
    if (typeof value === 'string') {
      return BigInt(value);
    }
    return undefined;
  }
}
