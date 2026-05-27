/**
 * Ethereum lending stub — registered but disabled until an Ethereum lending
 * protocol adapter (e.g. Aave, Compound) is implemented.
 */

import type { ProviderMetadata, ProviderHealth } from '@panorama/capability';
import { CapabilityError } from '@panorama/capability';
import type { ILendingProvider, LendingMarket, UserPositionsResult, HistoryEntry } from '../../domain/ports/lending.provider.port';

const UNAVAILABLE_MSG = 'Ethereum lending adapter is not yet implemented';

export class EthereumLendingStubAdapter implements ILendingProvider {
  public readonly name = 'ethereum-lending';
  public readonly metadata: ProviderMetadata = {
    name: 'ethereum-lending',
    capability: 'lending',
    supportedChains: [1],
    features: ['supply', 'borrow'],
    version: '0.1.0',
    enabled: false,
  };

  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: false, reason: UNAVAILABLE_MSG, checkedAt: new Date().toISOString() };
  }
  async getMarkets(_chainId: number): Promise<LendingMarket[]> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async getPosition(_addr: string, _market: string): Promise<any> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async getUserPosition(_addr: string, _chainId: number): Promise<UserPositionsResult> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async getHistory(_addr: string, _chainId: number): Promise<HistoryEntry[]> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareSupply(_input: any): Promise<any> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareBorrow(_input: any): Promise<any> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareRepay(_input: any): Promise<any> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareWithdraw(_input: any): Promise<any> { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async getApr(_market: string, _chainId: number): Promise<any> { return null; }
  async supportsRoute(params: any): Promise<boolean> { return params.chainId === 1; }
}
