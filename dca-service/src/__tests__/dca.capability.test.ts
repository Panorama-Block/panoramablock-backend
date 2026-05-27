/**
 * DCA/Automation capability conformance tests.
 */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry, type ProviderMetadata, type ProviderHealth } from '@panorama/capability';
import type {
  IDCAProvider, SmartAccount, DCAStrategyRecord,
  CreateAccountReq, CreateStrategyReq, CreateAccountResult, CreateStrategyResult,
  GetStrategiesResult, GetHistoryResult, SignAndExecuteReq,
  TransactionResult, ValidatePermissionsReq, ValidationResult, WithdrawReq, SupportsRouteParams,
} from '../domain/ports/dca.provider.port';

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
  async createAccount(req: CreateAccountReq): Promise<CreateAccountResult> {
    return { smartAccountAddress: '0xSA', sessionKeyAddress: '0xSK', expiresAt: new Date(Date.now() + 86400000) };
  }
  async getAccount(_address: string): Promise<SmartAccount | null> { return null; }
  async getUserAccounts(_userId: string): Promise<SmartAccount[]> { return []; }
  async createStrategy(_req: CreateStrategyReq): Promise<CreateStrategyResult> {
    return { type: 'created', strategyId: 'strat-1', nextExecution: new Date(Date.now() + 86400000) };
  }
  async getStrategies(_smartAccountId: string): Promise<GetStrategiesResult> { return { strategies: [], vaultOrders: [] }; }
  async toggleStrategy(_id: string, _active: boolean): Promise<void> {}
  async deleteStrategy(_id: string): Promise<void> {}
  async getHistory(_smartAccountId: string): Promise<GetHistoryResult> { return { history: [], vaultHistory: [] }; }
  async signAndExecute(_req: SignAndExecuteReq): Promise<TransactionResult> {
    return { transactionHash: '0xtx', chainId: 8453, status: 'submitted', executedAt: new Date().toISOString() };
  }
  async validatePermissions(_req: ValidatePermissionsReq): Promise<ValidationResult> { return { valid: true }; }
  async withdraw(_req: WithdrawReq): Promise<TransactionResult> {
    return { transactionHash: '0xtx', chainId: 8453, status: 'submitted', executedAt: new Date().toISOString() };
  }
  async supportsRoute(_params: SupportsRouteParams): Promise<boolean> { return true; }
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

  it('createAccount returns valid result', async () => {
    const p = new FakeDCAProvider('test-dca');
    const result = await p.createAccount({ userId: 'u1', name: 'test', permissions: { approvedTargets: [], nativeTokenLimit: '0', durationDays: 30 } });
    expect(result.smartAccountAddress).toBeDefined();
    expect(result.sessionKeyAddress).toBeDefined();
  });

  it('createStrategy returns valid result', async () => {
    const p = new FakeDCAProvider('test-dca');
    const strategy = await p.createStrategy({
      smartAccountId: 'sa-1', fromToken: '0xA', toToken: '0xB',
      fromChainId: 8453, toChainId: 8453, amount: '100', interval: 'daily',
    } as CreateStrategyReq);
    expect(strategy.type).toBe('created');
    if (strategy.type === 'created') expect(strategy.strategyId).toBeDefined();
  });

  it('signAndExecute returns ScheduledExecutionResult', async () => {
    const p = new FakeDCAProvider('test-dca');
    const result = await p.signAndExecute({ smartAccountAddress: '0xSA', userId: 'u1', to: '0x', value: '0', chainId: 8453 });
    expect(result.transactionHash).toBeDefined();
    expect(result.chainId).toBe(8453);
    expect(result.status).toBe('submitted');
    expect(result.executedAt).toBeDefined();
  });

  it('healthCheck returns healthy', async () => {
    const p = new FakeDCAProvider('health');
    const h = await p.healthCheck();
    expect(h.healthy).toBe(true);
  });
});
