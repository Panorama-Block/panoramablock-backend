/**
 * Ethereum lending stub — registered but disabled until an Ethereum lending
 * protocol adapter (e.g. Aave, Compound) is implemented.
 */

import type { ProviderMetadata, ProviderHealth } from '@panorama/capability';
import { CapabilityError } from '@panorama/capability';
import type { ILendingProvider } from '../../domain/ports/lending.provider.port';

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
  async getMarkets(_chainId: number) { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async getPosition(_addr: string, _market: string) { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareSupply(_input: any) { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareBorrow(_input: any) { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareRepay(_input: any) { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async prepareWithdraw(_input: any) { throw CapabilityError.unavailable(UNAVAILABLE_MSG); }
  async getApr(_market: string, _chainId: number) { return null; }
  supportsRoute(params: any): boolean { return params.chainId === 1; }
}
