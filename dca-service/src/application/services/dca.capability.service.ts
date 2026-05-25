/**
 * DCACapabilityService — application facade for the automation capability.
 *
 * Responsibilities:
 *  1. Provider selection via ProviderRegistry + ChainAssetPriorityPolicy
 *  2. Idempotency: state-mutating calls are cached in Redis for 24h keyed by x-idempotency-key
 *  3. Ownership validation: ensures the requesting user can only act on their own resources
 *  4. CapabilityResponse envelope wrapping (latencyMs, traceId, provider info)
 *
 * Callers (route handlers) never catch CapabilityError — that's the HTTP layer's job.
 */

import {
  ProviderRegistry,
  ChainAssetPriorityPolicy,
  CapabilityError,
  buildSuccess,
  buildError,
  type CapabilityRequest,
  type CapabilityResponse,
  type ProviderInfo,
} from '@panorama/capability';

import type { IDCAProvider } from '../../domain/ports/dca.provider.port';
import type {
  CreateAccountReq,
  CreateStrategyReq,
  SignAndExecuteReq,
  ValidatePermissionsReq,
  WithdrawReq,
} from '../../domain/ports/dca.provider.port';
import { redisIdempotency } from '../../infrastructure/redis/redis.client';

// ─── DI container shape ───────────────────────────────────────────────────────

export interface DCACapabilityServiceDeps {
  registry: ProviderRegistry<IDCAProvider>;
  policy: ChainAssetPriorityPolicy;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class DCACapabilityService {
  private readonly registry: ProviderRegistry<IDCAProvider>;
  private readonly policy: ChainAssetPriorityPolicy;

  constructor(deps: DCACapabilityServiceDeps) {
    this.registry = deps.registry;
    this.policy = deps.policy;
  }

  // ── Smart account endpoints ────────────────────────────────────────────────

  async createAccount(
    req: CapabilityRequest<CreateAccountReq>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'create-account', true, async (provider) => {
      // Users may only create accounts for themselves
      this.assertSelf(req.userAddress, req.payload.userId, 'create account for');
      return provider.createAccount(req.payload);
    });
  }

  async getAccount(
    req: CapabilityRequest<{ address: string }>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'get-account', false, async (provider) => {
      const account = await provider.getAccount(req.payload.address);
      if (!account) {
        throw CapabilityError.validation({
          capability: 'automation',
          message: 'Smart account not found',
        });
      }
      this.assertSelf(req.userAddress, account.userId, 'access');
      return account;
    });
  }

  async getUserAccounts(
    req: CapabilityRequest<{ userId: string }>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'get-user-accounts', false, async (provider) => {
      this.assertSelf(req.userAddress, req.payload.userId, 'list accounts for');
      const accounts = await provider.getUserAccounts(req.payload.userId);
      return { accounts };
    });
  }

  // ── Strategy endpoints ─────────────────────────────────────────────────────

  async createStrategy(
    req: CapabilityRequest<CreateStrategyReq>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'create-strategy', true, async (provider) => {
      // Ownership check: for smart account path, verify the account belongs to this user
      if (req.payload.smartAccountId) {
        const account = await provider.getAccount(req.payload.smartAccountId);
        if (!account) {
          throw CapabilityError.validation({ capability: 'automation', message: 'Smart account not found' });
        }
        this.assertSelf(req.userAddress, account.userId, 'create strategy for');
      }
      return provider.createStrategy(req.payload);
    });
  }

  async getStrategies(
    req: CapabilityRequest<{ smartAccountId: string }>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'get-strategies', false, async (provider) => {
      const account = await provider.getAccount(req.payload.smartAccountId);
      if (!account) {
        throw CapabilityError.validation({ capability: 'automation', message: 'Smart account not found' });
      }
      this.assertSelf(req.userAddress, account.userId, 'access strategies of');
      return provider.getStrategies(req.payload.smartAccountId);
    });
  }

  async toggleStrategy(
    req: CapabilityRequest<{ strategyId: string; isActive: boolean }>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'toggle-strategy', true, async (provider) => {
      await this.assertStrategyOwnership(provider, req.payload.strategyId, req.userAddress);
      await provider.toggleStrategy(req.payload.strategyId, req.payload.isActive);
      return { success: true, isActive: req.payload.isActive };
    });
  }

  async deleteStrategy(
    req: CapabilityRequest<{ strategyId: string }>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'delete-strategy', true, async (provider) => {
      await this.assertStrategyOwnership(provider, req.payload.strategyId, req.userAddress);
      await provider.deleteStrategy(req.payload.strategyId);
      return { success: true };
    });
  }

  async getHistory(
    req: CapabilityRequest<{ smartAccountId: string; limit?: number }>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'get-history', false, async (provider) => {
      const account = await provider.getAccount(req.payload.smartAccountId);
      if (!account) {
        throw CapabilityError.validation({ capability: 'automation', message: 'Smart account not found' });
      }
      this.assertSelf(req.userAddress, account.userId, 'access history of');
      return provider.getHistory(req.payload.smartAccountId, req.payload.limit);
    });
  }

  // ── Transaction endpoints ──────────────────────────────────────────────────

  async signAndExecute(
    req: CapabilityRequest<SignAndExecuteReq>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'sign-and-execute', true, async (provider) => {
      this.assertSelf(req.userAddress, req.payload.userId, 'sign transaction for');
      return provider.signAndExecute(req.payload);
    });
  }

  async validatePermissions(
    req: CapabilityRequest<ValidatePermissionsReq>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'validate-permissions', false, async (provider) => {
      return provider.validatePermissions(req.payload);
    });
  }

  async withdraw(
    req: CapabilityRequest<WithdrawReq>,
  ): Promise<CapabilityResponse<unknown>> {
    return this.execute(req, 'withdraw', true, async (provider) => {
      this.assertSelf(req.userAddress, req.payload.userId, 'withdraw from');
      return provider.withdraw(req.payload);
    });
  }

  // ── Core execute helper ────────────────────────────────────────────────────

  /**
   * Selects the best provider for the request, applies idempotency for mutating operations,
   * and wraps the result in the standard CapabilityResponse envelope.
   */
  private async execute<TData>(
    req: CapabilityRequest<unknown>,
    action: string,
    mutating: boolean,
    fn: (provider: IDCAProvider) => Promise<TData>,
  ): Promise<CapabilityResponse<TData>> {
    const start = Date.now();

    // ── Idempotency check (mutating calls only) ─────────────────────────────
    if (mutating && req.idempotencyKey) {
      const cached = await redisIdempotency.get(req.idempotencyKey);
      if (cached) {
        return cached as CapabilityResponse<TData>;
      }
    }

    // ── Provider selection ──────────────────────────────────────────────────
    const candidates = this.registry.listByChain(req.chainId);
    if (candidates.length === 0) {
      const err = CapabilityError.unsupportedRoute({
        capability: 'automation',
        chainId: req.chainId,
        attempted: [],
      });
      return buildError({ error: err, traceId: req.traceId, latencyMs: Date.now() - start });
    }

    const ranked = this.policy.rank(candidates, { chainId: req.chainId });
    const provider = ranked[0]!; // Single provider today; fallback loop future work
    const providerInfo: ProviderInfo = { name: provider.name };

    try {
      const data = await fn(provider);
      const latencyMs = Date.now() - start;
      const response = buildSuccess({ data, provider: providerInfo, traceId: req.traceId, latencyMs });

      // Cache successful mutating responses
      if (mutating && req.idempotencyKey) {
        await redisIdempotency.set(req.idempotencyKey, response);
      }

      return response;
    } catch (err) {
      const latencyMs = Date.now() - start;
      if (CapabilityError.is(err)) {
        return buildError({ error: err, traceId: req.traceId, latencyMs, provider: providerInfo });
      }
      const wrapped = CapabilityError.internal(`Unexpected error in ${action}: ${asMessage(err)}`, err);
      return buildError({ error: wrapped, traceId: req.traceId, latencyMs, provider: providerInfo });
    }
  }

  // ── Ownership helpers ──────────────────────────────────────────────────────

  private assertSelf(requestingUserId: string, resourceOwnerId: string, action: string): void {
    if (requestingUserId !== resourceOwnerId) {
      throw CapabilityError.validation({
        capability: 'automation',
        message: `Forbidden: you cannot ${action} another user's resources`,
      });
    }
  }

  private async assertStrategyOwnership(
    provider: IDCAProvider,
    strategyId: string,
    requestingUserId: string,
  ): Promise<void> {
    // We need the strategy's smartAccountId; DCAService is accessible via the adapter.
    // The canonical approach: call the provider which has DCAService internally.
    // We expose a lightweight helper by calling getStrategies indirectly via the DB.
    // For now, use a direct import of DCAService to resolve the strategy owner.
    const { DCAService } = await import('../../services/dca.service');
    const dcaService = new DCAService();
    const strategy = await dcaService.getStrategy(strategyId);
    if (!strategy) {
      throw CapabilityError.validation({ capability: 'automation', message: 'Strategy not found' });
    }
    const account = await provider.getAccount(strategy.smartAccountId);
    if (!account) {
      throw CapabilityError.validation({ capability: 'automation', message: 'Smart account not found' });
    }
    this.assertSelf(requestingUserId, account.userId, 'modify strategy of');
  }
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '<unknown>';
}
