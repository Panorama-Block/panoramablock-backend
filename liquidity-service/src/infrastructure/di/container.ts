/**
 * Composition root for the liquidity capability.
 *
 * Card #251. Builds the registry, instantiates concrete adapters (none in this scaffold —
 * Aerodrome LP adapter lands in card #253, Trader Joe stub in #254), wires the policy, mounts
 * the discovery handler, and returns the facade + handler. `app.ts` consumes only what's returned.
 *
 * The registry starts EMPTY in this PR — discovery endpoint reports an empty provider set, which
 * is the expected outcome until #253 registers `AerodromeLpAdapter`.
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

  // Default policy — empty per-chain priority lists. Fully populated as adapters land:
  //   #253 → '8453' (Base): ['aerodrome-lp']
  //   #254 → '43114' (Avax): ['traderjoe-lp'] (stub, enabled:false by default)
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
