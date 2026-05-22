/**
 * Staking capability conformance — exercises the shared
 * `describeRegistryConformance` helper from `@panorama/capability` against an in-process
 * staking-shaped fake.
 *
 * The Lido + Base stub run inside the same registry in production via `buildStakingContainer`;
 * here we use lightweight fakes so the suite runs offline and fast. The adapter integration
 * test (forked mainnet) is a separate file (`lido.provider.adapter.integration.test.ts`,
 * shipped in a follow-up PR per the project rule: adapter tests fork mainnet, never mocks).
 *
 * Card #249 (SPRINT_HUGO.md).
 */

import { ProviderRegistry } from '@panorama/capability';
import { describeRegistryConformance } from '@panorama/capability/__tests__/registry.conformance';

import type { IStakingProvider } from '../domain/ports/staking.provider.port';

function fakeStaking(input: {
  name: string;
  chains: number[];
  enabled?: boolean;
}): IStakingProvider {
  return {
    name: input.name,
    metadata: {
      name: input.name,
      capability: 'staking',
      supportedChains: input.chains,
      version: '1.0.0',
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
    async supportsRoute({ chainId }) {
      return input.chains.includes(chainId);
    },
    async getPosition() {
      return null;
    },
    async prepareStake() {
      return [];
    },
    async prepareUnstake() {
      return [];
    },
    async prepareClaim() {
      return [];
    },
    async getApr() {
      return null;
    },
  } satisfies IStakingProvider;
}

describeRegistryConformance('staking', () => ({
  registry: new ProviderRegistry<IStakingProvider>(),
  providers: {
    chainA: fakeStaking({ name: 'lido-fake', chains: [1] }),
    chainB: fakeStaking({ name: 'base-fake', chains: [8453] }),
    stub: fakeStaking({ name: 'stub-fake', chains: [1], enabled: false }),
  },
  chainAId: 1,
  chainBId: 8453,
}));
