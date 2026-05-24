/**
 * Composition root for the liquidity capability.
 *
 * Builds the registry, wires the policy + discovery handler, and returns the
 * facade + handler. `app.ts` consumes only what's returned. The registry starts
 * empty — concrete adapters are registered as they land.
 */

import {
  ChainAssetPriorityPolicy,
  ProviderRegistry,
  createDiscoveryHandler,
  type DiscoveryHandler,
} from '@panorama/capability';

import {
  LiquidityCapabilityService,
} from '../../application/services/liquidity.capability.service';
import type { ILiquidityProvider } from '../../domain/ports/liquidity.provider.port';

export interface LiquidityContainer {
  facade: LiquidityCapabilityService;
  registry: ProviderRegistry<ILiquidityProvider>;
  discoveryHandler: DiscoveryHandler;
}

export interface BuildLiquidityContainerOptions {
  /** Test convenience — pre-register one or more providers. */
  providers?: ILiquidityProvider[];
  /**
   * Override the priority policy. Defaults to a single-provider-per-chain map populated as
   * adapters land (Aerodrome on Base in #253, Trader Joe LB on Avax in #254).
   */
  policy?: ConstructorParameters<typeof ChainAssetPriorityPolicy>[0];
}

export function buildLiquidityContainer(
  options: BuildLiquidityContainerOptions = {}
): LiquidityContainer {
  const registry = new ProviderRegistry<ILiquidityProvider>();

  for (const p of options.providers ?? []) {
    registry.register(p);
  }

  const policy = new ChainAssetPriorityPolicy(options.policy ?? {});

  const facade = new LiquidityCapabilityService({ registry, policy });

  const discoveryHandler = createDiscoveryHandler({
    listProviders: () => registry.listAll(),
    cacheTtlSeconds: 30,
  });

  return {
    facade,
    registry,
    discoveryHandler,
  };
}
