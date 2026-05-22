/**
 * BaseStakingProviderAdapter — stub for future Base-chain staking (e.g. cbETH).
 *
 * Ships structurally complete with `metadata.enabled = false` so the registry skips it by
 * default. This guarantees the registry/policy/discovery code paths are exercised against
 * multi-provider shapes without committing to a half-baked Base staking implementation.
 *
 * Card #248 (SPRINT_HUGO.md).
 */

import {
  CapabilityError,
  type Address,
  type ChainId,
  type ProviderMetadata,
  type Transaction,
} from '@panorama/capability';
import { getChain } from '@panorama/capability/chains';

import {
  type CapabilityStakingPosition,
  type IStakingProvider,
  type PrepareClaimInput,
  type PrepareStakeInput,
  type PrepareUnstakeInput,
  type StakingRouteParams,
} from '../../domain/ports/staking.provider.port';

const BASE_CHAIN_ID = getChain('base').id;

export class BaseStakingProviderAdapter implements IStakingProvider {
  public readonly name = 'base-staking-stub';
  public readonly metadata: ProviderMetadata = {
    name: 'base-staking-stub',
    capability: 'staking',
    supportedChains: [BASE_CHAIN_ID],
    features: ['cbETH', 'stub'],
    version: '0.0.0',
    enabled: false,
  };

  async supportsRoute(_params: StakingRouteParams): Promise<boolean> {
    return false;
  }

  async getPosition(
    _userAddress: Address,
    _chainId: ChainId,
  ): Promise<CapabilityStakingPosition | null> {
    return null;
  }

  async prepareStake(_input: PrepareStakeInput): Promise<Transaction[]> {
    throw CapabilityError.unavailable(
      'Base staking provider is not implemented yet. Track progress via the cbETH adapter card.',
      { provider: this.name },
    );
  }

  async prepareUnstake(_input: PrepareUnstakeInput): Promise<Transaction[]> {
    throw CapabilityError.unavailable(
      'Base staking provider is not implemented yet.',
      { provider: this.name },
    );
  }

  async prepareClaim(_input: PrepareClaimInput): Promise<Transaction[]> {
    throw CapabilityError.unavailable(
      'Base staking provider is not implemented yet.',
      { provider: this.name },
    );
  }

  async getApr(_asset: string, _chainId: ChainId): Promise<number | null> {
    return null;
  }
}
