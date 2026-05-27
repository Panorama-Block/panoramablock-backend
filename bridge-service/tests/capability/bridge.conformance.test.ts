import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../../shared/capability/registry';
import type { ProviderMetadata, ProviderHealth } from '../../../shared/capability/provider.types';
import type {
  IBridgeProvider,
  BridgeRouteRequest,
  BridgeLimits,
  BridgeQuoteRequest,
  BridgeQuoteResult,
  BridgeTransactionRequest,
  BridgeTransactionResult,
} from '../../src/domain/ports/bridge.provider.port';

class FakeBridgeProvider implements IBridgeProvider {
  public readonly metadata: ProviderMetadata;
  constructor(
    public readonly name: string,
    chains: number[] = [1, 8453]
  ) {
    this.metadata = {
      name,
      capability: 'bridge',
      supportedChains: chains,
      version: '1.0.0',
      enabled: true,
    };
  }
  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }
  async supportsRoute(src: string, dst: string): Promise<boolean> {
    return src !== dst;
  }
  async getLimits(_req: BridgeRouteRequest): Promise<BridgeLimits> {
    return {
      minAmount: 0.01, maxAmount: 100,
      sourceNetwork: 'ETHEREUM', destinationNetwork: 'BASE',
      sourceToken: 'ETH', destinationToken: 'ETH',
    };
  }
  async getQuote(req: BridgeQuoteRequest): Promise<BridgeQuoteResult> {
    return {
      receiveAmount: req.amount * 0.995,
      fee: req.amount * 0.005,
      sourceNetwork: req.sourceNetwork,
      destinationNetwork: req.destinationNetwork,
      sourceToken: req.sourceToken ?? 'ETH',
      destinationToken: req.destinationToken ?? 'ETH',
    };
  }
  async createTransaction(_req: BridgeTransactionRequest): Promise<BridgeTransactionResult> {
    return {
      swapId: 'swap-123',
      depositAddress: '0xdeposit',
      depositNetwork: 'ETHEREUM',
      depositToken: 'ETH',
      amount: 1,
    } as BridgeTransactionResult;
  }
}

describe('bridge provider conformance', () => {
  it('registers with bridge capability slug', () => {
    const reg = new ProviderRegistry<IBridgeProvider>();
    const p = new FakeBridgeProvider('layerswap');
    reg.register(p);
    expect(reg.getByName('layerswap')?.metadata.capability).toBe('bridge');
  });

  it('rejects duplicates', () => {
    const reg = new ProviderRegistry<IBridgeProvider>();
    reg.register(new FakeBridgeProvider('dup'));
    expect(() => reg.register(new FakeBridgeProvider('dup'))).toThrow();
  });

  it('listByChain filters correctly', () => {
    const reg = new ProviderRegistry<IBridgeProvider>();
    reg.register(new FakeBridgeProvider('eth-base', [1, 8453]));
    reg.register(new FakeBridgeProvider('avax-only', [43114]));
    expect(reg.listByChain(8453).map(p => p.name)).toEqual(['eth-base']);
    expect(reg.listByChain(43114).map(p => p.name)).toEqual(['avax-only']);
  });

  it('supportsRoute rejects same-network', async () => {
    const p = new FakeBridgeProvider('test-bridge');
    expect(await p.supportsRoute('ETHEREUM', 'BASE')).toBe(true);
    expect(await p.supportsRoute('ETHEREUM', 'ETHEREUM')).toBe(false);
  });

  it('getLimits returns min/max', async () => {
    const p = new FakeBridgeProvider('test-bridge');
    const limits = await p.getLimits({ sourceNetwork: 'ETHEREUM', destinationNetwork: 'BASE' });
    expect(limits.minAmount).toBeLessThan(limits.maxAmount);
  });

  it('getQuote returns fee and receiveAmount', async () => {
    const p = new FakeBridgeProvider('test-bridge');
    const quote = await p.getQuote({ sourceNetwork: 'ETHEREUM', destinationNetwork: 'BASE', amount: 1 });
    expect(quote.receiveAmount).toBeGreaterThan(0);
    expect(quote.fee).toBeGreaterThan(0);
    expect(quote.receiveAmount + quote.fee).toBeCloseTo(1, 5);
  });

  it('createTransaction returns deposit address', async () => {
    const p = new FakeBridgeProvider('test-bridge');
    const tx = await p.createTransaction({
      sourceNetwork: 'ETHEREUM', destinationNetwork: 'BASE',
      sourceToken: 'ETH', destinationToken: 'ETH',
      amount: 1, destinationAddress: '0xuser',
    } as BridgeTransactionRequest);
    expect(tx.swapId).toBeDefined();
    expect(tx.depositAddress).toBeDefined();
  });

  it('healthCheck returns healthy', async () => {
    const p = new FakeBridgeProvider('health');
    const h = await p.healthCheck();
    expect(h.healthy).toBe(true);
  });
});
