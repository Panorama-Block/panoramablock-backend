/**
 * Trader Joe LB stub — registered but disabled until the Liquidity Book
 * integration is implemented.
 */

import type { ProviderMetadata, Transaction } from '@panorama/capability';
import { CapabilityError } from '@panorama/capability';
import type {
  ILiquidityProvider,
  LiquidityRouteParams,
  PrepareAddInput,
  PrepareRemoveInput,
  PrepareClaimInput,
} from '../../domain/ports/liquidity.provider.port';
import type { Pool, LpPosition, GetPoolsFilter } from '../../domain/entities/pool';

const AVAX_CHAIN_ID = 43114;
const UNAVAILABLE_MSG = 'Trader Joe LP adapter is not yet implemented';

export class TraderJoeLpStubAdapter implements ILiquidityProvider {
  public readonly name = 'traderjoe-lp';
  public readonly metadata: ProviderMetadata = {
    name: 'traderjoe-lp',
    capability: 'liquidity',
    supportedChains: [AVAX_CHAIN_ID],
    features: ['concentrated', 'liquidity-book'],
    version: '0.1.0',
    enabled: false,
  };

  async supportsRoute(params: LiquidityRouteParams): Promise<boolean> {
    return params.chainId === AVAX_CHAIN_ID;
  }

  async getPools(_filter: GetPoolsFilter): Promise<Pool[]> {
    throw CapabilityError.unavailable(UNAVAILABLE_MSG);
  }

  async getPosition(_addr: string, _poolId: string): Promise<LpPosition | null> {
    throw CapabilityError.unavailable(UNAVAILABLE_MSG);
  }

  async prepareAdd(_input: PrepareAddInput): Promise<Transaction[]> {
    throw CapabilityError.unavailable(UNAVAILABLE_MSG);
  }

  async prepareRemove(_input: PrepareRemoveInput): Promise<Transaction[]> {
    throw CapabilityError.unavailable(UNAVAILABLE_MSG);
  }

  async prepareClaim(_input: PrepareClaimInput): Promise<Transaction[]> {
    throw CapabilityError.unavailable(UNAVAILABLE_MSG);
  }

  async getApr(_poolId: string, _chainId: number): Promise<number | null> {
    return null;
  }
}
