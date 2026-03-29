import { createHash, randomUUID } from 'crypto';
import { PlainObject } from '../../infrastructure/clients/DatabaseGatewayClient';
import {
  LiquidStakePositionResponse,
  LiquidStakingClient,
} from '../../infrastructure/clients/LiquidStakingClient';

export type WalletProvider = 'thirdweb' | 'wdk';

type WalletRecord = PlainObject & {
  id: string;
  userId: string;
  address: string;
  chain: string;
  walletType: 'ton' | 'evm' | 'smart_wallet' | 'panorama_wallet';
  metadata?: PlainObject;
};

type PolicyEnvelope = {
  id: string;
  userId: string;
  walletId: string;
  allowedActions: string[];
  allowedAssets: string[];
  maxAmount: string;
  allowedChains: number[];
  expiresAt: string;
  status: 'draft' | 'approved' | 'revoked';
  createdAt: string;
  updatedAt: string;
};

type SubmitPreparedInput = {
  userId: string;
  operationId: string;
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
};

type FailPreparedInput = {
  userId: string;
  operationId: string;
  walletId: string;
  errorCode?: string;
  errorMessage: string;
  metadata?: PlainObject;
};

type PrepareStakeInput = {
  userId: string;
  walletId: string;
  policyId: string;
  provider: WalletProvider;
  idempotencyKey?: string;
  signedIntent: string;
  liquidStake: {
    chainId: number;
    token: string;
    amountRaw: string;
    amountDisplay: string;
  };
};

type PrepareUnlockInput = {
  userId: string;
  walletId: string;
  policyId: string;
  provider: WalletProvider;
  idempotencyKey?: string;
  signedIntent: string;
  liquidStake: {
    chainId: number;
    token: string;
    sAvaxAmountRaw: string;
    sAvaxAmountDisplay: string;
  };
};

type PrepareRedeemInput = {
  userId: string;
  walletId: string;
  policyId: string;
  provider: WalletProvider;
  idempotencyKey?: string;
  signedIntent: string;
  liquidStake: {
    chainId: number;
    token: string;
    userUnlockIndex: number;
  };
};

type Dependencies = {
  dbGateway: {
    getTenantId(): string;
    getIntentByIdempotencyKey(userId: string, key: string): Promise<PlainObject | null>;
    createIntentTransaction(payload: PlainObject): Promise<unknown>;
    updateIntentTransaction(operationId: string, payload: PlainObject): Promise<unknown>;
  };
  liquidStakingClient: LiquidStakingClient;
  getOwnedWallet(walletId: string, userId: string): Promise<WalletRecord>;
  getOwnedOperation(operationId: string, userId: string, action?: string): Promise<PlainObject>;
  getValidatedPolicy(policyId: string, userId: string): Promise<PolicyEnvelope>;
  assertOwnershipVerified(wallet: WalletRecord): void;
  assertWalletProviderMatch(wallet: WalletRecord, provider: WalletProvider, context: string): Promise<void>;
  assertPolicyAction(
    policy: PolicyEnvelope,
    input: { action: string; amountRaw: string; chainIds: number[]; fromToken: string; toToken?: string }
  ): void;
  assertExecutionAllowed(input: {
    provider: WalletProvider;
    walletAddress: string;
    action: 'stake' | 'request_unlock' | 'redeem';
    chainId: number;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  emitEvent(userId: string, event: string, data?: PlainObject, operationId?: string): Promise<void>;
  mapExecutionError(error: any): { code: string; message: string };
  isTerminalOperationStatus(status: string): boolean;
};

const CHAIN_ID = 43114;

export class LiquidStakingOperationService {
  constructor(private readonly deps: Dependencies) {}

  async getPosition(address: string): Promise<LiquidStakePositionResponse> {
    return this.deps.liquidStakingClient.getPosition(address);
  }

  async prepareStake(input: PrepareStakeInput): Promise<PlainObject> {
    return this.prepareOperation({
      userId: input.userId,
      walletId: input.walletId,
      policyId: input.policyId,
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      action: 'stake',
      chainId: input.liquidStake.chainId,
      fromToken: input.liquidStake.token,
      amountRaw: input.liquidStake.amountRaw,
      amountDisplay: input.liquidStake.amountDisplay,
      downstreamCall: async (walletAddress) => this.deps.liquidStakingClient.prepareStake({
        userAddress: walletAddress,
        amount: input.liquidStake.amountRaw,
      }),
      requestMetadata: {
        token: input.liquidStake.token,
        amountRaw: input.liquidStake.amountRaw,
        amountDisplay: input.liquidStake.amountDisplay,
      },
    });
  }

  async prepareRequestUnlock(input: PrepareUnlockInput): Promise<PlainObject> {
    return this.prepareOperation({
      userId: input.userId,
      walletId: input.walletId,
      policyId: input.policyId,
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      action: 'request_unlock',
      chainId: input.liquidStake.chainId,
      fromToken: input.liquidStake.token,
      amountRaw: input.liquidStake.sAvaxAmountRaw,
      amountDisplay: input.liquidStake.sAvaxAmountDisplay,
      downstreamCall: async (walletAddress) => this.deps.liquidStakingClient.prepareRequestUnlock({
        userAddress: walletAddress,
        sAvaxAmount: input.liquidStake.sAvaxAmountRaw,
      }),
      requestMetadata: {
        token: input.liquidStake.token,
        sAvaxAmountRaw: input.liquidStake.sAvaxAmountRaw,
        sAvaxAmountDisplay: input.liquidStake.sAvaxAmountDisplay,
      },
    });
  }

  async prepareRedeem(input: PrepareRedeemInput): Promise<PlainObject> {
    return this.prepareOperation({
      userId: input.userId,
      walletId: input.walletId,
      policyId: input.policyId,
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      action: 'redeem',
      chainId: input.liquidStake.chainId,
      fromToken: input.liquidStake.token,
      amountRaw: '0',
      amountDisplay: '0',
      downstreamCall: async (walletAddress) => this.deps.liquidStakingClient.prepareRedeem({
        userAddress: walletAddress,
        userUnlockIndex: input.liquidStake.userUnlockIndex,
      }),
      requestMetadata: {
        token: input.liquidStake.token,
        userUnlockIndex: input.liquidStake.userUnlockIndex,
      },
    });
  }

  async submitPreparedOperation(input: SubmitPreparedInput): Promise<PlainObject> {
    const wallet = await this.deps.getOwnedWallet(input.walletId, input.userId);
    const operation = await this.deps.getOwnedOperation(input.operationId, input.userId);
    if (String(operation.walletId) !== String(wallet.id)) {
      const error = new Error('Liquid staking operation does not belong to the provided wallet.') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'LIQUID_STAKING_WALLET_MISMATCH';
      throw error;
    }

    const prepared = this.readPreparedMetadata(operation);
    this.assertPreparedNotExpired(prepared, 'Liquid staking operation has expired. Prepare a new operation before submitting.', 'LIQUID_STAKING_PREPARED_EXPIRED');

    const txHashes = input.txHashes.map((txHash) => ({
      hash: String(txHash.hash),
      chainId: Number(txHash.chainId),
      type: txHash.type || String(operation.action || 'stake'),
      status: txHash.status || 'pending',
      nonce: typeof txHash.nonce === 'number' ? txHash.nonce : undefined,
      broadcastState: typeof txHash.broadcastState === 'string' ? txHash.broadcastState : undefined,
      materializationState: typeof txHash.materializationState === 'string' ? txHash.materializationState : undefined,
      materializedBy: typeof txHash.materializedBy === 'string' ? txHash.materializedBy : undefined,
      verifiedAt: typeof txHash.verifiedAt === 'string' ? txHash.verifiedAt : undefined,
      receiptStatus: typeof txHash.receiptStatus === 'string' ? txHash.receiptStatus : undefined,
    }));
    if (txHashes.some((txHash) => txHash.chainId !== prepared.chainId)) {
      const error = new Error(`Prepared liquid staking expects submissions on chain ${prepared.chainId}.`) as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'LIQUID_STAKING_SUBMIT_CHAIN_MISMATCH';
      throw error;
    }

    this.assertPreparedSubmissionState(operation, txHashes);
    const submissionStatus = this.deriveSubmittedStatus(txHashes, prepared.transactionsCount);
    const primaryTxHash = txHashes[0]?.hash;

    await this.deps.dbGateway.updateIntentTransaction(input.operationId, {
      status: submissionStatus,
      txHashes,
      metadata: {
        ...((operation.metadata || {}) as PlainObject),
        clientSubmission: {
          ...(input.metadata || {}),
          submittedAt: new Date().toISOString(),
        },
      },
      errorCode: undefined,
      errorMessage: undefined,
    });

    await this.deps.emitEvent(
      input.userId,
      submissionStatus === 'confirmed' ? 'staking.liquid.confirmed' : 'staking.liquid.submitted',
      { operationId: input.operationId, action: operation.action, txHash: primaryTxHash },
      input.operationId
    );
    return this.deps.getOwnedOperation(input.operationId, input.userId);
  }

  async failPreparedOperation(input: FailPreparedInput): Promise<PlainObject> {
    const wallet = await this.deps.getOwnedWallet(input.walletId, input.userId);
    const operation = await this.deps.getOwnedOperation(input.operationId, input.userId);
    if (String(operation.walletId) !== String(wallet.id)) {
      const error = new Error('Liquid staking operation does not belong to the provided wallet.') as Error & { status?: number; code?: string };
      error.status = 403;
      error.code = 'LIQUID_STAKING_WALLET_MISMATCH';
      throw error;
    }

    this.assertPreparedState(operation, 'LIQUID_STAKING_FAIL_INVALID_STATE');
    this.assertPreparedNotExpired(
      this.readPreparedMetadata(operation),
      'Liquid staking operation has expired. Prepare a new operation before failing.',
      'LIQUID_STAKING_PREPARED_EXPIRED'
    );

    await this.deps.dbGateway.updateIntentTransaction(input.operationId, {
      status: 'failed',
      errorCode: input.errorCode || 'CLIENT_EXECUTION_FAILED',
      errorMessage: input.errorMessage,
      metadata: {
        ...((operation.metadata || {}) as PlainObject),
        clientFailure: {
          ...(input.metadata || {}),
          source: 'client',
          failedAt: new Date().toISOString(),
        },
      },
    });

    await this.deps.emitEvent(input.userId, 'staking.liquid.failed', {
      operationId: input.operationId,
      action: operation.action,
      errorCode: input.errorCode || 'CLIENT_EXECUTION_FAILED',
      errorMessage: input.errorMessage,
    }, input.operationId);
    return this.deps.getOwnedOperation(input.operationId, input.userId);
  }

  private async prepareOperation(input: {
    userId: string;
    walletId: string;
    policyId: string;
    provider: WalletProvider;
    idempotencyKey?: string;
    action: 'stake' | 'request_unlock' | 'redeem';
    chainId: number;
    fromToken: string;
    amountRaw: string;
    amountDisplay: string;
    downstreamCall(walletAddress: string): Promise<{ bundle?: { steps?: Array<Record<string, unknown>> }; metadata?: Record<string, unknown> }>;
    requestMetadata: Record<string, unknown>;
  }): Promise<PlainObject> {
    if (input.idempotencyKey) {
      const existing = await this.deps.dbGateway.getIntentByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing && String(existing.protocol) === 'liquid-staking-v1' && String(existing.action) === input.action) {
        return this.deps.getOwnedOperation(String(existing.id), input.userId, input.action);
      }
    }

    const wallet = await this.deps.getOwnedWallet(input.walletId, input.userId);
    this.deps.assertOwnershipVerified(wallet);
    await this.deps.assertWalletProviderMatch(wallet, input.provider, 'liquid staking');
    await this.assertLiquidOperationAllowed(wallet, input.provider, input.action, input.chainId);

    const policy = await this.deps.getValidatedPolicy(input.policyId, input.userId);
    this.assertLiquidPolicy(policy, input.action, input.chainId, input.fromToken, input.amountRaw);

    const operationId = randomUUID();
    const operation = {
      id: operationId,
      userId: input.userId,
      walletId: input.walletId,
      action: input.action,
      protocol: 'liquid-staking-v1',
      fromChainId: input.chainId,
      fromAssetAddress: input.fromToken,
      fromAssetSymbol: input.fromToken,
      fromAssetDecimals: 18,
      fromAmountRaw: input.amountRaw,
      fromAmountDisplay: input.amountDisplay,
      toChainId: input.chainId,
      toAssetAddress: input.action === 'stake' ? 'sAVAX' : 'AVAX',
      toAssetSymbol: input.action === 'stake' ? 'sAVAX' : 'AVAX',
      toAssetDecimals: 18,
      txHashes: [],
      status: 'prepared',
      provider: input.provider,
      metadata: {
        policyId: input.policyId,
        idempotencyKey: input.idempotencyKey,
        liquidStakingAction: input.action,
      },
      tenantId: this.deps.dbGateway.getTenantId(),
    };

    await this.deps.dbGateway.createIntentTransaction(operation);
    await this.deps.emitEvent(input.userId, 'staking.liquid.accepted', {
      operationId,
      action: input.action,
      policyId: input.policyId,
    }, operationId);

    try {
      const downstream = await input.downstreamCall(String(wallet.address));
      const steps = Array.isArray(downstream.bundle?.steps) ? downstream.bundle?.steps ?? [] : [];
      const preparedAt = new Date().toISOString();
      const fingerprint = createHash('sha256').update(JSON.stringify({ chainId: input.chainId, steps })).digest('hex');
      const prepared = {
        chainId: input.chainId,
        transactions: steps,
        bundle: downstream.bundle || {},
        metadata: downstream.metadata || {},
        preparedAt,
      };

      await this.deps.dbGateway.updateIntentTransaction(operationId, {
        status: 'prepared',
        metadata: {
          ...((operation.metadata || {}) as PlainObject),
          preparedWalletAddress: wallet.address,
          preparedChainId: input.chainId,
          preparedTransactionsCount: steps.length,
          preparedBundle: downstream.bundle || {},
          preparedDownstreamMetadata: downstream.metadata || {},
          preparedAt,
          preparedFingerprint: fingerprint,
          liquidStakeRequest: input.requestMetadata,
        },
      });

      return {
        ...(await this.deps.getOwnedOperation(operationId, input.userId, input.action)),
        prepared,
      };
    } catch (error: any) {
      const mapped = this.mapLiquidExecutionError(error);
      await this.deps.dbGateway.updateIntentTransaction(operationId, {
        status: 'failed',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });
      await this.deps.emitEvent(
        input.userId,
        mapped.code === 'LIQUID_STAKING_PREPARE_TIMEOUT' ? 'staking.liquid.timeout' : 'staking.liquid.failed',
        { operationId, action: input.action, errorCode: mapped.code, errorMessage: mapped.message },
        operationId
      );
      throw Object.assign(error, { operationId });
    }
  }

  private async assertLiquidOperationAllowed(
    wallet: WalletRecord,
    provider: WalletProvider,
    action: 'stake' | 'request_unlock' | 'redeem',
    chainId: number
  ): Promise<void> {
    await this.deps.assertExecutionAllowed({
      provider,
      walletAddress: String(wallet.address),
      action,
      chainId,
      metadata: (wallet.metadata || {}) as Record<string, unknown>,
    });
  }

  private assertLiquidPolicy(
    policy: PolicyEnvelope,
    action: 'stake' | 'request_unlock' | 'redeem',
    chainId: number,
    fromToken: string,
    amountRaw: string
  ): void {
    const assetAliases = this.resolvePolicyAssets(fromToken, action);
    const amountToCheck = action === 'redeem' ? '0' : amountRaw;
    let lastError: Error | null = null;

    for (const candidate of assetAliases) {
      try {
        this.deps.assertPolicyAction(policy, {
          action,
          amountRaw: amountToCheck,
          fromToken: candidate.fromToken,
          toToken: candidate.toToken,
          chainIds: [chainId],
        });
        return;
      } catch (error: any) {
        lastError = error;
      }
    }

    throw lastError || new Error('Liquid staking policy denied');
  }

  private resolvePolicyAssets(fromToken: string, action: 'stake' | 'request_unlock' | 'redeem') {
    const normalized = fromToken.toLowerCase();
    if (action === 'stake') {
      return [
        { fromToken, toToken: 'sAVAX' },
        { fromToken: normalized === 'avax' ? 'AVAX' : fromToken, toToken: 'savax' },
      ];
    }
    if (action === 'request_unlock') {
      return [
        { fromToken, toToken: 'AVAX' },
        { fromToken: normalized === 'savax' ? 'sAVAX' : fromToken, toToken: 'avax' },
      ];
    }
    return [
      { fromToken, toToken: 'AVAX' },
      { fromToken: 'sAVAX', toToken: 'AVAX' },
      { fromToken: 'savax', toToken: 'avax' },
    ];
  }

  private mapLiquidExecutionError(error: any): { code: string; message: string } {
    const mapped = this.deps.mapExecutionError(error);
    if (mapped.code === 'EXECUTION_TIMEOUT') {
      return { code: 'LIQUID_STAKING_PREPARE_TIMEOUT', message: mapped.message };
    }
    if (mapped.code === 'EXECUTION_UNAVAILABLE' || mapped.code === 'SWAP_PROVIDER_UNAVAILABLE') {
      return { code: 'LIQUID_STAKING_UNAVAILABLE', message: mapped.message };
    }
    if (mapped.code === 'EXECUTION_INVALID_REQUEST') {
      return { code: 'LIQUID_STAKING_INVALID_REQUEST', message: mapped.message };
    }
    return mapped;
  }

  private readPreparedMetadata(operation: PlainObject): { expiresAt?: string; transactionsCount?: number; chainId: number; currentTxHashes: Array<{ hash: string; chainId: number; type?: string; status?: string }> } {
    const metadata = (operation.metadata || {}) as PlainObject;
    const currentTxHashes = Array.isArray(operation.txHashes)
      ? operation.txHashes.map((txHash) => ({
          hash: String((txHash as PlainObject).hash),
          chainId: Number((txHash as PlainObject).chainId),
          type: typeof (txHash as PlainObject).type === 'string' ? String((txHash as PlainObject).type) : undefined,
          status: typeof (txHash as PlainObject).status === 'string' ? String((txHash as PlainObject).status) : undefined,
        }))
      : [];
    return {
      expiresAt: typeof metadata.preparedExpiresAt === 'string' ? metadata.preparedExpiresAt : undefined,
      transactionsCount: typeof metadata.preparedTransactionsCount === 'number' ? metadata.preparedTransactionsCount : undefined,
      chainId: typeof metadata.preparedChainId === 'number' ? metadata.preparedChainId : CHAIN_ID,
      currentTxHashes,
    };
  }

  private assertPreparedState(operation: PlainObject, code: string): void {
    if (String(operation.status || '') !== 'prepared') {
      const error = new Error('Prepared liquid staking operation is no longer in a mutable prepared state.') as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = code;
      throw error;
    }
  }

  private assertPreparedNotExpired(prepared: { expiresAt?: string }, message: string, code: string): void {
    if (!prepared.expiresAt) return;
    if (Date.parse(prepared.expiresAt) <= Date.now()) {
      const error = new Error(message) as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = code;
      throw error;
    }
  }

  private assertPreparedSubmissionState(
    operation: PlainObject,
    txHashes: Array<{ hash: string; chainId: number; type?: string; status?: string }>
  ): void {
    const status = String(operation.status || '');
    const { currentTxHashes } = this.readPreparedMetadata(operation);
    if (status === 'prepared') return;
    if (this.deps.isTerminalOperationStatus(status) || status === 'submitted' || status === 'pending' || status === 'partially_submitted') {
      const currentKeys = new Set(currentTxHashes.map((txHash) => `${txHash.hash}:${txHash.chainId}:${txHash.type || 'stake'}`));
      const nextKeys = new Set(txHashes.map((txHash) => `${txHash.hash}:${txHash.chainId}:${txHash.type || 'stake'}`));
      const equivalent = currentKeys.size === nextKeys.size && Array.from(currentKeys).every((key) => nextKeys.has(key));
      if (equivalent) return;
      const superset = Array.from(currentKeys).every((key) => nextKeys.has(key));
      if (superset) return;
      const error = new Error(`Prepared liquid staking can no longer accept new transaction hashes from state ${status}.`) as Error & { status?: number; code?: string };
      error.status = 409;
      error.code = 'LIQUID_STAKING_SUBMIT_INVALID_STATE';
      throw error;
    }
  }

  private deriveSubmittedStatus(
    txHashes: Array<{ status?: string; materializationState?: string }>,
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
}
