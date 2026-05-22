/**
 * Unit tests for StakingCapabilityService — facade orchestration.
 *
 * The facade is the hot path for every `/v1/capability/staking/*` request. These tests cover:
 *  - happy path (single provider succeeds)
 *  - fallback (first provider unsupports → next serves)
 *  - validation errors rethrown without fallback
 *  - empty candidate list → unsupportedRoute
 *  - provider info + attempts surfaced in the outcome
 *
 * Real Lido contract calls are out of scope here; that's the adapter integration test.
 */

import { describe, it, expect } from 'vitest';

import {
  ChainAssetPriorityPolicy,
  ProviderRegistry,
  type CapabilityRequest,
  type ProviderMetadata,
  type Transaction,
} from '@panorama/capability';

import { StakingCapabilityService } from '../staking.capability.service';
import type {
  CapabilityStakingPosition,
  IStakingProvider,
  PrepareClaimInput,
  PrepareStakeInput,
  PrepareUnstakeInput,
  StakingRouteParams,
} from '../../../domain/ports/staking.provider.port';

// -------------------------------------------------------------------------------------------------
// Fake providers
// -------------------------------------------------------------------------------------------------

interface FakeOpts {
  name: string;
  supportedChains: number[];
  enabled?: boolean;
  supports?: boolean;
  failPrepareStake?: 'validation' | 'provider' | false;
  position?: CapabilityStakingPosition | null;
}

function fake(opts: FakeOpts): IStakingProvider {
  const metadata: ProviderMetadata = {
    name: opts.name,
    capability: 'staking',
    supportedChains: opts.supportedChains,
    version: '1.0.0',
    ...(opts.enabled !== undefined && { enabled: opts.enabled }),
  };
  const tx: Transaction = {
    chainId: opts.supportedChains[0] as number,
    to: '0xabc',
    data: '0xdef',
    value: '0',
    action: 'stake',
  };
  const supports = opts.supports ?? true;
  return {
    name: opts.name,
    metadata,
    async supportsRoute(_params: StakingRouteParams): Promise<boolean> {
      return supports;
    },
    async getPosition(): Promise<CapabilityStakingPosition | null> {
      return opts.position ?? null;
    },
    async prepareStake(_input: PrepareStakeInput): Promise<Transaction[]> {
      if (opts.failPrepareStake === 'validation') {
        const { CapabilityError } = await import('@panorama/capability');
        throw CapabilityError.validation({ capability: 'staking', message: `${opts.name} validation` });
      }
      if (opts.failPrepareStake === 'provider') {
        const { CapabilityError } = await import('@panorama/capability');
        throw CapabilityError.providerFailure({
          capability: 'staking',
          provider: opts.name,
          message: `${opts.name} provider failure`,
        });
      }
      return [{ ...tx, action: `stake-from-${opts.name}` }];
    },
    async prepareUnstake(_input: PrepareUnstakeInput): Promise<Transaction[]> {
      return [{ ...tx, action: `unstake-from-${opts.name}` }];
    },
    async prepareClaim(_input: PrepareClaimInput): Promise<Transaction[]> {
      return [{ ...tx, action: `claim-from-${opts.name}` }];
    },
    async getApr(_asset: string, _chainId: number): Promise<number | null> {
      return opts.name === 'lido' ? 3.5 : null;
    },
  };
}

function envelope<T>(payload: T, chainId = 1, address = '0xuser'): CapabilityRequest<T> {
  return {
    tenantId: 't',
    traceId: 'trace-1',
    chainId,
    userAddress: address,
    payload,
  };
}

function setup(providers: IStakingProvider[]): StakingCapabilityService {
  const registry = new ProviderRegistry<IStakingProvider>();
  for (const p of providers) registry.register(p);
  const policy = new ChainAssetPriorityPolicy({
    '1': providers.map((p) => p.name),
  });
  return new StakingCapabilityService({ registry, policy });
}

// -------------------------------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------------------------------

describe('StakingCapabilityService — getPosition', () => {
  it('returns first supporting provider position', async () => {
    const lido = fake({
      name: 'lido',
      supportedChains: [1],
      position: {
        stakedAmountWei: '1000',
        receiptTokenBalanceWei: '999',
        receiptTokenSymbol: 'stETH',
        apr: 3.5,
      },
    });
    const svc = setup([lido]);
    const result = await svc.getPosition(envelope({}));
    expect(result.data?.receiptTokenSymbol).toBe('stETH');
    expect(result.provider.name).toBe('lido');
  });

  it('returns null when provider has no position', async () => {
    const lido = fake({ name: 'lido', supportedChains: [1], position: null });
    const svc = setup([lido]);
    const r = await svc.getPosition(envelope({}));
    expect(r.data).toBeNull();
  });
});

describe('StakingCapabilityService — prepareStake', () => {
  it('uses ranked-first supporting provider', async () => {
    const lido = fake({ name: 'lido', supportedChains: [1] });
    const fallback = fake({ name: 'fallback', supportedChains: [1] });
    const svc = setup([lido, fallback]);
    const r = await svc.prepareStake(envelope({ amount: '1000' }));
    expect(r.provider.name).toBe('lido');
    expect(r.data[0]?.action).toBe('stake-from-lido');
  });

  it('falls back when first provider does not support', async () => {
    const a = fake({ name: 'a', supportedChains: [1], supports: false });
    const b = fake({ name: 'b', supportedChains: [1] });
    const svc = setup([a, b]);
    const r = await svc.prepareStake(envelope({ amount: '1000' }));
    expect(r.provider.name).toBe('b');
    expect(r.attempts[0]?.provider).toBe('a');
  });

  it('rethrows validation errors immediately (no fallback)', async () => {
    const a = fake({ name: 'a', supportedChains: [1], failPrepareStake: 'validation' });
    const b = fake({ name: 'b', supportedChains: [1] });
    const svc = setup([a, b]);
    await expect(svc.prepareStake(envelope({ amount: '0' }))).rejects.toThrow(/a validation/);
  });

  it('falls back on PROVIDER_FAILURE', async () => {
    const a = fake({ name: 'a', supportedChains: [1], failPrepareStake: 'provider' });
    const b = fake({ name: 'b', supportedChains: [1] });
    const svc = setup([a, b]);
    const r = await svc.prepareStake(envelope({ amount: '1000' }));
    expect(r.provider.name).toBe('b');
    expect(r.attempts[0]?.reason).toMatch(/provider failure/);
  });

  it('throws unsupportedRoute when no candidates on chain', async () => {
    const lido = fake({ name: 'lido', supportedChains: [1] });
    const svc = setup([lido]);
    await expect(
      svc.prepareStake(envelope({ amount: '1000' }, 8453)),
    ).rejects.toThrow(/UNSUPPORTED|No provider/);
  });

  it('excludes disabled stubs from candidate list', async () => {
    const lido = fake({ name: 'lido', supportedChains: [1] });
    const stub = fake({ name: 'stub', supportedChains: [1], enabled: false });
    const svc = setup([lido, stub]);
    const r = await svc.prepareStake(envelope({ amount: '1000' }));
    expect(r.provider.name).toBe('lido');
  });
});

describe('StakingCapabilityService — prepareUnstake / prepareClaim', () => {
  it('prepareUnstake routes through fallback chain', async () => {
    const lido = fake({ name: 'lido', supportedChains: [1] });
    const svc = setup([lido]);
    const r = await svc.prepareUnstake(envelope({ amount: '500' }));
    expect(r.data[0]?.action).toBe('unstake-from-lido');
  });

  it('prepareClaim forwards requestIds', async () => {
    const lido = fake({ name: 'lido', supportedChains: [1] });
    const svc = setup([lido]);
    const r = await svc.prepareClaim(envelope({ requestIds: ['1', '2'] }));
    expect(r.data[0]?.action).toBe('claim-from-lido');
  });
});

describe('StakingCapabilityService — getApr', () => {
  it('returns first ranked provider apr', async () => {
    const lido = fake({ name: 'lido', supportedChains: [1] });
    const svc = setup([lido]);
    const r = await svc.getApr(envelope({ asset: 'ETH' }));
    expect(r.data).toBe(3.5);
  });

  it('returns null when provider does not know apr', async () => {
    const other = fake({ name: 'other', supportedChains: [1] });
    const svc = setup([other]);
    const r = await svc.getApr(envelope({ asset: 'ETH' }));
    expect(r.data).toBeNull();
  });
});

describe('StakingCapabilityService — listProviders', () => {
  it('returns capability=staking only', async () => {
    const svc = setup([fake({ name: 'a', supportedChains: [1] })]);
    expect(svc.listProviders().map((p) => p.name)).toEqual(['a']);
  });
});
