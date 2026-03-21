import axios from 'axios';
import { createCipheriv, createHash, createHmac, createPublicKey, pbkdf2Sync, randomBytes, randomUUID, verify as cryptoVerify } from 'crypto';
import { HDNodeWallet, JsonRpcProvider, verifyMessage } from 'ethers';
import { LiquidSwapClient, SwapPrepareResponse } from '../../infrastructure/clients/LiquidSwapClient';
import { LidoClient } from '../../infrastructure/clients/LidoClient';
import { LendingClient, LendingActionRequest } from '../../infrastructure/clients/LendingClient';
import { DatabaseGatewayClient, PlainObject } from '../../infrastructure/clients/DatabaseGatewayClient';
import { WalletExecutionStrategy, WalletProviderAdapterPort } from '../../domain/ports/WalletProviderAdapterPort';
import { WalletBalanceReader } from './WalletBalanceReader';

export type WalletProvider = 'thirdweb' | 'wdk';

type WalletRecord = PlainObject & {
  id: string;
  userId: string;
  address: string;
  chain: string;
  walletType: 'ton' | 'evm' | 'smart_wallet' | 'panorama_wallet';
  metadata?: PlainObject;
};

export interface CreateWalletRequest {
  userId: string;
  chain: string;
  address?: string;
  walletType: 'ton' | 'evm' | 'smart_wallet' | 'panorama_wallet';
  provider?: WalletProvider;
  metadata?: PlainObject;
}

export interface CreateWalletExportRequest {
  userId: string;
  chain: string;
  chainScope: 'evm' | 'ton' | 'evm_ton';
  exportPassword: string;
  name?: string;
  metadata?: PlainObject;
}

export interface LinkWalletRequest extends CreateWalletRequest {
  address: string;
  providerWalletId?: string;
  publicKey?: string;
}

export interface RegisterWalletSessionRequest {
  userId: string;
  walletId: string;
  provider?: WalletProvider;
  chain: string;
  sessionId?: string;
  delegationId?: string;
  publicKey?: string;
  expiresAt?: string;
  capabilities?: string[];
  allowedChains?: number[];
  metadata?: PlainObject;
}

export interface CreatePolicyRequest {
  userId: string;
  walletId: string;
  name?: string;
  allowedActions: string[];
  allowedAssets: string[];
  maxAmount: string;
  allowedChains: number[];
  expiresAt: string;
}

export interface CreateSwapRequest {
  userId: string;
  walletId: string;
  policyId: string;
  provider: WalletProvider;
  idempotencyKey?: string;
  signedIntent: string;
  swapProviderHint?: string;
  swap: {
    fromChainId: number;
    toChainId: number;
    fromToken: string;
    toToken: string;
    amountRaw: string;
    amountDisplay: string;
    slippage?: number;
  };
}

export interface PrepareSwapRequest {
  userId: string;
  walletId: string;
  policyId: string;
  provider: WalletProvider;
  idempotencyKey?: string;
  signedIntent: string;
  swapProviderHint?: string;
  swap: CreateSwapRequest['swap'];
}

export interface SubmitPreparedSwapRequest {
  userId: string;
  swapId: string;
  walletId: string;
  txHashes: Array<{
    hash: string;
    chainId: number;
    type?: string;
    status?: string;
    nonce?: number;
    broadcastState?: string;
    materializationState?: string;
    materializedBy?: string;
    verifiedAt?: string;
    receiptStatus?: string;
  }>;
  metadata?: PlainObject;
}

export interface FailPreparedSwapRequest {
  userId: string;
  swapId: string;
  walletId: string;
  errorCode?: string;
  errorMessage: string;
  metadata?: PlainObject;
}

export interface CreateStakeRequest {
  userId: string;
  walletId: string;
  policyId: string;
  provider: WalletProvider;
  idempotencyKey?: string;
  signedIntent: string;
  stake: {
    chainId: number;
    token: string;
    amountRaw: string;
    amountDisplay: string;
  };
}

export interface CreateLendingActionRequest {
  userId: string;
  walletId: string;
  policyId: string;
  provider: WalletProvider;
  idempotencyKey?: string;
  signedIntent: string;
  lending: {
    chainId: number;
    action: LendingActionRequest['action'];
    token: string;
    amountRaw: string;
    amountDisplay: string;
  };
}

interface PolicyEnvelope {
  id: string;
  userId: string;
  walletId: string;
  name?: string;
  allowedActions: string[];
  allowedAssets: string[];
  maxAmount: string;
  allowedChains: number[];
  expiresAt: string;
  status: 'draft' | 'approved' | 'revoked';
  createdAt: string;
  updatedAt: string;
}

interface OwnershipChallengePayload {
  challengeId: string;
  walletId: string;
  userId: string;
  walletAddress: string;
  chain: string;
  walletType: string;
  nonce: string;
  message: string;
  expiresAt: string;
  status: 'pending' | 'verified' | 'expired' | 'used';
  usedAt?: string;
  verificationMethod?: 'evm' | 'ton';
}

interface WalletExportBundle {
  format: 'encrypted_mnemonic';
  version: 1;
  cipher: 'aes-256-gcm';
  kdf: 'pbkdf2-sha256';
  iterations: number;
  chainScope: 'evm' | 'ton' | 'evm_ton';
  primaryAddress: string;
  ciphertext: string;
  iv: string;
  salt: string;
  authTag: string;
}

export class PanoramaV1Service {
  constructor(
    private readonly dbGateway: DatabaseGatewayClient,
    private readonly swapClient: LiquidSwapClient,
    private readonly lidoClient: LidoClient,
    private readonly lendingClient: LendingClient,
    private readonly adapters: Record<WalletProvider, WalletProviderAdapterPort>,
    private readonly defaultWalletProvider: WalletProvider = 'wdk',
    private readonly walletBalanceReader: WalletBalanceReader = new WalletBalanceReader()
  ) {}

  private resolveAdapter(provider: WalletProvider): WalletProviderAdapterPort {
    const adapter = this.adapters[provider];
    if (!adapter) {
      const error = new Error(`Unsupported wallet provider: ${provider}`) as Error & { status?: number; code?: string };
      error.status = 400;
      error.code = 'UNSUPPORTED_PROVIDER';
      throw error;
    }
    return adapter;
  }

  private async emitEvent(userId: string, event: string, data?: PlainObject, operationId?: string): Promise<void> {
    const eventId = randomUUID();
    await this.dbGateway.createLifecycleEvent({
      eventId,
      userId,
      intentId: operationId,
      event,
      data,
    });

    const subscriptions = await this.dbGateway.listWebhookSubscriptions(userId);
    await Promise.all(
      subscriptions.map(async (subscription) => {
        const payload = (subscription.payload || {}) as PlainObject;
        const webhookEvents = Array.isArray(payload.events) ? payload.events.map(String) : [];
        const active = payload.active !== false;

        if (!active || (webhookEvents.length > 0 && !webhookEvents.includes(event))) {
          return;
        }

        const url = String(payload.url || '');
        if (!url) return;

        const body = {
          event,
          userId,
          operationId,
          data,
          timestamp: new Date().toISOString(),
        };
        const bodyJson = JSON.stringify(body);
        const timestamp = Date.now().toString();
        const secret = typeof payload.secret === 'string' ? payload.secret : '';
        const signature = secret
          ? createHmac('sha256', secret).update(`${timestamp}.${bodyJson}`).digest('hex')
          : undefined;

        await this.deliverWebhook(url, body, signature, timestamp);
      })
    );
  }

  private async getOwnedWallet(walletId: string, userId: string): Promise<WalletRecord> {
    const wallet = (await this.dbGateway.getWallet(walletId)) as WalletRecord | null;
    if (!wallet) {
      const error = new Error('Wallet not found') as Error & { status?: number; code?: string };
      error.status = 404;
      error.code = 'WALLET_NOT_FOUND';
      throw error;
    }

    if (String(wallet.userId) !== userId) {
      const error = new Error('Wallet ownership mismatch') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'WALLET_FORBIDDEN';
      throw error;
    }

    this.assertTenantOwnership(wallet, 'wallet');
    return wallet;
  }

  private isTonWallet(wallet: WalletRecord): boolean {
    return wallet.walletType === 'ton' || wallet.chain.toLowerCase().includes('ton');
  }

  async createWallet(input: CreateWalletRequest): Promise<PlainObject> {
    const provider: WalletProvider = input.provider || this.defaultWalletProvider;
    if (provider === 'wdk') {
      const error = new Error('WDK wallets are client-managed. Use wallet linking instead of wallet creation.') as Error & {
        status?: number;
        code?: string;
      };
      error.status = 409;
      error.code = 'WDK_LINK_REQUIRED';
      throw error;
    }
    const walletId = randomUUID();
    const adapter = this.resolveAdapter(provider);

    let providerResult: Awaited<ReturnType<WalletProviderAdapterPort['createWallet']>>;
    try {
      providerResult = await adapter.createWallet({
        userId: input.userId,
        chain: input.chain,
        address: input.address,
        walletType: input.walletType,
        metadata: input.metadata,
      });
    } catch (error: any) {
      const wrapped = new Error(error?.message || 'Wallet creation failed') as Error & { status?: number; code?: string };
      wrapped.status = 502;
      wrapped.code = 'WALLET_CREATE_FAILED';
      throw wrapped;
    }

    const walletAddress = providerResult.address || input.address;
    if (!walletAddress) {
      const error = new Error('Provider did not return a wallet address') as Error & { status?: number; code?: string };
      error.status = 502;
      error.code = 'WALLET_CREATE_FAILED';
      throw error;
    }

    const wallet = await this.dbGateway.createWallet({
      walletId,
      userId: input.userId,
      chain: input.chain,
      address: walletAddress,
      walletType: input.walletType,
      metadata: {
        provider,
        providerWalletId: providerResult.providerWalletId,
        sessionKey: providerResult.sessionKey,
        ownershipVerified: false,
        ...(providerResult.metadata || {}),
        ...(input.metadata || {}),
      },
    });

    await this.emitEvent(input.userId, 'wallet.created', {
      walletId,
      chain: input.chain,
      address: walletAddress,
      provider,
      ownershipVerified: false,
    });

    return wallet;
  }

  async createWalletExport(input: CreateWalletExportRequest): Promise<PlainObject> {
    const normalizedScope = input.chainScope;
    if (normalizedScope !== 'evm') {
      const error = new Error('Panorama wallet export currently supports EVM only. TON export creation is not implemented yet.') as Error & {
        status?: number;
        code?: string;
      };
      error.status = 501;
      error.code = 'WALLET_EXPORT_CHAIN_UNSUPPORTED';
      throw error;
    }

    const password = String(input.exportPassword || '');
    if (password.trim().length < 8) {
      const error = new Error('exportPassword must be at least 8 characters long') as Error & { status?: number; code?: string };
      error.status = 400;
      error.code = 'WALLET_EXPORT_PASSWORD_INVALID';
      throw error;
    }

    const generatedWallet = HDNodeWallet.createRandom();
    const mnemonic = generatedWallet.mnemonic?.phrase;
    if (!mnemonic) {
      const error = new Error('Failed to generate wallet export mnemonic') as Error & { status?: number; code?: string };
      error.status = 500;
      error.code = 'WALLET_EXPORT_GENERATION_FAILED';
      throw error;
    }

    const exportBundle = this.encryptMnemonicExport(mnemonic, password, generatedWallet.address, normalizedScope);
    const walletId = randomUUID();

    const wallet = await this.dbGateway.createWallet({
      walletId,
      userId: input.userId,
      chain: input.chain,
      address: generatedWallet.address,
      walletType: 'panorama_wallet',
      metadata: {
        provider: 'wdk',
        creationSource: 'panorama_export',
        exportFormat: 'encrypted_mnemonic',
        exportReturnedOnce: true,
        chainScope: normalizedScope,
        name: input.name,
        ownershipVerified: false,
        ...(input.metadata || {}),
      },
    });

    await this.emitEvent(input.userId, 'wallet.export_created', {
      walletId,
      chain: input.chain,
      address: generatedWallet.address,
      chainScope: normalizedScope,
      creationSource: 'panorama_export',
    });

    return {
      wallet,
      exportBundle,
      returnedOnce: true,
      publicMetadata: {
        chainScope: normalizedScope,
        primaryAddress: generatedWallet.address,
        creationSource: 'panorama_export',
      },
    };
  }

  async linkWallet(input: LinkWalletRequest): Promise<PlainObject> {
    const provider: WalletProvider = input.provider || this.defaultWalletProvider;
    const adapter = this.resolveAdapter(provider);
    const existing = await this.dbGateway.findWalletByUserAndAddress(input.userId, input.address, input.chain);

    let providerResult: Awaited<ReturnType<WalletProviderAdapterPort['linkWallet']>>;
    try {
      providerResult = await adapter.linkWallet({
        userId: input.userId,
        chain: input.chain,
        address: input.address,
        walletType: input.walletType,
        metadata: input.metadata,
        providerWalletId: input.providerWalletId,
        publicKey: input.publicKey,
      });
    } catch (error: any) {
      const wrapped = new Error(error?.message || 'Wallet link failed') as Error & { status?: number; code?: string };
      wrapped.status = Number(error?.status || 502);
      wrapped.code = String(error?.code || 'WALLET_LINK_FAILED');
      throw wrapped;
    }

    const existingMetadata = existing ? (((existing.metadata || {}) as PlainObject)) : {};
    const metadata = {
      ...existingMetadata,
      provider,
      providerWalletId: providerResult.providerWalletId || input.providerWalletId || existingMetadata.providerWalletId,
      ...(providerResult.sessionKey ? { sessionKey: providerResult.sessionKey } : {}),
      ...(providerResult.metadata || {}),
      ...(input.publicKey ? { publicKey: input.publicKey } : {}),
      ...(input.metadata || {}),
    };

    if (existing) {
      const updated = await this.dbGateway.updateWallet(String(existing.id), { metadata });
      await this.emitEvent(input.userId, 'wallet.linked', {
        walletId: String(existing.id),
        chain: input.chain,
        address: input.address,
        provider,
        ownershipVerified: false,
      });
      return updated;
    }

    const walletId = randomUUID();
    const wallet = await this.dbGateway.createWallet({
      walletId,
      userId: input.userId,
      chain: input.chain,
      address: input.address,
      walletType: input.walletType,
      metadata,
    });

    await this.emitEvent(input.userId, 'wallet.linked', {
      walletId,
      chain: input.chain,
      address: input.address,
      provider,
      ownershipVerified: false,
    });

    return wallet;
  }

  async registerWalletSession(input: RegisterWalletSessionRequest): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(input.walletId, input.userId);
    const metadata = (wallet.metadata || {}) as PlainObject;
    const provider = input.provider || String(metadata.provider || this.defaultWalletProvider) as WalletProvider;
    await this.assertWalletProviderMatch(wallet, provider, 'session');
    const adapter = this.resolveAdapter(provider);

    let sessionResult: Awaited<ReturnType<WalletProviderAdapterPort['registerSession']>>;
    try {
      sessionResult = await adapter.registerSession(
        {
          chain: input.chain,
          sessionId: input.sessionId,
          delegationId: input.delegationId,
          publicKey: input.publicKey,
          expiresAt: input.expiresAt,
          capabilities: input.capabilities,
          allowedChains: input.allowedChains,
          metadata: input.metadata,
        },
        metadata as Record<string, unknown>
      );
    } catch (error: any) {
      const wrapped = new Error(error?.message || 'Wallet session registration failed') as Error & {
        status?: number;
        code?: string;
      };
      wrapped.status = Number(error?.status || 502);
      wrapped.code = String(error?.code || 'WALLET_SESSION_FAILED');
      throw wrapped;
    }

    await this.dbGateway.updateWallet(input.walletId, {
      metadata: {
        ...metadata,
        ...(sessionResult.metadata || {}),
        providerSessionId: sessionResult.providerSessionId,
      },
    });

    await this.emitEvent(input.userId, 'wallet.session.registered', {
      walletId: input.walletId,
      provider,
      providerSessionId: sessionResult.providerSessionId,
      capabilities: sessionResult.capabilities,
      expiresAt: input.expiresAt,
    });

    return await this.getWalletContext(input.walletId, input.userId);
  }

  async getWalletContext(walletId: string, userId: string): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(walletId, userId);
    const metadata = (wallet.metadata || {}) as PlainObject;
    const provider = String(metadata.provider || this.defaultWalletProvider) as WalletProvider;
    const adapter = this.resolveAdapter(provider);
    const context = await adapter.getExecutionContext(String(wallet.address), metadata as Record<string, unknown>);
    const executionStrategy = adapter.getExecutionStrategy(metadata as Record<string, unknown>);
    const wdkMetadata = ((metadata.wdk || {}) as PlainObject);
    const sessionMetadata = ((wdkMetadata.session || metadata.thirdwebSession || metadata.session || {}) as PlainObject);
    const allowedChains = Array.isArray(sessionMetadata.allowedChains)
      ? sessionMetadata.allowedChains.map((value) => Number(value)).filter(Number.isFinite)
      : undefined;
    const runtimeConfigured = typeof wdkMetadata.runtimeConfigured === 'boolean'
      ? wdkMetadata.runtimeConfigured
      : undefined;

    return {
      walletId,
      userId,
      chain: wallet.chain,
      walletType: wallet.walletType,
      provider,
      walletAddress: wallet.address,
      providerWalletId: context.providerWalletId,
      capabilities: context.capabilities,
      ownershipVerified: metadata.ownershipVerified === true,
      ownershipProof: metadata.ownershipProof,
      sessionId: sessionMetadata.sessionId,
      delegationId: sessionMetadata.delegationId,
      sessionExpiresAt: sessionMetadata.expiresAt,
      allowedChains,
      chainFamily: typeof wdkMetadata.chainFamily === 'string' ? wdkMetadata.chainFamily : undefined,
      executionMode: runtimeConfigured === undefined ? undefined : (runtimeConfigured ? 'live' : 'simulated'),
      executionStrategy,
      runtimeConfigured,
      metadata,
    };
  }

  async getWalletBalances(
    walletId: string,
    userId: string,
    options: { chainIds?: number[]; includeZeroBalances?: boolean }
  ): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(walletId, userId);
    const metadata = (wallet.metadata || {}) as PlainObject;
    const sessionMetadata = ((((metadata.wdk || {}) as PlainObject).session || metadata.session || {}) as PlainObject);
    const allowedChains = Array.isArray(sessionMetadata.allowedChains)
      ? sessionMetadata.allowedChains.map((value) => Number(value)).filter(Number.isFinite)
      : undefined;

    return await this.walletBalanceReader.readBalances({
      walletId,
      userId,
      walletAddress: String(wallet.address),
      walletType: wallet.walletType,
      walletChain: String(wallet.chain),
      allowedChains,
      chainIds: options.chainIds,
      includeZeroBalances: options.includeZeroBalances,
    }) as unknown as PlainObject;
  }

  async prepareOwnershipChallenge(walletId: string, userId: string): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(walletId, userId);
    const nonce = randomBytes(16).toString('hex');
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const message = [
      'Panorama Wallet Ownership Challenge',
      `Wallet ID: ${walletId}`,
      `Address: ${wallet.address}`,
      `Chain: ${wallet.chain}`,
      `Nonce: ${nonce}`,
      `Expires At: ${expiresAt}`,
    ].join('\n');

    const payload: OwnershipChallengePayload = {
      challengeId,
      walletId,
      userId,
      walletAddress: String(wallet.address),
      chain: String(wallet.chain),
      walletType: wallet.walletType,
      nonce,
      message,
      expiresAt,
      status: 'pending',
    };

    await this.dbGateway.createOwnershipChallenge({
      challengeId,
      walletId,
      userId,
      challenge: payload as unknown as PlainObject,
    });

    await this.emitEvent(userId, 'wallet.ownership_challenge.created', {
      walletId,
      challengeId,
      expiresAt,
    });

    return payload as unknown as PlainObject;
  }

  async verifyOwnership(
    walletId: string,
    userId: string,
    input: { challengeId: string; signature: string; address?: string; publicKey?: string }
  ): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(walletId, userId);
    const challengeRecord = await this.dbGateway.getOwnershipChallenge(input.challengeId);
    const challenge = (challengeRecord?.payload || challengeRecord) as OwnershipChallengePayload | undefined;

    if (!challenge || challenge.walletId !== walletId || challenge.userId !== userId) {
      const error = new Error('Ownership challenge not found') as Error & { status?: number; code?: string };
      error.status = 404;
      error.code = 'OWNERSHIP_CHALLENGE_NOT_FOUND';
      throw error;
    }

    if (challenge.status !== 'pending') {
      const error = new Error('Ownership challenge already used') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'OWNERSHIP_CHALLENGE_USED';
      throw error;
    }

    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      challenge.status = 'expired';
      await this.dbGateway.updateOwnershipChallenge(challenge.challengeId, challenge as unknown as PlainObject);
      const error = new Error('Ownership challenge expired') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'OWNERSHIP_CHALLENGE_EXPIRED';
      throw error;
    }

    const signature = String(input.signature || '').trim();
    if (!signature) {
      const error = new Error('Signature is required') as Error & { status?: number; code?: string };
      error.status = 400;
      error.code = 'INVALID_SIGNATURE';
      throw error;
    }

    const verificationMethod = this.isTonWallet(wallet) ? 'ton' : 'evm';
    if (verificationMethod === 'evm') {
      this.verifyEvmOwnership(challenge.message, signature, String(wallet.address), input.address);
    } else {
      this.verifyTonOwnership(challenge.message, signature, String(wallet.address), input.address, input.publicKey);
    }

    const walletMetadata = (wallet.metadata || {}) as PlainObject;
    const ownershipProof = {
      method: verificationMethod,
      verifiedAt: new Date().toISOString(),
      verifierVersion: 'iteration-4',
      ...(verificationMethod === 'ton' && input.publicKey ? { publicKey: input.publicKey } : {}),
    };

    await this.dbGateway.updateWallet(walletId, {
      metadata: {
        ...walletMetadata,
        ownershipVerified: true,
        ownershipProof,
      },
    });

    challenge.status = 'verified';
    challenge.usedAt = new Date().toISOString();
    challenge.verificationMethod = verificationMethod;
    await this.dbGateway.updateOwnershipChallenge(challenge.challengeId, challenge as unknown as PlainObject);

    await this.emitEvent(userId, 'wallet.ownership_verified', {
      walletId,
      challengeId: challenge.challengeId,
      verificationMethod,
    });

    return {
      walletId,
      challengeId: challenge.challengeId,
      ownershipVerified: true,
      ownershipProof,
    };
  }

  async getOwnershipStatus(walletId: string, userId: string): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(walletId, userId);
    const metadata = (wallet.metadata || {}) as PlainObject;

    return {
      walletId,
      ownershipVerified: metadata.ownershipVerified === true,
      ownershipProof: metadata.ownershipProof || null,
    };
  }

  async createPolicy(input: CreatePolicyRequest): Promise<PolicyEnvelope> {
    const policyId = randomUUID();
    const now = new Date().toISOString();

    const policy: PolicyEnvelope = {
      id: policyId,
      userId: input.userId,
      walletId: input.walletId,
      name: input.name,
      allowedActions: input.allowedActions,
      allowedAssets: input.allowedAssets.map((asset) => asset.toLowerCase()),
      maxAmount: input.maxAmount,
      allowedChains: input.allowedChains,
      expiresAt: input.expiresAt,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    await this.dbGateway.createPolicy({
      policyId,
      userId: input.userId,
      walletId: input.walletId,
      policy: policy as unknown as PlainObject,
    });

    await this.emitEvent(input.userId, 'policy.created', {
      policyId,
      walletId: input.walletId,
      status: policy.status,
    });

    return policy;
  }

  async approvePolicy(policyId: string, userId: string): Promise<PolicyEnvelope> {
    const stored = await this.dbGateway.getPolicy(policyId);
    if (!stored || !stored.payload) {
      const error = new Error('Policy not found') as Error & { status?: number; code?: string };
      error.status = 404;
      error.code = 'POLICY_NOT_FOUND';
      throw error;
    }

    const policy = stored.payload as PolicyEnvelope;
    if (policy.userId !== userId) {
      const error = new Error('Policy ownership mismatch') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_FORBIDDEN';
      throw error;
    }

    policy.status = 'approved';
    policy.updatedAt = new Date().toISOString();

    await this.dbGateway.updatePolicy(policyId, policy as unknown as PlainObject);
    await this.emitEvent(userId, 'policy.approved', { policyId, walletId: policy.walletId, status: policy.status });

    return policy;
  }

  async revokePolicy(policyId: string, userId: string): Promise<PolicyEnvelope> {
    const stored = await this.dbGateway.getPolicy(policyId);
    if (!stored || !stored.payload) {
      const error = new Error('Policy not found') as Error & { status?: number; code?: string };
      error.status = 404;
      error.code = 'POLICY_NOT_FOUND';
      throw error;
    }

    const policy = stored.payload as PolicyEnvelope;
    if (policy.userId !== userId) {
      const error = new Error('Policy ownership mismatch') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_FORBIDDEN';
      throw error;
    }

    policy.status = 'revoked';
    policy.updatedAt = new Date().toISOString();

    await this.dbGateway.updatePolicy(policyId, policy as unknown as PlainObject);
    await this.emitEvent(userId, 'policy.revoked', { policyId, walletId: policy.walletId, status: policy.status });

    return policy;
  }

  async registerWebhook(input: { userId: string; url: string; events: string[]; secret?: string }): Promise<PlainObject> {
    const webhookId = randomUUID();
    return await this.dbGateway.createWebhookSubscription({
      webhookId,
      userId: input.userId,
      url: input.url,
      events: input.events,
      secret: input.secret,
    });
  }

  async prepareSwap(input: PrepareSwapRequest): Promise<PlainObject> {
    if (input.idempotencyKey) {
      const existing = await this.dbGateway.getIntentByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing && existing.action === 'swap') {
        return await this.getSwap(String(existing.id), input.userId);
      }
    }

    const prepared = await this.prepareSwapIntent(input);
    return {
      ...(await this.getSwap(prepared.swapId, input.userId)),
      prepared: this.buildPreparedSwapPayload(prepared.swapPlan, input.swap.fromChainId, prepared.transactions),
    };
  }

  async createSwap(input: CreateSwapRequest): Promise<PlainObject> {
    if (input.idempotencyKey) {
      const existing = await this.dbGateway.getIntentByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing && existing.action === 'swap') {
        return await this.getSwap(String(existing.id), input.userId);
      }
    }
    let prepared: Awaited<ReturnType<PanoramaV1Service['prepareSwapIntent']>>;
    try {
      prepared = await this.prepareSwapIntent(input);
    } catch (error: any) {
      if (error?.swapId) {
        return await this.getSwap(String(error.swapId), input.userId);
      }
      throw error;
    }
    const { swapId, wallet, metadata, swapPlan, transaction } = prepared;

    try {
      const adapter = this.resolveAdapter(input.provider);
      const executionStrategy = adapter.getExecutionStrategy(metadata as Record<string, unknown>);
      if (executionStrategy !== 'delegated' && executionStrategy !== 'hybrid') {
        throw this.createLegacySwapExecutionError(metadata);
      }

      await adapter.assertExecutionAllowed({
        walletAddress: String(wallet.address),
        action: 'swap',
        chainId: input.swap.fromChainId,
        metadata: metadata as Record<string, unknown>,
      });
      const executionResult = await adapter.executePlan({
        intentId: swapId,
        walletAddress: String(wallet.address),
        signedIntent: input.signedIntent,
        txData: (swapPlan.txData || {}) as Record<string, unknown>,
        route: (swapPlan.route || {}) as Record<string, unknown>,
        action: 'swap',
        chainId: input.swap.fromChainId,
        walletMetadata: metadata as Record<string, unknown>,
      });

      const status = executionResult.status === 'failed' ? 'failed' : executionResult.status === 'confirmed' ? 'confirmed' : 'submitted';
      const executionMetadata = (executionResult.metadata || {}) as Record<string, unknown>;
      const allTxHashes = Array.isArray(executionMetadata.allTxHashes)
        ? executionMetadata.allTxHashes.map((hash) => String(hash))
        : executionResult.txHash
          ? [executionResult.txHash]
          : [];
      const txHashes = allTxHashes.map((hash) => ({
        hash,
        chainId: input.swap.fromChainId,
        type: 'swap',
        status: status === 'failed' ? 'failed' : 'pending',
      }));

      await this.dbGateway.updateIntentTransaction(swapId, {
        status,
        txHashes,
        errorCode: status === 'failed' ? 'EXECUTION_FAILED' : undefined,
        metadata: {
          ...(transaction.metadata || {}),
          execution: executionMetadata,
          providerReference: executionResult.providerReference,
          estimatedOutput: swapPlan.estimatedOutput,
          preparedRoute: swapPlan.route,
        },
        errorMessage: executionResult.errorMessage,
      });

      await this.emitSwapLifecycleEvents(input.userId, swapId, status, executionResult.txHash, executionResult.errorMessage);
      return await this.getSwap(swapId, input.userId);
    } catch (error: any) {
      const mapped = this.mapExecutionError(error);
      await this.dbGateway.updateIntentTransaction(swapId, {
        status: 'failed',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });

      await this.emitEvent(input.userId, mapped.code === 'SWAP_PREPARE_TIMEOUT' ? 'swap.timeout' : 'swap.failed', {
        swapId,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      }, swapId);

      return await this.getSwap(swapId, input.userId);
    }
  }

  async submitPreparedSwap(input: SubmitPreparedSwapRequest): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(input.walletId, input.userId);
    const swap = await this.getOwnedOperation(input.swapId, input.userId, 'swap');
    if (String(swap.walletId) !== String(wallet.id)) {
      const error = new Error('Swap does not belong to the provided wallet.') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'SWAP_WALLET_MISMATCH';
      throw error;
    }
    const preparedMetadata = this.readPreparedSwapMetadata(swap);
    this.assertPreparedSwapNotExpired(preparedMetadata);

    const txHashes = input.txHashes.map((txHash) => ({
      hash: String(txHash.hash),
      chainId: Number(txHash.chainId),
      type: txHash.type || 'swap',
      status: txHash.status || 'pending',
      nonce: typeof txHash.nonce === 'number' ? txHash.nonce : undefined,
      broadcastState: typeof txHash.broadcastState === 'string' ? txHash.broadcastState : undefined,
      materializationState: typeof txHash.materializationState === 'string' ? txHash.materializationState : undefined,
      materializedBy: typeof txHash.materializedBy === 'string' ? txHash.materializedBy : undefined,
      verifiedAt: typeof txHash.verifiedAt === 'string' ? txHash.verifiedAt : undefined,
      receiptStatus: typeof txHash.receiptStatus === 'string' ? txHash.receiptStatus : undefined,
    }));
    const expectedChainId = Number(swap.fromChainId);
    if (txHashes.some((txHash) => txHash.chainId !== expectedChainId)) {
      const error = new Error(`Prepared swap expects submissions on chain ${expectedChainId}.`) as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'SWAP_SUBMIT_CHAIN_MISMATCH';
      throw error;
    }
    this.assertPreparedSwapSubmissionState(swap, txHashes);
    const primaryTxHash = txHashes[0]?.hash;
    const submissionStatus = this.deriveSubmittedSwapStatus(txHashes, preparedMetadata.preparedTransactionsCount);
    await this.dbGateway.updateIntentTransaction(input.swapId, {
      status: submissionStatus,
      txHashes,
      metadata: {
        ...(((swap.metadata || {}) as PlainObject)),
        clientSubmission: {
          ...(input.metadata || {}),
          submittedAt: new Date().toISOString(),
        },
      },
      errorCode: undefined,
      errorMessage: undefined,
    });

    if (submissionStatus === 'confirmed') {
      await this.emitSwapLifecycleEvents(input.userId, input.swapId, 'confirmed', primaryTxHash);
    } else {
      await this.emitSwapLifecycleEvents(input.userId, input.swapId, 'submitted', primaryTxHash);
    }
    return await this.getSwap(input.swapId, input.userId);
  }

  async failPreparedSwap(input: FailPreparedSwapRequest): Promise<PlainObject> {
    const wallet = await this.getOwnedWallet(input.walletId, input.userId);
    const swap = await this.getOwnedOperation(input.swapId, input.userId, 'swap');
    if (String(swap.walletId) !== String(wallet.id)) {
      const error = new Error('Swap does not belong to the provided wallet.') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'SWAP_WALLET_MISMATCH';
      throw error;
    }
    this.assertPreparedSwapState(swap, 'SWAP_FAIL_INVALID_STATE');
    this.assertPreparedSwapNotExpired(this.readPreparedSwapMetadata(swap));

    await this.dbGateway.updateIntentTransaction(input.swapId, {
      status: 'failed',
      errorCode: input.errorCode || 'CLIENT_EXECUTION_FAILED',
      errorMessage: input.errorMessage,
      metadata: {
        ...(((swap.metadata || {}) as PlainObject)),
        clientFailure: {
          ...(input.metadata || {}),
          source: 'client',
          failedAt: new Date().toISOString(),
        },
      },
    });

    await this.emitEvent(input.userId, 'swap.failed', {
      swapId: input.swapId,
      errorCode: input.errorCode || 'CLIENT_EXECUTION_FAILED',
      errorMessage: input.errorMessage,
    }, input.swapId);
    return await this.getSwap(input.swapId, input.userId);
  }

  async getSwap(swapId: string, userId: string): Promise<PlainObject> {
    let transaction = await this.getOwnedOperation(swapId, userId, 'swap');
    transaction = await this.reconcileSwapStatus(transaction);
    const metadata = (transaction.metadata || {}) as PlainObject;
    if (transaction.status === 'failed' && metadata.policyStatus === 'policy_denied') {
      return { ...transaction, status: 'policy_denied' };
    }
    return transaction;
  }

  async createStake(input: CreateStakeRequest): Promise<PlainObject> {
    if (input.idempotencyKey) {
      const existing = await this.dbGateway.getIntentByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing && existing.action === 'stake') {
        return await this.getStake(String(existing.id), input.userId);
      }
    }

    const wallet = await this.getOwnedWallet(input.walletId, input.userId);
    this.assertOwnershipVerified(wallet);
    await this.assertWalletProviderMatch(wallet, input.provider, 'stake');
    await this.resolveAdapter(input.provider).assertExecutionAllowed({
      walletAddress: String(wallet.address),
      action: 'stake',
      chainId: input.stake.chainId,
      metadata: ((wallet.metadata || {}) as Record<string, unknown>),
    });

    const policy = await this.getValidatedPolicy(input.policyId, input.userId);
    this.assertPolicyAction(policy, {
      action: 'stake',
      amountRaw: input.stake.amountRaw,
      fromToken: input.stake.token,
      chainIds: [input.stake.chainId],
    });

    const operationId = randomUUID();
    const transaction = {
      id: operationId,
      userId: input.userId,
      walletId: input.walletId,
      action: 'stake',
      protocol: 'panorama-v1',
      fromChainId: input.stake.chainId,
      fromAssetAddress: input.stake.token,
      fromAssetSymbol: input.stake.token,
      fromAssetDecimals: 18,
      fromAmountRaw: input.stake.amountRaw,
      fromAmountDisplay: input.stake.amountDisplay,
      toChainId: input.stake.chainId,
      toAssetAddress: input.stake.token,
      toAssetSymbol: 'stToken',
      toAssetDecimals: 18,
      txHashes: [],
      status: 'created',
      provider: input.provider,
      metadata: {
        policyId: input.policyId,
        idempotencyKey: input.idempotencyKey,
      },
      tenantId: this.dbGateway.getTenantId(),
    };

    await this.dbGateway.createIntentTransaction(transaction);
    await this.emitEvent(input.userId, 'staking.accepted', { operationId, policyId: input.policyId }, operationId);

    try {
      const stakeResult = await this.lidoClient.stake(input.stake.amountRaw, input.stake.token);
      const txHash = typeof stakeResult?.txHash === 'string' ? stakeResult.txHash : undefined;

      await this.dbGateway.updateIntentTransaction(operationId, {
        status: txHash ? 'submitted' : 'confirmed',
        txHashes: txHash ? [{ hash: txHash, chainId: input.stake.chainId, type: 'stake', status: 'pending' }] : [],
        metadata: {
          ...(transaction.metadata || {}),
          stakeResult,
        },
      });

      await this.emitEvent(input.userId, txHash ? 'staking.submitted' : 'staking.confirmed', { operationId, txHash }, operationId);
      return await this.getStake(operationId, input.userId);
    } catch (error: any) {
      const mapped = this.mapExecutionError(error);
      await this.dbGateway.updateIntentTransaction(operationId, {
        status: 'failed',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });

      await this.emitEvent(input.userId, 'staking.failed', { operationId, errorCode: mapped.code, errorMessage: mapped.message }, operationId);
      return await this.getStake(operationId, input.userId);
    }
  }

  async getStake(operationId: string, userId: string): Promise<PlainObject> {
    return await this.getOwnedOperation(operationId, userId, 'stake');
  }

  async getLendingMarkets(userId: string): Promise<PlainObject> {
    await this.dbGateway.upsertUser(userId);
    return await this.lendingClient.getMarkets();
  }

  async createLendingAction(input: CreateLendingActionRequest): Promise<PlainObject> {
    if (input.idempotencyKey) {
      const existing = await this.dbGateway.getIntentByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing && String(existing.action) === String(input.lending.action)) {
        return await this.getLendingOperation(String(existing.id), input.userId);
      }
    }

    const wallet = await this.getOwnedWallet(input.walletId, input.userId);
    this.assertOwnershipVerified(wallet);
    await this.assertWalletProviderMatch(wallet, input.provider, 'lending');
    await this.resolveAdapter(input.provider).assertExecutionAllowed({
      walletAddress: String(wallet.address),
      action: input.lending.action,
      chainId: input.lending.chainId,
      metadata: ((wallet.metadata || {}) as Record<string, unknown>),
    });

    const policy = await this.getValidatedPolicy(input.policyId, input.userId);
    this.assertPolicyAction(policy, {
      action: input.lending.action,
      amountRaw: input.lending.amountRaw,
      fromToken: input.lending.token,
      chainIds: [input.lending.chainId],
    });

    const operationId = randomUUID();
    const transaction = {
      id: operationId,
      userId: input.userId,
      walletId: input.walletId,
      action: input.lending.action,
      protocol: 'panorama-v1',
      fromChainId: input.lending.chainId,
      fromAssetAddress: input.lending.token,
      fromAssetSymbol: input.lending.token,
      fromAssetDecimals: 18,
      fromAmountRaw: input.lending.amountRaw,
      fromAmountDisplay: input.lending.amountDisplay,
      txHashes: [],
      status: 'created',
      provider: input.provider,
      metadata: {
        policyId: input.policyId,
        idempotencyKey: input.idempotencyKey,
      },
      tenantId: this.dbGateway.getTenantId(),
    };

    await this.dbGateway.createIntentTransaction(transaction);
    await this.emitEvent(input.userId, 'lending.accepted', { operationId, action: input.lending.action }, operationId);

    try {
      const lendingResult = await this.lendingClient.act({
        action: input.lending.action,
        token: input.lending.token,
        amount: input.lending.amountRaw,
        chainId: input.lending.chainId,
      });
      const txHash = typeof lendingResult?.txHash === 'string' ? lendingResult.txHash : undefined;

      await this.dbGateway.updateIntentTransaction(operationId, {
        status: txHash ? 'submitted' : 'confirmed',
        txHashes: txHash ? [{ hash: txHash, chainId: input.lending.chainId, type: input.lending.action, status: 'pending' }] : [],
        metadata: {
          ...(transaction.metadata || {}),
          lendingResult,
        },
      });

      await this.emitEvent(input.userId, txHash ? 'lending.submitted' : 'lending.confirmed', { operationId, txHash }, operationId);
      return await this.getLendingOperation(operationId, input.userId);
    } catch (error: any) {
      const mapped = this.mapExecutionError(error);
      await this.dbGateway.updateIntentTransaction(operationId, {
        status: 'failed',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });

      await this.emitEvent(input.userId, 'lending.failed', { operationId, errorCode: mapped.code, errorMessage: mapped.message }, operationId);
      return await this.getLendingOperation(operationId, input.userId);
    }
  }

  async getLendingOperation(operationId: string, userId: string): Promise<PlainObject> {
    return await this.getOwnedOperation(operationId, userId);
  }

  async getIntent(intentId: string, userId: string): Promise<PlainObject> {
    return await this.getSwap(intentId, userId);
  }

  async createIntent(input: CreateSwapRequest): Promise<PlainObject> {
    return await this.createSwap(input);
  }

  private async getOwnedOperation(operationId: string, userId: string, action?: string): Promise<PlainObject> {
    const transaction = await this.dbGateway.getIntentTransaction(operationId);
    if (!transaction) {
      const error = new Error('Operation not found') as Error & { status?: number; code?: string };
      error.status = 404;
      error.code = 'OPERATION_NOT_FOUND';
      throw error;
    }

    if (String(transaction.userId) !== userId) {
      const error = new Error('Operation ownership mismatch') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'OPERATION_FORBIDDEN';
      throw error;
    }
    this.assertTenantOwnership(transaction, 'operation');

    if (action && String(transaction.action) !== action) {
      const error = new Error('Operation type mismatch') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'OPERATION_TYPE_MISMATCH';
      throw error;
    }

    return transaction;
  }

  private async getValidatedPolicy(policyId: string, userId: string): Promise<PolicyEnvelope> {
    const storedPolicy = await this.dbGateway.getPolicy(policyId);
    if (!storedPolicy || !storedPolicy.payload) {
      const error = new Error('Policy not found') as Error & { status?: number; code?: string };
      error.status = 404;
      error.code = 'POLICY_NOT_FOUND';
      throw error;
    }

    const policy = storedPolicy.payload as PolicyEnvelope;
    if (policy.userId !== userId) {
      const error = new Error('Policy ownership mismatch') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_FORBIDDEN';
      throw error;
    }
    this.assertTenantOwnership(storedPolicy, 'policy');
    return policy;
  }

  private assertPolicyAction(
    policy: PolicyEnvelope,
    input: { action: string; amountRaw: string; chainIds: number[]; fromToken: string; toToken?: string }
  ): void {
    if (policy.status !== 'approved') {
      const error = new Error('Policy is not approved') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'POLICY_NOT_APPROVED';
      throw error;
    }

    if (new Date(policy.expiresAt).getTime() <= Date.now()) {
      const error = new Error('Policy has expired') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'POLICY_EXPIRED';
      throw error;
    }

    if (!policy.allowedActions.includes(input.action)) {
      const error = new Error('Action not allowed by policy') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_ACTION_DENIED';
      throw error;
    }

    const tokenAllowed = policy.allowedAssets.map((asset) => asset.toLowerCase());
    if (!tokenAllowed.includes(input.fromToken.toLowerCase())) {
      const error = new Error('Asset not allowed by policy') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_ASSET_DENIED';
      throw error;
    }
    if (input.toToken && !tokenAllowed.includes(input.toToken.toLowerCase())) {
      const error = new Error('Asset not allowed by policy') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_ASSET_DENIED';
      throw error;
    }

    if (!input.chainIds.every((chainId) => policy.allowedChains.includes(chainId))) {
      const error = new Error('Chain not allowed by policy') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_CHAIN_DENIED';
      throw error;
    }

    const maxAmount = BigInt(policy.maxAmount);
    const requestedAmount = BigInt(input.amountRaw);
    if (requestedAmount > maxAmount) {
      const error = new Error('Amount exceeds policy max') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'POLICY_AMOUNT_DENIED';
      throw error;
    }
  }

  private assertOwnershipVerified(wallet: WalletRecord): void {
    const metadata = (wallet.metadata || {}) as PlainObject;
    if (metadata.ownershipVerified !== true) {
      const error = new Error('Wallet ownership is not verified') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'OWNERSHIP_NOT_VERIFIED';
      throw error;
    }
  }

  private async assertWalletProviderMatch(wallet: WalletRecord, provider: WalletProvider, context: string): Promise<void> {
    const walletProvider = String(((wallet.metadata || {}) as PlainObject).provider || '');
    if (walletProvider && walletProvider !== provider) {
      const error = new Error(`${context} provider does not match wallet provider`) as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'WALLET_PROVIDER_MISMATCH';
      throw error;
    }
  }

  private verifyEvmOwnership(message: string, signature: string, walletAddress: string, providedAddress?: string): void {
    const recovered = verifyMessage(message, signature);
    const expected = walletAddress.toLowerCase();
    if (recovered.toLowerCase() !== expected) {
      const error = new Error('EVM signature does not match wallet address') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'INVALID_OWNERSHIP_SIGNATURE';
      throw error;
    }

    if (providedAddress && providedAddress.toLowerCase() !== expected) {
      const error = new Error('Provided address does not match wallet address') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'INVALID_OWNERSHIP_SIGNATURE';
      throw error;
    }
  }

  private verifyTonOwnership(
    message: string,
    signature: string,
    walletAddress: string,
    providedAddress?: string,
    publicKey?: string
  ): void {
    if (!publicKey) {
      const error = new Error('publicKey is required for TON ownership verification') as Error & { status?: number; code?: string };
      error.status = 400;
      error.code = 'PUBLIC_KEY_REQUIRED';
      throw error;
    }

    if (providedAddress && providedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      const error = new Error('Provided address does not match wallet address') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'INVALID_OWNERSHIP_SIGNATURE';
      throw error;
    }

    const publicKeyBuffer = this.parseTonPublicKey(publicKey);
    const signatureBuffer = this.parseTonSignature(signature);
    const keyObject = this.createTonPublicKeyObject(publicKeyBuffer);
    const verified = cryptoVerify(null, Buffer.from(message, 'utf8'), keyObject, signatureBuffer);
    if (!verified) {
      throw this.createInvalidOwnershipSignatureError('TON signature verification failed');
    }
  }

  private parseSignature(signature: string): Buffer {
    const raw = signature.trim();
    if (!raw) return Buffer.alloc(0);
    if (raw.startsWith('0x')) {
      return Buffer.from(raw.slice(2), 'hex');
    }
    const isHex = /^[0-9a-fA-F]+$/.test(raw);
    return Buffer.from(raw, isHex ? 'hex' : 'base64');
  }

  private parseTonSignature(signature: string): Buffer {
    try {
      const parsed = this.parseSignature(signature);
      if (parsed.length === 0) {
        throw new Error('empty-signature');
      }
      return parsed;
    } catch {
      throw this.createInvalidOwnershipSignatureError('TON signature format is invalid');
    }
  }

  private parseTonPublicKey(publicKey: string): Buffer {
    const normalized = publicKey.trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]+$/.test(normalized)) {
      throw this.createInvalidOwnershipSignatureError('TON publicKey must be hex encoded');
    }

    if (normalized.length !== 64) {
      throw this.createInvalidOwnershipSignatureError('TON publicKey must be a 32-byte Ed25519 key');
    }

    return Buffer.from(normalized, 'hex');
  }

  private createTonPublicKeyObject(publicKeyBuffer: Buffer) {
    try {
      const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
      const spkiKey = Buffer.concat([spkiPrefix, publicKeyBuffer]);
      return createPublicKey({ key: spkiKey, format: 'der', type: 'spki' });
    } catch {
      throw this.createInvalidOwnershipSignatureError('TON publicKey is invalid');
    }
  }

  private createInvalidOwnershipSignatureError(message: string): Error & { status: number; code: string } {
    const error = new Error(message) as Error & { status: number; code: string };
    error.status = 403;
    error.code = 'INVALID_OWNERSHIP_SIGNATURE';
    return error;
  }

  private async emitSwapLifecycleEvents(
    userId: string,
    swapId: string,
    status: 'submitted' | 'confirmed' | 'failed',
    txHash?: string,
    errorMessage?: string
  ): Promise<void> {
    if (status === 'failed') {
      await this.emitEvent(userId, 'swap.failed', { swapId, errorMessage }, swapId);
      return;
    }

    await this.emitEvent(userId, 'swap.submitted', { swapId, txHash }, swapId);
    if (status === 'confirmed') {
      await this.emitEvent(userId, 'swap.confirmed', { swapId, txHash }, swapId);
    }
  }

  private async prepareSwapIntent(input: PrepareSwapRequest): Promise<{
    swapId: string;
    wallet: WalletRecord;
    metadata: PlainObject;
    swapPlan: SwapPrepareResponse;
    transaction: PlainObject;
    transactions: Array<Record<string, unknown>>;
  }> {
    const wallet = await this.getOwnedWallet(input.walletId, input.userId);
    this.assertOwnershipVerified(wallet);

    const metadata = (wallet.metadata || {}) as PlainObject;
    const walletProvider = String(metadata.provider || '');
    if (walletProvider && walletProvider !== input.provider) {
      const error = new Error('Swap provider does not match wallet provider') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'WALLET_PROVIDER_MISMATCH';
      throw error;
    }

    const policy = await this.getValidatedPolicy(input.policyId, input.userId);
    this.assertPolicyAction(policy, {
      action: 'swap',
      amountRaw: input.swap.amountRaw,
      fromToken: input.swap.fromToken,
      toToken: input.swap.toToken,
      chainIds: [input.swap.fromChainId, input.swap.toChainId],
    });

    const swapId = randomUUID();
    const transaction = {
      id: swapId,
      userId: input.userId,
      walletId: input.walletId,
      action: 'swap',
      protocol: 'panorama-v1',
      fromChainId: input.swap.fromChainId,
      fromAssetAddress: input.swap.fromToken,
      fromAssetSymbol: input.swap.fromToken,
      fromAssetDecimals: 18,
      fromAmountRaw: input.swap.amountRaw,
      fromAmountDisplay: input.swap.amountDisplay,
      toChainId: input.swap.toChainId,
      toAssetAddress: input.swap.toToken,
      toAssetSymbol: input.swap.toToken,
      toAssetDecimals: 18,
      txHashes: [],
      status: 'prepared',
      provider: input.provider,
      metadata: {
        policyId: input.policyId,
        idempotencyKey: input.idempotencyKey,
      },
      tenantId: this.dbGateway.getTenantId(),
    };

    await this.dbGateway.createIntentTransaction(transaction);
    await this.emitEvent(input.userId, 'swap.accepted', { swapId, policyId: input.policyId }, swapId);

    try {
      const latestPolicy = await this.getValidatedPolicy(input.policyId, input.userId);
      this.assertPolicyAction(latestPolicy, {
        action: 'swap',
        amountRaw: input.swap.amountRaw,
        fromToken: input.swap.fromToken,
        toToken: input.swap.toToken,
        chainIds: [input.swap.fromChainId, input.swap.toChainId],
      });

      const swapPlan = await this.prepareSwapWithFallback(input, String(wallet.address));
      const routeTransactions = Array.isArray((swapPlan.route || {}).transactions)
        ? ((swapPlan.route || {}).transactions as Array<Record<string, unknown>>)
        : [];
      const transactions = routeTransactions.length > 0
        ? routeTransactions
        : (Object.keys((swapPlan.txData || {}) as Record<string, unknown>).length > 0
          ? [((swapPlan.txData || {}) as Record<string, unknown>)]
          : []);
      const preparedPayload = this.buildPreparedSwapPayload(swapPlan, input.swap.fromChainId, transactions);
      const preparedFingerprint = this.computePreparedTransactionFingerprint(input.swap.fromChainId, transactions);

      await this.dbGateway.updateIntentTransaction(swapId, {
        status: 'prepared',
        metadata: {
          ...(transaction.metadata || {}),
          preparedWalletAddress: wallet.address,
          preparedChainId: input.swap.fromChainId,
          preparedTransactionsCount: transactions.length,
          estimatedOutput: swapPlan.estimatedOutput,
          preparedRoute: swapPlan.route,
          preparedTxData: swapPlan.txData,
          swapProvider: swapPlan.provider,
          swapProviderDebug: swapPlan.providerDebug,
          preparedAt: preparedPayload.preparedAt,
          preparedExpiresAt: preparedPayload.expiresAt,
          preparedMinOutput: preparedPayload.minOutput,
          preparedStale: preparedPayload.stale,
          preparedFingerprint,
        },
      });

      return { swapId, wallet, metadata, swapPlan, transaction, transactions };
    } catch (error: any) {
      const mapped = this.mapExecutionError(error);
      await this.dbGateway.updateIntentTransaction(swapId, {
        status: 'failed',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });

      await this.emitEvent(input.userId, mapped.code === 'SWAP_PREPARE_TIMEOUT' ? 'swap.timeout' : 'swap.failed', {
        swapId,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      }, swapId);

      error.swapId = swapId;
      throw error;
    }
  }

  private async prepareSwapWithFallback(input: CreateSwapRequest, walletAddress: string): Promise<SwapPrepareResponse> {
    // `input.provider` is the wallet provider (`wdk` / `thirdweb`) for bridge-side execution.
    // Swap-provider selection belongs to liquid-swap-service, so never forward the wallet
    // provider as the preferred swap provider.
    const swapProviderCandidates = this.buildSwapProviderCandidates(input);
    let lastError: unknown;

    for (const swapProvider of swapProviderCandidates) {
      try {
        return await this.swapClient.prepareSwap({
          fromChainId: input.swap.fromChainId,
          toChainId: input.swap.toChainId,
          fromToken: input.swap.fromToken,
          toToken: input.swap.toToken,
          amount: input.swap.amountRaw,
          unit: 'wei',
          slippage: input.swap.slippage,
          sender: walletAddress,
          recipient: walletAddress,
          provider: swapProvider,
        });
      } catch (error: any) {
        lastError = error;
        if (!this.isRetryableSwapError(error)) {
          break;
        }
      }
    }

    throw lastError;
  }

  private isRetryableSwapError(error: any): boolean {
    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || '');
    return code === 'ECONNABORTED' || status === 429 || status >= 500;
  }

  private buildSwapProviderCandidates(input: CreateSwapRequest): Array<string | undefined> {
    const hint = input.swapProviderHint;
    const normalizedHint = typeof hint === 'string' && hint.trim().length > 0 ? hint.trim() : undefined;
    if (!normalizedHint) {
      const sameChain = input.swap.fromChainId === input.swap.toChainId;
      return sameChain
        ? ['thirdweb', 'uniswap-trading-api']
        : ['thirdweb', 'uniswap-trading-api'];
    }
    return [normalizedHint];
  }

  private mapExecutionError(error: any): { code: string; message: string } {
    const message = this.extractExecutionErrorMessage(error);
    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || '');

    if (code === 'CLIENT_EXECUTION_REQUIRED' || code === 'DELEGATED_EXECUTION_NOT_AVAILABLE') {
      return { code, message };
    }
    if (code.startsWith('WDK_')) {
      return { code, message };
    }
    if (code.startsWith('THIRDWEB_')) {
      return { code, message };
    }

    if (code === 'EAI_AGAIN' || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || /getaddrinfo|provider unavailable|service unavailable/i.test(message)) {
      return { code: 'SWAP_PROVIDER_UNAVAILABLE', message };
    }
    if (code === 'ECONNABORTED' || /timeout/i.test(message)) {
      return { code: 'EXECUTION_TIMEOUT', message };
    }
    if (status === 401 || status === 403) {
      return { code: 'EXECUTION_UNAUTHORIZED', message };
    }
    if (status >= 400 && status < 500) {
      return { code: 'EXECUTION_INVALID_REQUEST', message };
    }
    if (status >= 500) {
      return { code: 'EXECUTION_UNAVAILABLE', message };
    }
    return { code: 'EXECUTION_FAILED', message };
  }

  private extractExecutionErrorMessage(error: any): string {
    const responseData = error?.response?.data;
    const responseError = responseData?.error;
    if (typeof responseError?.message === 'string' && responseError.message.trim()) {
      return responseError.message;
    }
    if (typeof responseError === 'string' && responseError.trim()) {
      return responseError;
    }
    if (typeof responseData?.message === 'string' && responseData.message.trim()) {
      return responseData.message;
    }
    return String(error?.message || 'Execution failed');
  }

  private buildPreparedSwapPayload(
    swapPlan: SwapPrepareResponse,
    chainId: number,
    transactions: Array<Record<string, unknown>>
  ): PlainObject {
    const preparedAt = new Date().toISOString();
    const payload: PlainObject = {
      chainId,
      transactions,
      txData: swapPlan.txData || {},
      route: swapPlan.route || {},
      estimatedOutput: swapPlan.estimatedOutput,
      provider: swapPlan.provider,
      providerDebug: swapPlan.providerDebug || {},
      preparedAt,
      stale: typeof swapPlan.stale === 'boolean' ? swapPlan.stale : false,
    };
    if (swapPlan.expiresAt) {
      payload.expiresAt = swapPlan.expiresAt;
      payload.stale = Date.parse(swapPlan.expiresAt) <= Date.now();
    }
    if (swapPlan.minOutput) {
      payload.minOutput = swapPlan.minOutput;
    }
    return payload;
  }

  private createLegacySwapExecutionError(metadata: PlainObject): Error & { status?: number; code?: string } {
    const isClientManaged = metadata.mode === 'client-managed' || metadata.creationSource === 'panorama_export' || metadata.exportFormat === 'encrypted_mnemonic';
    const error = new Error(
      isClientManaged
        ? 'This wallet requires client-side transaction signing and submission.'
        : 'Delegated execution is not available for this wallet.'
    ) as Error & { status?: number; code?: string };
    error.status = 409;
    error.code = isClientManaged ? 'CLIENT_EXECUTION_REQUIRED' : 'DELEGATED_EXECUTION_NOT_AVAILABLE';
    return error;
  }

  private readPreparedSwapMetadata(swap: PlainObject): {
    expiresAt?: string;
    preparedTransactionsCount?: number;
    currentTxHashes: Array<{ hash: string; chainId: number; type?: string; status?: string; nonce?: number; broadcastState?: string }>;
  } {
    const metadata = (swap.metadata || {}) as PlainObject;
    const currentTxHashes = Array.isArray(swap.txHashes)
      ? swap.txHashes.map((txHash) => ({
          hash: String((txHash as PlainObject).hash),
          chainId: Number((txHash as PlainObject).chainId),
          type: typeof (txHash as PlainObject).type === 'string' ? String((txHash as PlainObject).type) : undefined,
          status: typeof (txHash as PlainObject).status === 'string' ? String((txHash as PlainObject).status) : undefined,
          nonce: typeof (txHash as PlainObject).nonce === 'number' ? Number((txHash as PlainObject).nonce) : undefined,
          broadcastState: typeof (txHash as PlainObject).broadcastState === 'string' ? String((txHash as PlainObject).broadcastState) : undefined,
          materializationState: typeof (txHash as PlainObject).materializationState === 'string' ? String((txHash as PlainObject).materializationState) : undefined,
          materializedBy: typeof (txHash as PlainObject).materializedBy === 'string' ? String((txHash as PlainObject).materializedBy) : undefined,
          verifiedAt: typeof (txHash as PlainObject).verifiedAt === 'string' ? String((txHash as PlainObject).verifiedAt) : undefined,
          receiptStatus: typeof (txHash as PlainObject).receiptStatus === 'string' ? String((txHash as PlainObject).receiptStatus) : undefined,
        }))
      : [];
    return {
      expiresAt: typeof metadata.preparedExpiresAt === 'string' ? metadata.preparedExpiresAt : undefined,
      preparedTransactionsCount: typeof metadata.preparedTransactionsCount === 'number' ? metadata.preparedTransactionsCount : undefined,
      currentTxHashes,
    };
  }

  private assertPreparedSwapSubmissionState(
    swap: PlainObject,
    txHashes: Array<{ hash: string; chainId: number; type?: string; status?: string; nonce?: number; broadcastState?: string; materializationState?: string; materializedBy?: string; verifiedAt?: string; receiptStatus?: string }>
  ): void {
    const status = String(swap.status || '');
    const { currentTxHashes } = this.readPreparedSwapMetadata(swap);
    if (status === 'prepared') {
      return;
    }
    if (this.isTerminalOperationStatus(status) || status === 'submitted' || status === 'pending' || status === 'partially_submitted') {
      if (this.areTxHashesEquivalent(currentTxHashes, txHashes) || this.isSupersetTxSubmission(currentTxHashes, txHashes)) {
        return;
      }
      const error = new Error(`Prepared swap can no longer accept new transaction hashes from state ${status}.`) as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'SWAP_SUBMIT_INVALID_STATE';
      throw error;
    }
  }

  private assertPreparedSwapState(swap: PlainObject, code: string): void {
    if (String(swap.status || '') !== 'prepared') {
      const error = new Error('Prepared swap is no longer in a mutable prepared state.') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = code;
      throw error;
    }
  }

  private assertPreparedSwapNotExpired(prepared: { expiresAt?: string }): void {
    if (!prepared.expiresAt) {
      return;
    }
    if (Date.parse(prepared.expiresAt) <= Date.now()) {
      const error = new Error('Prepared swap has expired. Prepare a new swap before submitting.') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'SWAP_PREPARED_EXPIRED';
      throw error;
    }
  }

  private isTerminalOperationStatus(status: string): boolean {
    return status === 'confirmed' || status === 'failed' || status === 'policy_denied' || status === 'timeout';
  }

  private areTxHashesEquivalent(
    left: Array<{ hash: string; chainId: number; type?: string; status?: string; nonce?: number; broadcastState?: string; materializationState?: string; materializedBy?: string; verifiedAt?: string; receiptStatus?: string }>,
    right: Array<{ hash: string; chainId: number; type?: string; status?: string; nonce?: number; broadcastState?: string; materializationState?: string; materializedBy?: string; verifiedAt?: string; receiptStatus?: string }>
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => {
      const other = right[index];
      return item.hash === other.hash && item.chainId === other.chainId && (item.type || 'swap') === (other.type || 'swap');
    });
  }

  private isSupersetTxSubmission(
    current: Array<{ hash: string; chainId: number; type?: string; status?: string; nonce?: number; broadcastState?: string; materializationState?: string; materializedBy?: string; verifiedAt?: string; receiptStatus?: string }>,
    next: Array<{ hash: string; chainId: number; type?: string; status?: string; nonce?: number; broadcastState?: string; materializationState?: string; materializedBy?: string; verifiedAt?: string; receiptStatus?: string }>
  ): boolean {
    if (next.length < current.length) {
      return false;
    }
    const currentKeys = new Set(current.map((txHash) => `${txHash.hash}:${txHash.chainId}:${txHash.type || 'swap'}`));
    const nextKeys = new Set(next.map((txHash) => `${txHash.hash}:${txHash.chainId}:${txHash.type || 'swap'}`));
    return Array.from(currentKeys).every((key) => nextKeys.has(key));
  }

  private deriveSubmittedSwapStatus(
    txHashes: Array<{ hash: string; chainId: number; type?: string; status?: string; nonce?: number; broadcastState?: string; materializationState?: string; materializedBy?: string; verifiedAt?: string; receiptStatus?: string }>,
    expectedCount?: number
  ): 'submitted' | 'partially_submitted' | 'confirmed' {
    if (typeof expectedCount === 'number' && txHashes.length < expectedCount) {
      return 'partially_submitted';
    }
    if (txHashes.every((txHash) => txHash.status === 'confirmed')) {
      return 'confirmed';
    }
    if (txHashes.some((txHash) => txHash.status === 'unknown' || txHash.materializationState !== 'verified')) {
      return 'partially_submitted';
    }
    return 'submitted';
  }

  private computePreparedTransactionFingerprint(chainId: number, transactions: Array<Record<string, unknown>>): string {
    return createHash('sha256')
      .update(JSON.stringify({ chainId, transactions }))
      .digest('hex');
  }

  private async reconcileSwapStatus(transaction: PlainObject): Promise<PlainObject> {
    const status = String(transaction.status || '');
    if (status !== 'submitted' && status !== 'pending' && status !== 'partially_submitted') {
      return transaction;
    }

    const preparedMetadata = this.readPreparedSwapMetadata(transaction);
    const txHashes = Array.isArray(transaction.txHashes)
      ? transaction.txHashes.map((txHash) => ({
          hash: String((txHash as PlainObject).hash || ''),
          chainId: Number((txHash as PlainObject).chainId || transaction.fromChainId || 0),
          type: typeof (txHash as PlainObject).type === 'string' ? String((txHash as PlainObject).type) : 'swap',
          status: typeof (txHash as PlainObject).status === 'string' ? String((txHash as PlainObject).status) : 'pending',
          nonce: typeof (txHash as PlainObject).nonce === 'number' ? Number((txHash as PlainObject).nonce) : undefined,
          broadcastState: typeof (txHash as PlainObject).broadcastState === 'string' ? String((txHash as PlainObject).broadcastState) : undefined,
          materializationState: typeof (txHash as PlainObject).materializationState === 'string' ? String((txHash as PlainObject).materializationState) : undefined,
          materializedBy: typeof (txHash as PlainObject).materializedBy === 'string' ? String((txHash as PlainObject).materializedBy) : undefined,
          verifiedAt: typeof (txHash as PlainObject).verifiedAt === 'string' ? String((txHash as PlainObject).verifiedAt) : undefined,
          receiptStatus: typeof (txHash as PlainObject).receiptStatus === 'string' ? String((txHash as PlainObject).receiptStatus) : undefined,
        }))
      : [];

    if (txHashes.length === 0) {
      return transaction;
    }

    const provider = this.createChainProvider(Number(txHashes[0].chainId || transaction.fromChainId || 0));
    if (!provider) {
      return transaction;
    }

    const reconciledTxHashes = await Promise.all(txHashes.map(async (txHash) => {
      if (!txHash.hash) {
        return txHash;
      }
      const transactionByHash = await provider.getTransaction(txHash.hash).catch(() => null);
      const receipt = await provider.getTransactionReceipt(txHash.hash).catch(() => null);
      if (receipt) {
        return receipt.status === 1
          ? {
              ...txHash,
              status: 'confirmed',
              materializationState: 'verified',
              materializedBy: txHash.materializedBy || 'receipt',
              verifiedAt: txHash.verifiedAt || new Date().toISOString(),
              receiptStatus: 'success',
            }
          : {
              ...txHash,
              status: 'failed',
              materializationState: 'verified',
              materializedBy: txHash.materializedBy || 'receipt',
              verifiedAt: txHash.verifiedAt || new Date().toISOString(),
              receiptStatus: 'reverted',
            };
      }
      if (transactionByHash) {
        return {
          ...txHash,
          status: txHash.status === 'confirmed' ? 'confirmed' : 'submitted',
          materializationState: 'verified',
          materializedBy: txHash.materializedBy || 'hash_lookup',
          verifiedAt: txHash.verifiedAt || new Date().toISOString(),
        };
      }
      return {
        ...txHash,
        status: txHash.status === 'confirmed' ? 'confirmed' : 'pending',
        materializationState: 'not_found',
      };
    }));

    const submittedAt = this.readSubmittedAt(transaction);
    const allMissing = reconciledTxHashes.every((txHash) => txHash.materializationState === 'not_found');
    const staleSubmitted = allMissing && submittedAt !== null && Date.now() - submittedAt >= this.getMissingSubmissionGracePeriodMs();
    const expectedCount = preparedMetadata.preparedTransactionsCount;
    const isPartialBundle = typeof expectedCount === 'number' && reconciledTxHashes.length < expectedCount;

    let nextStatus: 'submitted' | 'partially_submitted' | 'confirmed' | 'failed';
    if (staleSubmitted || reconciledTxHashes.some((txHash) => txHash.status === 'failed')) {
      nextStatus = 'failed';
    } else if (!isPartialBundle && reconciledTxHashes.every((txHash) => txHash.status === 'confirmed')) {
      nextStatus = 'confirmed';
    } else if (isPartialBundle || reconciledTxHashes.some((txHash) => txHash.status === 'confirmed')) {
      nextStatus = 'partially_submitted';
    } else {
      nextStatus = 'submitted';
    }

    const txHashesChanged = !this.areTxHashesEquivalent(
      txHashes.map((txHash) => ({
        hash: txHash.hash,
        chainId: txHash.chainId,
        type: txHash.type,
        status: txHash.status,
        nonce: txHash.nonce,
        broadcastState: txHash.broadcastState,
        materializationState: txHash.materializationState,
        materializedBy: txHash.materializedBy,
        verifiedAt: txHash.verifiedAt,
        receiptStatus: txHash.receiptStatus,
      })),
      reconciledTxHashes.map((txHash) => ({
        hash: txHash.hash,
        chainId: txHash.chainId,
        type: txHash.type,
        status: txHash.status,
        nonce: txHash.nonce,
        broadcastState: txHash.broadcastState,
        materializationState: txHash.materializationState,
        materializedBy: txHash.materializedBy,
        verifiedAt: txHash.verifiedAt,
        receiptStatus: txHash.receiptStatus,
      }))
    );

    if (!txHashesChanged && nextStatus === status) {
      return transaction;
    }

    const updated = await this.dbGateway.updateIntentTransaction(String(transaction.id), {
      status: nextStatus,
      txHashes: reconciledTxHashes,
      metadata: {
        ...(((transaction.metadata || {}) as PlainObject)),
        clientReceiptReconciliation: {
          checkedAt: new Date().toISOString(),
          chainId: reconciledTxHashes[0]?.chainId,
          allMissing,
        },
      },
      errorCode: nextStatus === 'failed' ? (staleSubmitted ? 'SUBMITTED_TX_NOT_FOUND' : 'EXECUTION_FAILED') : undefined,
      errorMessage: nextStatus === 'failed'
        ? (staleSubmitted
            ? 'Submitted swap transactions could not be found onchain after the reconciliation grace period.'
            : 'One or more submitted swap transactions reverted onchain.')
        : undefined,
    });

    if (nextStatus === 'confirmed') {
      await this.emitSwapLifecycleEvents(String(transaction.userId), String(transaction.id), 'confirmed', String(reconciledTxHashes[reconciledTxHashes.length - 1]?.hash || ''));
    } else if (nextStatus === 'failed') {
      await this.emitSwapLifecycleEvents(
        String(transaction.userId),
        String(transaction.id),
        'failed',
        undefined,
        staleSubmitted
          ? 'Submitted swap transactions could not be found onchain after the reconciliation grace period.'
          : 'One or more submitted swap transactions reverted onchain.'
      );
    }

    return {
      ...transaction,
      ...updated,
      status: nextStatus,
      txHashes: reconciledTxHashes,
      metadata: {
        ...(((transaction.metadata || {}) as PlainObject)),
        ...((((updated || {}) as PlainObject).metadata || {}) as PlainObject),
      },
    };
  }

  private readSubmittedAt(transaction: PlainObject): number | null {
    const metadata = (transaction.metadata || {}) as PlainObject;
    const clientSubmission = ((metadata.clientSubmission || {}) as PlainObject);
    const submittedAt = typeof clientSubmission.submittedAt === 'string' ? clientSubmission.submittedAt : undefined;
    if (!submittedAt) {
      return null;
    }
    const parsed = Date.parse(submittedAt);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getMissingSubmissionGracePeriodMs(): number {
    const configured = Number(process.env.PANORAMA_SWAP_SUBMISSION_RECONCILIATION_MS || 120000);
    return Number.isFinite(configured) && configured > 0 ? configured : 120000;
  }

  private createChainProvider(chainId: number): JsonRpcProvider | null {
    const rpcUrl = this.resolveRpcUrlForChain(chainId);
    return rpcUrl ? new JsonRpcProvider(rpcUrl) : null;
  }

  private resolveRpcUrlForChain(chainId: number): string | undefined {
    switch (chainId) {
      case 1:
        return process.env.ETHEREUM_RPC_URL || process.env.RPC_URL || process.env.WDK_EVM_RPC_URL;
      case 8453:
        return process.env.BASE_RPC_URL || process.env.WDK_EVM_RPC_URL;
      case 42161:
        return process.env.ARBITRUM_RPC_URL || process.env.WDK_EVM_RPC_URL;
      case 10:
        return process.env.OPTIMISM_RPC_URL || process.env.WDK_EVM_RPC_URL;
      case 137:
        return process.env.POLYGON_RPC_URL || process.env.WDK_EVM_RPC_URL;
      default:
        return process.env.WDK_EVM_RPC_URL;
    }
  }

  private encryptMnemonicExport(
    mnemonic: string,
    exportPassword: string,
    primaryAddress: string,
    chainScope: 'evm' | 'ton' | 'evm_ton'
  ): WalletExportBundle {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const iterations = 600000;
    const key = pbkdf2Sync(exportPassword, salt, iterations, 32, 'sha256');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      format: 'encrypted_mnemonic',
      version: 1,
      cipher: 'aes-256-gcm',
      kdf: 'pbkdf2-sha256',
      iterations,
      chainScope,
      primaryAddress,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  private async deliverWebhook(url: string, body: PlainObject, signature?: string, timestamp?: string): Promise<void> {
    const timeoutMs = Number(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS || 3000);
    const retries = Math.max(0, Number(process.env.WEBHOOK_DELIVERY_RETRIES || 2));
    const retryBackoffMs = Math.max(0, Number(process.env.WEBHOOK_DELIVERY_RETRY_BACKOFF_MS || 250));

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await axios.post(url, body, {
          timeout: timeoutMs,
          headers: {
            ...(signature ? { 'x-panorama-signature': signature } : {}),
            ...(timestamp ? { 'x-panorama-timestamp': timestamp } : {}),
          },
        });
        return;
      } catch (error: any) {
        const status = Number(error?.response?.status || 0);
        const code = String(error?.code || '');
        const retryable = code === 'ECONNABORTED' || status === 429 || status >= 500;
        if (!retryable || attempt >= retries) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, retryBackoffMs * (attempt + 1)));
      }
    }
  }

  private assertTenantOwnership(record: PlainObject, resource: string): void {
    const recordTenant = typeof record.tenantId === 'string' ? record.tenantId : undefined;
    if (recordTenant && recordTenant !== this.dbGateway.getTenantId()) {
      const error = new Error(`${resource} tenant mismatch`) as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'TENANT_FORBIDDEN';
      throw error;
    }
  }
}
