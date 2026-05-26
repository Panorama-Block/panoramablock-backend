/**
 * DCA/Automation capability conformance tests.
 */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry, type ProviderMetadata, type ProviderHealth } from '@panorama/capability';
import type { IDCAProvider, SmartAccount, DCAStrategyRecord, CreateAccountReq, CreateStrategyReq, ExecuteStrategyReq } from '../domain/ports/dca.provider.port';

class FakeDCAProvider implements IDCAProvider {
  public readonly metadata: ProviderMetadata;
  constructor(
    public readonly name: string,
    chains: number[] = [8453]
  ) {
    this.metadata = {
      name,
      capability: 'automation',
      supportedChains: chains,
      version: '1.0.0',
      enabled: true,
    };
  }
  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }
  async createSmartAccount(req: CreateAccountReq): Promise<SmartAccount> {
    return {
      address: '0xSA', userId: req.userId, name: req.name,
      createdAt: Date.now(), sessionKeyAddress: '0xSK',
      expiresAt: Date.now() + 86400000,
      permissions: { approvedTargets: [], nativeTokenLimitPerTransaction: '0', startTimestamp: 0, endTimestamp: 0 },
    };
  }
  async getSmartAccounts(_userId: string): Promise<SmartAccount[]> { return []; }
  async createStrategy(_req: CreateStrategyReq): Promise<DCAStrategyRecord> {
    return {
      strategyId: 'strat-1', smartAccountId: 'sa-1',
      fromToken: '0xA', toToken: '0xB', fromChainId: 8453, toChainId: 8453,
      amount: '100', interval: 'daily',
      lastExecuted: 0, nextExecution: Date.now() + 86400000, isActive: true,
    };
  }
  async getStrategies(_userId: string): Promise<DCAStrategyRecord[]> { return []; }
  async cancelStrategy(_strategyId: string): Promise<void> {}
  async executeStrategy(_req: ExecuteStrategyReq): Promise<{ txHash: string }> {
    return { txHash: '0xtx' };
  }
  async getExecutionHistory(_strategyId: string) { return []; }
}

describe('dca/automation provider conformance', () => {
  it('registers with automation capability slug', () => {
    const reg = new ProviderRegistry<IDCAProvider>();
    const p = new FakeDCAProvider('erc4337-dca');
    reg.register(p);
    expect(reg.getByName('erc4337-dca')?.metadata.capability).toBe('automation');
  });

  it('rejects duplicates', () => {
    const reg = new ProviderRegistry<IDCAProvider>();
    reg.register(new FakeDCAProvider('dup'));
    expect(() => reg.register(new FakeDCAProvider('dup'))).toThrow();
  });

  it('listByChain filters', () => {
    const reg = new ProviderRegistry<IDCAProvider>();
    reg.register(new FakeDCAProvider('base-dca', [8453]));
    reg.register(new FakeDCAProvider('eth-dca', [1]));
    expect(reg.listByChain(8453).map(p => p.name)).toEqual(['base-dca']);
  });

  it('createSmartAccount returns valid account', async () => {
    const p = new FakeDCAProvider('test-dca');
    const account = await p.createSmartAccount({ userId: 'u1', name: 'test' });
    expect(account.address).toBeDefined();
    expect(account.sessionKeyAddress).toBeDefined();
  });

  it('createStrategy returns valid record', async () => {
    const p = new FakeDCAProvider('test-dca');
    const strategy = await p.createStrategy({
      smartAccountId: 'sa-1', fromToken: '0xA', toToken: '0xB',
      fromChainId: 8453, toChainId: 8453, amount: '100', interval: 'daily',
    });
    expect(strategy.strategyId).toBeDefined();
    expect(strategy.isActive).toBe(true);
  });

  it('healthCheck returns healthy', async () => {
    const p = new FakeDCAProvider('health');
    const h = await p.healthCheck();
    expect(h.healthy).toBe(true);
  });
});
