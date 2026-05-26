/**
 * Liquidity provider conformance tests.
 */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry, type ProviderMetadata, type Transaction } from '@panorama/capability';
import type {
  ILiquidityProvider,
  LiquidityRouteParams,
  PrepareAddInput,
  PrepareRemoveInput,
  PrepareClaimInput,
} from '../domain/ports/liquidity.provider.port';
import type { Pool, LpPosition, GetPoolsFilter } from '../domain/entities/pool';

class FakeLpProvider implements ILiquidityProvider {
  public readonly metadata: ProviderMetadata;
  constructor(
    public readonly name: string,
    private readonly chains: number[] = [8453]
  ) {
    this.metadata = {
      name,
      capability: 'liquidity',
      supportedChains: chains,
      version: '1.0.0',
      enabled: true,
    };
  }
  async supportsRoute(params: LiquidityRouteParams) {
    return this.metadata.supportedChains.includes(params.chainId);
  }
  async getPools(filter: GetPoolsFilter): Promise<Pool[]> {
    return [
      {
        id: 'fake-pool',
        chainId: filter.chainId,
        provider: this.name,
        type: 'volatile',
        assets: [
          { address: '0xA', symbol: 'WETH', decimals: 18 },
          { address: '0xB', symbol: 'USDC', decimals: 6 },
        ],
      },
    ];
  }
  async getPosition() { return null; }
  async prepareAdd(): Promise<Transaction[]> { return []; }
  async prepareRemove(): Promise<Transaction[]> { return []; }
  async prepareClaim(): Promise<Transaction[]> { return []; }
  async getApr(_poolId: string, _chainId: number) { return 12.5; }
}

describe('liquidity provider conformance', () => {
  it('registers and retrieves by name', () => {
    const reg = new ProviderRegistry<ILiquidityProvider>();
    const p = new FakeLpProvider('test-lp');
    reg.register(p);
    expect(reg.getByName('test-lp')).toBe(p);
  });

  it('rejects duplicates', () => {
    const reg = new ProviderRegistry<ILiquidityProvider>();
    reg.register(new FakeLpProvider('dup'));
    expect(() => reg.register(new FakeLpProvider('dup'))).toThrow();
  });

  it('listByChain filters', () => {
    const reg = new ProviderRegistry<ILiquidityProvider>();
    reg.register(new FakeLpProvider('base-lp', [8453]));
    reg.register(new FakeLpProvider('avax-lp', [43114]));
    expect(reg.listByChain(8453).map((p) => p.name)).toEqual(['base-lp']);
    expect(reg.listByChain(43114).map((p) => p.name)).toEqual(['avax-lp']);
  });

  it('disabled stubs excluded by default', () => {
    const reg = new ProviderRegistry<ILiquidityProvider>();
    const stub = new FakeLpProvider('stub-lp');
    (stub.metadata as any).enabled = false;
    reg.register(stub);
    expect(reg.listAll().length).toBe(0);
    expect(reg.listAll({ includeDisabled: true }).length).toBe(1);
  });

  it('supportsRoute returns boolean', async () => {
    const p = new FakeLpProvider('route-check', [8453]);
    expect(await p.supportsRoute({ chainId: 8453 })).toBe(true);
    expect(await p.supportsRoute({ chainId: 1 })).toBe(false);
  });

  it('getPools returns Pool[]', async () => {
    const p = new FakeLpProvider('pool-list');
    const pools = await p.getPools({ chainId: 8453 });
    expect(pools.length).toBeGreaterThan(0);
    expect(pools[0]!.provider).toBe('pool-list');
    expect(pools[0]!.assets.length).toBe(2);
  });

  it('getApr returns number or null', async () => {
    const p = new FakeLpProvider('apr-check');
    const apr = await p.getApr('fake-pool', 8453);
    expect(typeof apr).toBe('number');
  });
});
