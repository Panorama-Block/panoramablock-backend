/**
 * Lending Capability — composition root.
 *
 * Wires the ProviderRegistry, instantiates both adapters, sets the priority policy,
 * mounts the health tracker, and returns the facade + discovery handler ready for
 * the HTTP layer.
 *
 * Provider priority on chain 43114:
 *   1. execution-layer (primary — handles all actions)
 *   2. benqi           (fallback — read-only markets + positions)
 */

import {
  ChainAssetPriorityPolicy,
  ProviderHealthTracker,
  ProviderRegistry,
  createDiscoveryHandler,
  type DiscoveryHandler,
} from "@panorama/capability";

import { ExecutionLayerLendingAdapter } from "../adapters/execution-layer.lending.adapter";
import { BenqiLendingAdapter } from "../adapters/benqi.lending.adapter";
import { LendingCapabilityService } from "../../application/services/lending.capability.service";
import type { ILendingProvider } from "../../domain/ports/lending.provider.port";

export interface LendingContainer {
  facade: LendingCapabilityService;
  registry: ProviderRegistry<ILendingProvider>;
  healthTracker: ProviderHealthTracker;
  discoveryHandler: DiscoveryHandler;
  /** Call on server start to begin health polling. */
  start(): void;
  /** Call on graceful shutdown. */
  stop(): void;
}

export interface BuildLendingContainerOptions {
  /** Override the execution-layer base URL (default: EXECUTION_LAYER_URL env or localhost:3011). */
  executionLayerUrl?: string;
  /** Override the self base URL used by the Benqi adapter (default: localhost:PORT). */
  selfBaseUrl?: string;
  /** Skip auto-starting the health tracker (useful in tests). */
  autoStartHealth?: boolean;
}

export function buildLendingContainer(
  options: BuildLendingContainerOptions = {},
): LendingContainer {
  const registry = new ProviderRegistry<ILendingProvider>();

  // Primary provider — execution layer handles all prepare-* and read routes
  const executionLayer = new ExecutionLayerLendingAdapter(options.executionLayerUrl);
  registry.register(executionLayer);

  // Fallback provider — read-only Benqi direct (self-calls legacy routes)
  const benqi = new BenqiLendingAdapter(options.selfBaseUrl);
  registry.register(benqi);

  // Priority policy: on Avalanche (43114) try execution-layer first, benqi second
  const policy = new ChainAssetPriorityPolicy({
    "43114": ["execution-layer", "benqi"],
  });

  // Health tracker — polls every 30s, opens circuit after 3 consecutive failures
  const healthTracker = new ProviderHealthTracker({
    intervalMs: 30_000,
    unhealthyAfter: 3,
    probeTimeoutMs: 5_000,
    onError: (name: string, error: unknown) =>
      console.warn(`[lending][health] ${name} probe failed: ${(error as Error).message ?? error}`),
  });
  registry.attachHealthOracle(healthTracker);
  healthTracker.track(executionLayer);
  healthTracker.track(benqi);

  const facade = new LendingCapabilityService({ registry, policy });

  const discoveryHandler = createDiscoveryHandler({
    listProviders: () => registry.listAll({ capability: "lending" }),
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
