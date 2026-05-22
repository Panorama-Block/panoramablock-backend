/**
 * Composition root for the staking capability.
 *
 * Builds the registry, instantiates concrete adapters (Lido + Base stub), wires the policy,
 * mounts the health tracker, and returns the facade + discovery handler. The HTTP layer
 * (`staking.routes.ts`) consumes only what's returned here.
 *
 * Card #245 (SPRINT_HUGO.md).
 */

import {
  ChainAssetPriorityPolicy,
  ProviderHealthTracker,
  ProviderRegistry,
  createDiscoveryHandler,
  type DiscoveryHandler,
} from '@panorama/capability';
import { getChain } from '@panorama/capability/chains';

import { LidoProviderAdapter } from '../adapters/lido.provider.adapter';
import { BaseStakingProviderAdapter } from '../adapters/base-staking.provider.adapter';
import {
  StakingCapabilityService,
} from '../../application/services/staking.capability.service';
import type { IStakingProvider } from '../../domain/ports/staking.provider.port';
import { LidoService } from '../../application/services/LidoService';
import { LidoRepository } from '../repositories/LidoRepository';
import { Logger } from '../logs/logger';

export interface StakingContainer {
  facade: StakingCapabilityService;
  registry: ProviderRegistry<IStakingProvider>;
  healthTracker: ProviderHealthTracker;
  discoveryHandler: DiscoveryHandler;
  start(): void;
  stop(): void;
}

export interface BuildStakingContainerOptions {
  /** Inject when testing — skips ProviderHealthTracker autostart. */
  autoStartHealth?: boolean;
  /** Override Lido provider (test convenience). When absent, builds the default Lido stack. */
  lidoProvider?: IStakingProvider;
}

export function buildStakingContainer(
  options: BuildStakingContainerOptions = {},
): StakingContainer {
  const logger = new Logger();
  const registry = new ProviderRegistry<IStakingProvider>();

  // Lido — main production provider on Ethereum.
  const lido =
    options.lidoProvider ??
    new LidoProviderAdapter({
      lidoService: new LidoService(new LidoRepository(), logger),
      logger,
    });
  registry.register(lido);

  // Base cbETH — stub, disabled by default (registry skips by default; opt-in via includeDisabled).
  registry.register(new BaseStakingProviderAdapter());

  // Policy — single-provider per chain today; declared so adding cbETH later is config-only.
  const policy = new ChainAssetPriorityPolicy({
    [String(getChain('ethereum').id)]: ['lido'],
    [String(getChain('base').id)]: ['base-staking-stub'],
  });

  // Health tracker — polls every 30s by default; respects ProviderRegistry filter.
  const healthTracker = new ProviderHealthTracker({
    intervalMs: 30_000,
    unhealthyAfter: 3,
    probeTimeoutMs: 5_000,
    onError: (name, error) => logger.warn(`[health] ${name} probe failed: ${(error as Error).message}`),
  });
  registry.attachHealthOracle(healthTracker);
  healthTracker.track(lido);
  // Stub doesn't need probing — keeps it out of report noise.

  const facade = new StakingCapabilityService({ registry, policy });

  const discoveryHandler = createDiscoveryHandler({
    listProviders: () => registry.listAll(),
    snapshotHealth: () => healthTracker.snapshot(),
    cacheTtlSeconds: 30,
  });

  return {
    facade,
    registry,
    healthTracker,
    discoveryHandler,
    start: () => {
      if (options.autoStartHealth !== false) healthTracker.start();
    },
    stop: () => {
      healthTracker.stop();
    },
  };
}
