/**
 * Self-test: run the conformance helper against an in-package fake registry, ensuring the helper
 * itself behaves before any consuming capability adopts it.
 */

import { ProviderRegistry } from "../registry";
import {
  describeRegistryConformance,
  type ConformanceProvider,
  type ConformanceSetup,
} from "./registry.conformance";

interface FakeProvider extends ConformanceProvider {}

function fake(input: {
  name: string;
  chainIds: number[];
  enabled?: boolean;
}): FakeProvider {
  return {
    name: input.name,
    metadata: {
      name: input.name,
      capability: "swap",
      supportedChains: input.chainIds,
      version: "1.0.0",
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
    supportsRoute: async ({ chainId }) => input.chainIds.includes(chainId),
    run: async () => `${input.name}-ran`,
  };
}

function setup(): ConformanceSetup<FakeProvider> {
  return {
    registry: new ProviderRegistry<FakeProvider>(),
    providers: {
      chainA: fake({ name: "fake-a", chainIds: [1] }),
      chainB: fake({ name: "fake-b", chainIds: [8453] }),
      stub: fake({ name: "fake-stub", chainIds: [1], enabled: false }),
    },
    chainAId: 1,
    chainBId: 8453,
  };
}

describeRegistryConformance("swap", () => setup());
