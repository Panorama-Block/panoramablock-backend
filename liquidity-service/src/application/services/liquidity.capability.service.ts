/**
 * LiquidityCapabilityService — facade for the liquidity capability.
 *
 * Orchestrates `ProviderRegistry<ILiquidityProvider>` + `IPriorityPolicy` using
 * `fallbackInvoke` from `@panorama/capability`. The controller never knows about
 * specific providers — only this facade.
 */

import {
  CapabilityError,
  fallbackInvoke,
  type Address,
  type CapabilityRequest,
  type ChainId,
  type IPriorityPolicy,
  type ProviderRegistry,
  type Transaction,
} from '@panorama/capability';

import type {
  GetPoolsFilter,
  LpPosition,
  Pool,
} from '../../domain/entities/pool';
import type {
  ILiquidityProvider,
  PrepareAddInput,
  PrepareClaimInput,
  PrepareRemoveInput,
} from '../../domain/ports/liquidity.provider.port';

export interface LiquidityFacadeDeps {
  registry: ProviderRegistry<ILiquidityProvider>;
  policy: IPriorityPolicy;
}

export interface LiquidityActionOutcome<TData> {
  data: TData;
  provider: { name: string; metadata?: Record<string, unknown> };
  attempts: { provider: string; reason: string }[];
}

export class LiquidityCapabilityService {
  private readonly registry: ProviderRegistry<ILiquidityProvider>;
  private readonly policy: IPriorityPolicy;

  constructor(deps: LiquidityFacadeDeps) {
    this.registry = deps.registry;
    this.policy = deps.policy;
  }

  // -----------------------------------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------------------------------

  /** GET /pools — list pools on a chain. Optional filter. */
  async getPools(
    req: CapabilityRequest<GetPoolsFilter>
  ): Promise<LiquidityActionOutcome<Pool[]>> {
    const ranked = this.rankCandidates(req.chainId);
    const filter: GetPoolsFilter = { ...req.payload, chainId: req.chainId };
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute({ chainId: req.chainId }),
      invoke: (p) => p.getPools(filter),
      capability: 'liquidity',
    });
    if (!outcome.ok) throw outcome.error;
    return this.toOutcome(outcome);
  }

  /** GET /position/:address/:poolId */
  async getPosition(
    req: CapabilityRequest<{ poolId: string }>
  ): Promise<LiquidityActionOutcome<LpPosition | null>> {
    const ranked = this.rankCandidates(req.chainId, req.payload.poolId);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, poolId: req.payload.poolId }),
      invoke: (p) => p.getPosition(req.userAddress, req.payload.poolId),
      capability: 'liquidity',
    });
    if (!outcome.ok) throw outcome.error;
    return this.toOutcome(outcome);
  }

  /** GET /apr/:poolId */
  async getApr(
    req: CapabilityRequest<{ poolId: string }>
  ): Promise<LiquidityActionOutcome<number | null>> {
    const ranked = this.rankCandidates(req.chainId, req.payload.poolId);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, poolId: req.payload.poolId }),
      invoke: (p) => p.getApr(req.payload.poolId, req.chainId),
      capability: 'liquidity',
    });
    if (!outcome.ok) throw outcome.error;
    return this.toOutcome(outcome);
  }

  // -----------------------------------------------------------------------------------------------
  // Prepare actions (state-mutating intent — return Transaction[] for client-side signature)
  // -----------------------------------------------------------------------------------------------

  /** POST /prepare-add */
  async prepareAdd(
    req: CapabilityRequest<{
      poolId: string;
      amounts: [string, string];
      stake?: boolean;
      slippageBps?: number;
    }>
  ): Promise<LiquidityActionOutcome<Transaction[]>> {
    return this.runPrepare(req, (p, input) => p.prepareAdd(input as PrepareAddInput));
  }

  /** POST /prepare-remove */
  async prepareRemove(
    req: CapabilityRequest<{
      poolId: string;
      lpAmountWei: string;
      slippageBps?: number;
      unstakeFirst?: boolean;
    }>
  ): Promise<LiquidityActionOutcome<Transaction[]>> {
    return this.runPrepare(req, (p, input) => p.prepareRemove(input as PrepareRemoveInput));
  }

  /** POST /prepare-claim */
  async prepareClaim(
    req: CapabilityRequest<{ poolId: string; rewardAssets?: Address[] }>
  ): Promise<LiquidityActionOutcome<Transaction[]>> {
    return this.runPrepare(req, (p, input) => p.prepareClaim(input as PrepareClaimInput));
  }

  /** Exposed for the discovery handler factory. */
  listProviders(): ILiquidityProvider[] {
    return this.registry.listAll({ capability: 'liquidity' });
  }

  // -----------------------------------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------------------------------

  private rankCandidates(chainId: ChainId, poolId?: string): ILiquidityProvider[] {
    const candidates = this.registry.listByChain(chainId, { capability: 'liquidity' });
    if (candidates.length === 0) {
      throw CapabilityError.unsupportedRoute({
        capability: 'liquidity',
        chainId,
        attempted: [],
      });
    }
    return this.policy.rank(candidates, { chainId, ...(poolId && { asset: poolId }) });
  }

  private async runPrepare(
    req: CapabilityRequest<{ poolId: string } & Record<string, unknown>>,
    invoke: (
      p: ILiquidityProvider,
      input: PrepareAddInput | PrepareRemoveInput | PrepareClaimInput
    ) => Promise<Transaction[]>
  ): Promise<LiquidityActionOutcome<Transaction[]>> {
    const ranked = this.rankCandidates(req.chainId, req.payload.poolId);
    const baseInput = {
      userAddress: req.userAddress as Address,
      chainId: req.chainId,
      ...req.payload,
    };
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, poolId: req.payload.poolId }),
      invoke: (p) =>
        invoke(p, baseInput as PrepareAddInput | PrepareRemoveInput | PrepareClaimInput),
      capability: 'liquidity',
    });
    if (!outcome.ok) throw outcome.error;
    return this.toOutcome(outcome);
  }

  private toOutcome<TData>(outcome: {
    ok: true;
    result: TData;
    provider: ILiquidityProvider;
    attempts: { provider: string; reason: string }[];
  }): LiquidityActionOutcome<TData> {
    return {
      data: outcome.result,
      provider: {
        name: outcome.provider.name,
        metadata: outcome.provider.metadata as unknown as Record<string, unknown>,
      },
      attempts: outcome.attempts,
    };
  }
}
