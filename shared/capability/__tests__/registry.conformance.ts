/**
 * registry.conformance — reusable test helper.
 *
 * Every capability service runs this suite against its own registry to guarantee that the
 * generic registry contract holds end-to-end (registration, lookup, filtering, health, policy
 * integration). The helper is NOT itself a test file — it's a function that mounts a `describe`
 * block when called.
 *
 *     // in <service>/src/__tests__/<cap>.conformance.test.ts
 *     import { describeRegistryConformance } from '@panorama/capability/__tests__/registry.conformance';
 *     import { setupSwapRegistry } from '../some-fixture';
 *
 *     describeRegistryConformance('swap', () => setupSwapRegistry());
 *
 * The factory returns the registry + a small set of providers + a helper to register them,
 * letting each capability run the same suite against its own concrete adapter instances.
 *
 * Card #210 (SPRINT_HUGO.md).
 */

import { describe, it, expect } from "vitest";

import { CapabilityError } from "../errors";
import type { CapabilitySlug, ICapabilityProvider } from "../provider.types";
import { ChainAssetPriorityPolicy, fallbackInvoke } from "../policy";
import type { ProviderRegistry } from "../registry";

// -------------------------------------------------------------------------------------------------
// Factory contract — what each capability must supply
// -------------------------------------------------------------------------------------------------

export interface ConformanceProvider extends ICapabilityProvider {
  /** Reports whether this provider supports the route — used by the fallback iteration test. */
  supportsRoute?: (input: { chainId: number }) => Promise<boolean>;
  /** Performs the canonical action of the capability. The test only needs a stable return. */
  run?: () => Promise<string>;
}

export interface ConformanceSetup<TProvider extends ConformanceProvider> {
  registry: ProviderRegistry<TProvider>;
  /** Three providers ready to register: one supports chain A, one supports chain B, one is a stub. */
  providers: {
    chainA: TProvider;
    chainB: TProvider;
    stub: TProvider;
  };
  /** Chain id A: registered chain that providers.chainA supports. */
  chainAId: number;
  /** Chain id B: registered chain that providers.chainB supports. */
  chainBId: number;
}

export type ConformanceFactory<TProvider extends ConformanceProvider> = () =>
  | ConformanceSetup<TProvider>
  | Promise<ConformanceSetup<TProvider>>;

// -------------------------------------------------------------------------------------------------
// The suite
// -------------------------------------------------------------------------------------------------

/**
 * Mount the conformance suite. Call from inside a capability's test file.
 *
 * @param capability — slug for naming + factory access (e.g. 'swap', 'staking')
 * @param factory — produces a fresh setup per test (registry must be empty before .register calls)
 */
export function describeRegistryConformance<TProvider extends ConformanceProvider>(
  capability: CapabilitySlug,
  factory: ConformanceFactory<TProvider>
): void {
  describe(`registry conformance — ${capability}`, () => {
    it("registers all three providers without throwing", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);
      setup.registry.register(setup.providers.stub);
      expect(setup.registry.size()).toBe(3);
    });

    it("getByName returns the right provider", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      const found = setup.registry.getByName(setup.providers.chainA.name);
      expect(found?.name).toBe(setup.providers.chainA.name);
    });

    it("rejects duplicate names with CapabilityError", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      expect(() => setup.registry.register(setup.providers.chainA)).toThrowError(CapabilityError);
    });

    it("listByChain narrows to chain-supporting providers", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);
      const a = setup.registry.listByChain(setup.chainAId).map((p) => p.name);
      const b = setup.registry.listByChain(setup.chainBId).map((p) => p.name);
      expect(a).toContain(setup.providers.chainA.name);
      expect(a).not.toContain(setup.providers.chainB.name);
      expect(b).toContain(setup.providers.chainB.name);
      expect(b).not.toContain(setup.providers.chainA.name);
    });

    it("listByChain excludes disabled stubs by default", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.stub);
      const stubChain = (setup.providers.stub.metadata.supportedChains[0] as number) ?? setup.chainAId;
      const names = setup.registry.listByChain(stubChain).map((p) => p.name);
      expect(names).not.toContain(setup.providers.stub.name);
    });

    it("listByChain with includeDisabled returns the stub", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.stub);
      const stubChain = (setup.providers.stub.metadata.supportedChains[0] as number) ?? setup.chainAId;
      const names = setup.registry
        .listByChain(stubChain, { includeDisabled: true })
        .map((p) => p.name);
      expect(names).toContain(setup.providers.stub.name);
    });

    it("health oracle filters out unhealthy", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);
      // Mark chainA unhealthy
      const aName = setup.providers.chainA.name;
      setup.registry.attachHealthOracle({ isHealthy: (n) => n !== aName });
      const visible = setup.registry.listByChain(setup.chainAId).map((p) => p.name);
      expect(visible).not.toContain(aName);
      // Detach → all healthy again
      setup.registry.attachHealthOracle(undefined);
      expect(setup.registry.listByChain(setup.chainAId).map((p) => p.name)).toContain(aName);
    });

    it("metadataSnapshot returns one entry per provider", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);
      expect(setup.registry.metadataSnapshot()).toHaveLength(2);
    });

    it("policy ranks providers per chain id", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);
      const policy = new ChainAssetPriorityPolicy({
        [setup.chainAId.toString()]: [setup.providers.chainA.name],
        [setup.chainBId.toString()]: [setup.providers.chainB.name],
      });
      const aRanked = policy
        .rank(setup.registry.listAll(), { chainId: setup.chainAId })
        .map((p) => p.name);
      expect(aRanked[0]).toBe(setup.providers.chainA.name);
    });

    it("fallbackInvoke succeeds on first supporting provider", async () => {
      const setup = await factory();
      // Use only providers that have supportsRoute + run (skip stub which throws)
      const A = withDefaults(setup.providers.chainA);
      const B = withDefaults(setup.providers.chainB);
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);

      const outcome = await fallbackInvoke({
        ranked: [A, B],
        supportsRoute: (p) => p.supportsRoute!({ chainId: setup.chainAId }),
        invoke: (p) => p.run!(),
        capability,
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.provider.name).toBe(A.name);
      }
    });

    it("fallbackInvoke falls back when first does not support", async () => {
      const setup = await factory();
      const A = withDefaults(setup.providers.chainA);
      const B = withDefaults(setup.providers.chainB);
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);

      const outcome = await fallbackInvoke({
        ranked: [A, B],
        supportsRoute: (p) => p.supportsRoute!({ chainId: setup.chainBId }),
        invoke: (p) => p.run!(),
        capability,
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.provider.name).toBe(B.name);
        expect(outcome.attempts[0]?.reason).toBe("route unsupported");
      }
    });

    it("fallbackInvoke returns allProvidersFailed when none support", async () => {
      const setup = await factory();
      const A = withDefaults(setup.providers.chainA);
      const B = withDefaults(setup.providers.chainB);

      const outcome = await fallbackInvoke({
        ranked: [A, B],
        supportsRoute: async () => false,
        invoke: async () => "never",
        capability,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(CapabilityError);
      }
    });

    it("unregister + re-register flow works", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      expect(setup.registry.unregister(setup.providers.chainA.name)).toBe(true);
      expect(setup.registry.size()).toBe(0);
      setup.registry.register(setup.providers.chainA);
      expect(setup.registry.getByName(setup.providers.chainA.name)).toBeDefined();
    });

    it("clear empties the registry", async () => {
      const setup = await factory();
      setup.registry.register(setup.providers.chainA);
      setup.registry.register(setup.providers.chainB);
      setup.registry.clear();
      expect(setup.registry.size()).toBe(0);
    });

    it("metadata.capability matches the suite slug", async () => {
      const setup = await factory();
      for (const p of [setup.providers.chainA, setup.providers.chainB]) {
        expect(p.metadata.capability).toBe(capability);
      }
    });
  });
}

// Provide default supportsRoute / run so the helper works even if the caller's providers omit them.
function withDefaults<TProvider extends ConformanceProvider>(p: TProvider): TProvider {
  const chains = p.metadata.supportedChains;
  const supportsRoute =
    p.supportsRoute ??
    (async (input: { chainId: number }) => chains.includes(input.chainId));
  const run = p.run ?? (async () => `${p.name}-ok`);
  return { ...p, supportsRoute, run } as TProvider;
}
