/**
 * StakingCapabilityService — facade for the staking capability.
 *
 * Orchestrates the `ProviderRegistry<IStakingProvider>` + `IPriorityPolicy` so the controller
 * never knows about specific providers. All staking endpoints (`/v1/capability/staking/*`)
 * go through this single class.
 *
 * Card #245 (SPRINT_HUGO.md).
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

import {
  type CapabilityStakingPosition,
  type IStakingProvider,
  type PrepareClaimInput,
  type PrepareStakeInput,
  type PrepareUnstakeInput,
} from '../../domain/ports/staking.provider.port';

export interface StakingFacadeDeps {
  registry: ProviderRegistry<IStakingProvider>;
  policy: IPriorityPolicy;
}

export interface StakingActionOutcome<TData> {
  data: TData;
  provider: { name: string; metadata?: Record<string, unknown> };
  attempts: { provider: string; reason: string }[];
}

export class StakingCapabilityService {
  private readonly registry: ProviderRegistry<IStakingProvider>;
  private readonly policy: IPriorityPolicy;

  constructor(deps: StakingFacadeDeps) {
    this.registry = deps.registry;
    this.policy = deps.policy;
  }

  // -----------------------------------------------------------------------------------------------
  // Position (read)
  // -----------------------------------------------------------------------------------------------

  async getPosition(
    req: CapabilityRequest<{ asset?: string }>,
  ): Promise<StakingActionOutcome<CapabilityStakingPosition | null>> {
    const ranked = this.rankCandidates(req.chainId, req.payload.asset);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, asset: req.payload.asset }),
      invoke: (p) => p.getPosition(req.userAddress, req.chainId),
      capability: 'staking',
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: {
        name: outcome.provider.name,
        metadata: outcome.provider.metadata as unknown as Record<string, unknown>,
      },
      attempts: outcome.attempts,
    };
  }

  // -----------------------------------------------------------------------------------------------
  // Prepare actions
  // -----------------------------------------------------------------------------------------------

  async prepareStake(
    req: CapabilityRequest<{ amount: string; asset?: string }>,
  ): Promise<StakingActionOutcome<Transaction[]>> {
    return this.runPrepare(req, (p, input) => p.prepareStake(input), 'prepareStake');
  }

  async prepareUnstake(
    req: CapabilityRequest<{ amount: string; asset?: string }>,
  ): Promise<StakingActionOutcome<Transaction[]>> {
    return this.runPrepare(req, (p, input) => p.prepareUnstake(input), 'prepareUnstake');
  }

  async prepareClaim(
    req: CapabilityRequest<{ requestIds?: string[]; asset?: string }>,
  ): Promise<StakingActionOutcome<Transaction[]>> {
    const ranked = this.rankCandidates(req.chainId, req.payload.asset);
    const input: PrepareClaimInput = {
      userAddress: req.userAddress,
      chainId: req.chainId,
      ...(req.payload.requestIds && { requestIds: req.payload.requestIds }),
    };
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, asset: req.payload.asset }),
      invoke: (p) => p.prepareClaim(input),
      capability: 'staking',
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: outcome.provider.name },
      attempts: outcome.attempts,
    };
  }

  // -----------------------------------------------------------------------------------------------
  // APR (read)
  // -----------------------------------------------------------------------------------------------

  async getApr(
    req: CapabilityRequest<{ asset?: string }>,
  ): Promise<StakingActionOutcome<number | null>> {
    const asset = req.payload.asset ?? 'ETH';
    const ranked = this.rankCandidates(req.chainId, asset);
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) => p.supportsRoute({ chainId: req.chainId, asset }),
      invoke: (p) => p.getApr(asset, req.chainId),
      capability: 'staking',
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: outcome.provider.name },
      attempts: outcome.attempts,
    };
  }

  // -----------------------------------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------------------------------

  private rankCandidates(chainId: ChainId, asset?: string): IStakingProvider[] {
    const candidates = this.registry.listByChain(chainId, { capability: 'staking' });
    if (candidates.length === 0) {
      throw CapabilityError.unsupportedRoute({
        capability: 'staking',
        chainId,
        attempted: [],
        ...(asset && { fromAsset: asset }),
      });
    }
    return this.policy.rank(candidates, { chainId, ...(asset && { asset }) });
  }

  private async runPrepare(
    req: CapabilityRequest<{ amount: string; asset?: string }>,
    invoke: (
      p: IStakingProvider,
      input: PrepareStakeInput | PrepareUnstakeInput,
    ) => Promise<Transaction[]>,
    action: string,
  ): Promise<StakingActionOutcome<Transaction[]>> {
    const ranked = this.rankCandidates(req.chainId, req.payload.asset);
    const input: PrepareStakeInput = {
      userAddress: req.userAddress as Address,
      chainId: req.chainId,
      amount: req.payload.amount,
      ...(req.payload.asset && { asset: req.payload.asset }),
    };
    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: (p) =>
        p.supportsRoute({ chainId: req.chainId, asset: req.payload.asset }),
      invoke: (p) => invoke(p, input),
      capability: 'staking',
    });
    if (!outcome.ok) throw outcome.error;
    return {
      data: outcome.result,
      provider: { name: outcome.provider.name },
      attempts: outcome.attempts,
    };
  }

  // Exposed for the discovery handler.
  listProviders(): IStakingProvider[] {
    return this.registry.listAll({ capability: 'staking' });
  }
}
