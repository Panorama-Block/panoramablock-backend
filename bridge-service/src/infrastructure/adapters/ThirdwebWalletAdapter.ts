import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
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

export class ThirdwebWalletAdapter implements WalletProviderAdapterPort {
  readonly provider = 'thirdweb' as const;
  private readonly engine: AxiosInstance | null;

  constructor(engineUrl?: string, private readonly accessToken?: string) {
    const baseURL = (engineUrl || process.env.THIRDWEB_ENGINE_URL || '').trim().replace(/\/+$/, '');
    this.engine = baseURL
      ? axios.create({
          baseURL,
          timeout: Number(process.env.WALLET_ADAPTER_TIMEOUT_MS || 10000),
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })
      : null;
  }

  async createWallet(input: WalletCreateInput): Promise<WalletCreateResult> {
    const fallbackAddress = input.address || `0x${randomUUID().replace(/-/g, '').slice(0, 40).padEnd(40, '0')}`;
    if (!this.engine) {
      return {
        address: fallbackAddress,
        providerWalletId: `${input.chain.toLowerCase()}:${fallbackAddress.toLowerCase()}`,
        metadata: { mode: 'local-fallback', provider: this.provider },
      };
    }

    const response = await this.engine.post('/wallets', {
      provider: 'thirdweb',
      userId: input.userId,
      chain: input.chain,
      address: input.address,
      walletType: input.walletType,
      metadata: input.metadata || {},
    });

    return {
      address: response.data?.address || fallbackAddress,
      providerWalletId: response.data?.walletId,
      sessionKey: response.data?.sessionKey,
      metadata: response.data?.metadata,
    };
  }

  async linkWallet(input: WalletLinkInput): Promise<WalletCreateResult> {
    return this.createWallet(input);
  }

  async registerSession(
    input: WalletSessionRegistrationInput,
    metadata?: Record<string, unknown>
  ): Promise<WalletSessionRegistrationResult> {
    return {
      providerSessionId: input.sessionId || input.delegationId,
      capabilities: Array.isArray(input.capabilities) && input.capabilities.length > 0
        ? input.capabilities
        : ['sign_intent', 'execute_swap'],
      metadata: {
        ...(metadata || {}),
        thirdwebSession: {
          sessionId: input.sessionId,
          delegationId: input.delegationId,
          expiresAt: input.expiresAt,
          allowedChains: input.allowedChains,
          capabilities: input.capabilities,
          ...(input.metadata || {}),
        },
      },
    };
  }

  async prepareSignature(intentId: string, payload: Record<string, unknown>): Promise<SignaturePayload> {
    return {
      message: `Panorama intent approval\nIntent: ${intentId}\nPayload: ${JSON.stringify(payload)}\nTimestamp: ${Date.now()}`,
    };
  }

  async signIntent(input: SignedIntentInput): Promise<{ signedIntent: string }> {
    return {
      signedIntent: `${input.intentId}:${input.signature}`,
    };
  }

  async assertExecutionAllowed(_input: ExecutionEligibilityInput): Promise<void> {
    const metadata = (_input.metadata || {}) as Record<string, unknown>;
    const session = this.readSession(metadata);
    if (!session) {
      throw this.createProviderError(409, 'DELEGATED_EXECUTION_NOT_AVAILABLE', 'This wallet is not configured for delegated Thirdweb execution.');
    }
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      throw this.createProviderError(409, 'THIRDWEB_SESSION_EXPIRED', 'The registered Thirdweb delegated session has expired.');
    }
    if (
      typeof _input.chainId === 'number' &&
      Array.isArray(session.allowedChains) &&
      session.allowedChains.length > 0 &&
      !session.allowedChains.includes(_input.chainId)
    ) {
      throw this.createProviderError(403, 'THIRDWEB_SESSION_CHAIN_DENIED', `The registered Thirdweb session does not allow chain ${_input.chainId}.`);
    }
    const requiredCapability = this.requiredCapabilityForAction(_input.action);
    if (requiredCapability && !session.capabilities.includes(requiredCapability)) {
      throw this.createProviderError(403, 'THIRDWEB_SESSION_CAPABILITY_DENIED', `The registered Thirdweb session does not allow ${_input.action}.`);
    }
  }

  async executePlan(input: ExecutionPlanInput): Promise<ExecutionResult> {
    if (!input.signedIntent) {
      return { status: 'failed', errorMessage: 'signedIntent is required' };
    }

    if (!this.engine) {
      return {
        status: 'submitted',
        txHash: `sim-${randomUUID()}`,
        metadata: { mode: 'local-fallback', provider: this.provider },
      };
    }

    const response = await this.engine.post('/intents/execute', {
      provider: 'thirdweb',
      intentId: input.intentId,
      walletAddress: input.walletAddress,
      signedIntent: input.signedIntent,
      txData: input.txData,
      route: input.route,
    });

    return {
      status: (response.data?.status || 'submitted') as ExecutionResult['status'],
      txHash: response.data?.txHash,
      providerReference: response.data?.providerReference,
      metadata: response.data?.metadata,
    };
  }

  async getExecutionContext(walletAddress: string, metadata?: Record<string, unknown>): Promise<WalletExecutionContext> {
    const session = this.readSession((metadata || {}) as Record<string, unknown>);
    return {
      walletAddress,
      provider: this.provider,
      providerWalletId: typeof metadata?.providerWalletId === 'string' ? metadata.providerWalletId : undefined,
      capabilities: session?.capabilities?.length ? session.capabilities : ['sign_intent'],
    };
  }

  getExecutionStrategy(_metadata?: Record<string, unknown>): WalletExecutionStrategy {
    if (!this.engine) {
      return 'client';
    }
    return this.hasDelegatedAuthority((_metadata || {}) as Record<string, unknown>) ? 'delegated' : 'client';
  }

  private readSession(metadata: Record<string, unknown>): {
    sessionId?: string;
    delegationId?: string;
    expiresAt?: string;
    allowedChains?: number[];
    capabilities: string[];
  } | null {
    const thirdweb = (metadata.thirdwebSession || metadata.session || {}) as Record<string, unknown>;
    const capabilities = Array.isArray(thirdweb.capabilities) ? thirdweb.capabilities.map(String) : [];
    if (!thirdweb.sessionId && !thirdweb.delegationId && capabilities.length === 0 && !thirdweb.expiresAt) {
      return null;
    }
    return {
      sessionId: typeof thirdweb.sessionId === 'string' ? thirdweb.sessionId : undefined,
      delegationId: typeof thirdweb.delegationId === 'string' ? thirdweb.delegationId : undefined,
      expiresAt: typeof thirdweb.expiresAt === 'string' ? thirdweb.expiresAt : undefined,
      allowedChains: Array.isArray(thirdweb.allowedChains) ? thirdweb.allowedChains.map((value) => Number(value)) : undefined,
      capabilities,
    };
  }

  private hasDelegatedAuthority(metadata: Record<string, unknown>): boolean {
    const session = this.readSession(metadata);
    return Boolean(session?.sessionId || session?.delegationId);
  }

  private requiredCapabilityForAction(action: ExecutionEligibilityInput['action']): string | null {
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
        return `execute_${action}`;
      default:
        return null;
    }
  }

  private createProviderError(status: number, code: string, message: string): Error & { status?: number; code?: string } {
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = status;
    error.code = code;
    return error;
  }
}
