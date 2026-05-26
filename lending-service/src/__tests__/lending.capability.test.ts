/**
 * Lending capability conformance tests.
 */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry, type ProviderMetadata, type ProviderHealth } from '@panorama/capability';
import type { ILendingProvider } from '../domain/ports/lending.provider.port';

class FakeLendingProvider implements ILendingProvider {
  public readonly metadata: ProviderMetadata;
  constructor(
    public readonly name: string,
    chains: number[] = [43114]
  ) {
    this.metadata = {
      name,
      capability: 'lending',
      supportedChains: chains,
      version: '1.0.0',
      enabled: true,
    };
  }
  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }
  async getMarkets(_chainId: number) {
    return [{ asset: '0xUSDC', supplyApr: 3.5, borrowApr: 5.2, totalSupply: '1000000', totalBorrow: '500000' }];
  }
  async getPosition(_userAddress: string, _market: string) {
    return { supplied: '100', borrowed: '0', healthFactor: 2.5 };
  }
  async prepareSupply(_input: any) { return []; }
  async prepareBorrow(_input: any) { return []; }
  async prepareRepay(_input: any) { return []; }
  async prepareWithdraw(_input: any) { return []; }
  async getApr(_market: string, _chainId: number) { return { supplyApr: 3.5, borrowApr: 5.2 }; }
  supportsRoute(params: any): boolean {
    return this.metadata.supportedChains.includes(params.chainId);
  }
}

describe('lending provider conformance', () => {
  it('registers with lending capability slug', () => {
    const reg = new ProviderRegistry<ILendingProvider>();
    const p = new FakeLendingProvider('benqi');
    reg.register(p);
    expect(reg.getByName('benqi')?.metadata.capability).toBe('lending');
  });

  it('rejects duplicates', () => {
    const reg = new ProviderRegistry<ILendingProvider>();
    reg.register(new FakeLendingProvider('dup'));
    expect(() => reg.register(new FakeLendingProvider('dup'))).toThrow();
  });

  it('listByChain filters', () => {
    const reg = new ProviderRegistry<ILendingProvider>();
    reg.register(new FakeLendingProvider('avax-lend', [43114]));
    reg.register(new FakeLendingProvider('base-lend', [8453]));
    expect(reg.listByChain(43114).map(p => p.name)).toEqual(['avax-lend']);
    expect(reg.listByChain(8453).map(p => p.name)).toEqual(['base-lend']);
  });

  it('getMarkets returns market data', async () => {
    const p = new FakeLendingProvider('test-lending');
    const markets = await p.getMarkets(43114);
    expect(markets.length).toBeGreaterThan(0);
    expect(markets[0].supplyApr).toBeDefined();
  });

  it('getPosition returns user position', async () => {
    const p = new FakeLendingProvider('test-lending');
    const pos = await p.getPosition('0xuser', 'USDC');
    expect(pos.healthFactor).toBeGreaterThan(0);
  });

  it('healthCheck returns healthy', async () => {
    const p = new FakeLendingProvider('health');
    const h = await p.healthCheck();
    expect(h.healthy).toBe(true);
  });

  it('supportsRoute by chain', () => {
    const p = new FakeLendingProvider('avax-only', [43114]);
    expect(p.supportsRoute({ chainId: 43114 })).toBe(true);
    expect(p.supportsRoute({ chainId: 1 })).toBe(false);
  });
});
