import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PanoramaV1Service } from '../../../application/services/PanoramaV1Service';

const CreateWalletSchema = z.object({
  chain: z.string().min(1),
  address: z.string().min(1).optional(),
  walletType: z.enum(['ton', 'evm', 'smart_wallet', 'panorama_wallet']),
  provider: z.enum(['thirdweb', 'wdk']).optional().default('wdk'),
  metadata: z.record(z.unknown()).optional(),
});

const CreateWalletExportSchema = z.object({
  chain: z.string().min(1),
  chainScope: z.enum(['evm', 'ton', 'evm_ton']),
  exportPassword: z.string().min(8),
  name: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const LinkWalletSchema = z.object({
  chain: z.string().min(1),
  address: z.string().min(1),
  walletType: z.enum(['ton', 'evm', 'smart_wallet', 'panorama_wallet']),
  provider: z.enum(['thirdweb', 'wdk']).optional().default('wdk'),
  providerWalletId: z.string().optional(),
  publicKey: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const RegisterWalletSessionSchema = z.object({
  provider: z.enum(['thirdweb', 'wdk']).optional().default('wdk'),
  chain: z.string().min(1),
  sessionId: z.string().optional(),
  delegationId: z.string().optional(),
  publicKey: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  allowedChains: z.array(z.number().int()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const CreatePolicySchema = z.object({
  walletId: z.string().uuid(),
  name: z.string().optional(),
  allowedActions: z.array(z.string()).min(1),
  allowedAssets: z.array(z.string()).min(1),
  maxAmount: z.string().min(1),
  allowedChains: z.array(z.number().int()).min(1),
  expiresAt: z.string().datetime(),
});

const VerifyOwnershipSchema = z.object({
  challengeId: z.string().uuid(),
  signature: z.string().min(1),
  address: z.string().optional(),
  publicKey: z.string().optional(),
});

const CreateSwapSchema = z.object({
  walletId: z.string().uuid(),
  policyId: z.string().uuid(),
  provider: z.enum(['thirdweb', 'wdk']),
  signedIntent: z.string().min(1),
  swapProviderHint: z.string().min(1).optional(),
  swap: z.object({
    fromChainId: z.number().int(),
    toChainId: z.number().int(),
    fromToken: z.string().min(1),
    toToken: z.string().min(1),
    amountRaw: z.string().min(1),
    amountDisplay: z.string().min(1),
    slippage: z.number().positive().optional(),
  }),
});

const SubmitPreparedSwapSchema = z.object({
  walletId: z.string().uuid(),
  txHashes: z.array(z.object({
    hash: z.string().min(1),
    chainId: z.number().int(),
    type: z.string().optional(),
    status: z.string().optional(),
    nonce: z.number().int().nonnegative().optional(),
    broadcastState: z.string().optional(),
    materializationState: z.string().optional(),
    materializedBy: z.string().optional(),
    verifiedAt: z.string().optional(),
    receiptStatus: z.string().optional(),
  })).min(1),
  metadata: z.record(z.unknown()).optional(),
});

const FailPreparedSwapSchema = z.object({
  walletId: z.string().uuid(),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const CreateStakeSchema = z.object({
  walletId: z.string().uuid(),
  policyId: z.string().uuid(),
  provider: z.enum(['thirdweb', 'wdk']),
  signedIntent: z.string().min(1),
  stake: z.object({
    chainId: z.number().int(),
    token: z.string().min(1),
    amountRaw: z.string().min(1),
    amountDisplay: z.string().min(1),
  }),
});

const AddressParamSchema = z.object({
  address: z.string().min(1),
});

const PrepareLiquidStakeSchema = z.object({
  walletId: z.string().uuid(),
  policyId: z.string().uuid(),
  provider: z.enum(['thirdweb', 'wdk']),
  signedIntent: z.string().min(1),
  liquidStake: z.object({
    chainId: z.literal(43114),
    token: z.string().min(1),
    amountRaw: z.string().min(1),
    amountDisplay: z.string().min(1),
  }),
});

const PrepareLiquidUnlockSchema = z.object({
  walletId: z.string().uuid(),
  policyId: z.string().uuid(),
  provider: z.enum(['thirdweb', 'wdk']),
  signedIntent: z.string().min(1),
  liquidStake: z.object({
    chainId: z.literal(43114),
    token: z.string().min(1),
    sAvaxAmountRaw: z.string().min(1),
    sAvaxAmountDisplay: z.string().min(1),
  }),
});

const PrepareLiquidRedeemSchema = z.object({
  walletId: z.string().uuid(),
  policyId: z.string().uuid(),
  provider: z.enum(['thirdweb', 'wdk']),
  signedIntent: z.string().min(1),
  liquidStake: z.object({
    chainId: z.literal(43114),
    token: z.string().min(1),
    userUnlockIndex: z.number().int().nonnegative(),
  }),
});

const CreateLendingSchema = z.object({
  walletId: z.string().uuid(),
  policyId: z.string().uuid(),
  provider: z.enum(['thirdweb', 'wdk']),
  signedIntent: z.string().min(1),
  lending: z.object({
    chainId: z.number().int(),
    action: z.enum(['supply', 'withdraw', 'borrow', 'repay']),
    token: z.string().min(1),
    amountRaw: z.string().min(1),
    amountDisplay: z.string().min(1),
  }),
});

const CreateWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  secret: z.string().optional(),
});

export class PanoramaV1Controller {
  constructor(
    private readonly service: PanoramaV1Service,
    private readonly defaultWalletProvider: 'thirdweb' | 'wdk' = 'wdk'
  ) {}

  private requireUserId(req: Request): string {
    const userId = req.user?.id || req.headers['x-user-id']?.toString();
    if (!userId) {
      const error = new Error('Missing user identity') as Error & { status?: number; code?: string };
      error.status = 401;
      error.code = 'UNAUTHORIZED';
      throw error;
    }
    return userId;
  }

  private getIdempotencyKey(req: Request): string | undefined {
    const header = req.headers['x-idempotency-key'];
    return typeof header === 'string' && header.trim().length > 0 ? header.trim() : undefined;
  }

  private getBearerToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    return typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
  }

  async createWallet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreateWalletSchema
        .extend({ provider: z.enum(['thirdweb', 'wdk']).optional().default(this.defaultWalletProvider) })
        .parse(req.body);
      const result = await this.service.createWallet({ userId, ...payload });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createWalletExport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreateWalletExportSchema.parse(req.body);
      const result = await this.service.createWalletExport({ userId, ...payload });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async linkWallet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = LinkWalletSchema
        .extend({ provider: z.enum(['thirdweb', 'wdk']).optional().default(this.defaultWalletProvider) })
        .parse(req.body);
      const result = await this.service.linkWallet({ userId, ...payload });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getWalletContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const walletId = z.string().uuid().parse(req.params.id);
      const result = await this.service.getWalletContext(walletId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getWalletBalances(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const walletId = z.string().uuid().parse(req.params.id);
      const rawChainIds = typeof req.query.chainIds === 'string' ? req.query.chainIds.trim() : '';
      const chainIds = rawChainIds.length > 0
        ? rawChainIds.split(',').map((value) => Number(value.trim()))
        : undefined;
      if (chainIds && chainIds.some((value) => !Number.isInteger(value))) {
        const error = new Error('chainIds must be a comma-separated list of integers') as Error & { status?: number; code?: string };
        error.status = 400;
        error.code = 'INVALID_CHAIN_IDS';
        throw error;
      }
      const includeZeroBalances = req.query.includeZeroBalances === 'true';
      const result = await this.service.getWalletBalances(walletId, userId, {
        chainIds,
        includeZeroBalances,
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async registerWalletSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const walletId = z.string().uuid().parse(req.params.id);
      const payload = RegisterWalletSessionSchema.parse(req.body);
      const result = await this.service.registerWalletSession({ userId, walletId, ...payload });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async prepareOwnershipChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const walletId = z.string().uuid().parse(req.params.id);
      const result = await this.service.prepareOwnershipChallenge(walletId, userId);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async verifyOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const walletId = z.string().uuid().parse(req.params.id);
      const payload = VerifyOwnershipSchema.parse(req.body);
      const result = await this.service.verifyOwnership(walletId, userId, payload);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getOwnershipStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const walletId = z.string().uuid().parse(req.params.id);
      const result = await this.service.getOwnershipStatus(walletId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreatePolicySchema.parse(req.body);
      const result = await this.service.createPolicy({ userId, ...payload });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async approvePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const policyId = z.string().uuid().parse(req.params.id);
      const result = await this.service.approvePolicy(policyId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async revokePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const policyId = z.string().uuid().parse(req.params.id);
      const result = await this.service.revokePolicy(policyId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreateSwapSchema.parse(req.body);
      const result = await this.service.createSwap({
        userId,
        authToken: this.getBearerToken(req),
        idempotencyKey: this.getIdempotencyKey(req),
        ...payload,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async prepareSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreateSwapSchema.parse(req.body);
      const result = await this.service.prepareSwap({
        userId,
        authToken: this.getBearerToken(req),
        idempotencyKey: this.getIdempotencyKey(req),
        ...payload,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async submitPreparedSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const swapId = z.string().uuid().parse(req.params.id);
      const payload = SubmitPreparedSwapSchema.parse(req.body);
      const result = await this.service.submitPreparedSwap({
        userId,
        swapId,
        ...payload,
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async failPreparedSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const swapId = z.string().uuid().parse(req.params.id);
      const payload = FailPreparedSwapSchema.parse(req.body);
      const result = await this.service.failPreparedSwap({
        userId,
        swapId,
        ...payload,
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const swapId = z.string().uuid().parse(req.params.id);
      const result = await this.service.getSwap(swapId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createStake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreateStakeSchema.parse(req.body);
      const result = await this.service.createStake({
        userId,
        idempotencyKey: this.getIdempotencyKey(req),
        ...payload,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getStake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const operationId = z.string().uuid().parse(req.params.id);
      const result = await this.service.getStake(operationId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getLiquidStakePosition(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const { address } = AddressParamSchema.parse(req.params);
      const result = await this.service.getLiquidStakePosition({ userId, address });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async prepareLiquidStake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = PrepareLiquidStakeSchema.parse(req.body);
      const result = await this.service.prepareLiquidStake({
        userId,
        idempotencyKey: this.getIdempotencyKey(req),
        ...payload,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async prepareLiquidUnlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = PrepareLiquidUnlockSchema.parse(req.body);
      const result = await this.service.prepareLiquidUnlock({
        userId,
        idempotencyKey: this.getIdempotencyKey(req),
        ...payload,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async prepareLiquidRedeem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = PrepareLiquidRedeemSchema.parse(req.body);
      const result = await this.service.prepareLiquidRedeem({
        userId,
        idempotencyKey: this.getIdempotencyKey(req),
        ...payload,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async submitPreparedLiquidOperation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const operationId = z.string().uuid().parse(req.params.id);
      const payload = SubmitPreparedSwapSchema.parse(req.body);
      const result = await this.service.submitPreparedLiquidOperation({
        userId,
        operationId,
        ...payload,
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async failPreparedLiquidOperation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const operationId = z.string().uuid().parse(req.params.id);
      const payload = FailPreparedSwapSchema.parse(req.body);
      const result = await this.service.failPreparedLiquidOperation({
        userId,
        operationId,
        ...payload,
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getLendingMarkets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const result = await this.service.getLendingMarkets(userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createLendingAction(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreateLendingSchema.parse(req.body);
      const result = await this.service.createLendingAction({
        userId,
        idempotencyKey: this.getIdempotencyKey(req),
        ...payload,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getLendingOperation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const operationId = z.string().uuid().parse(req.params.id);
      const result = await this.service.getLendingOperation(operationId, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async registerWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.requireUserId(req);
      const payload = CreateWebhookSchema.parse(req.body);
      const result = await this.service.registerWebhook({ userId, ...payload });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}
