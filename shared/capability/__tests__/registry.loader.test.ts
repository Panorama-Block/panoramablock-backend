import { describe, it, expect, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProviderRegistry } from "../registry";
import {
  loadProvidersFromConfig,
  type ProviderConfigFile,
  type ProviderFactory,
} from "../registry.loader";
import type { ICapabilityProvider } from "../provider.types";
import { CapabilityError } from "../errors";

interface SwapProvider extends ICapabilityProvider {}

function factoryForFixed(): ProviderFactory<SwapProvider> {
  return (entry) =>
    ({
      name: entry.name,
      metadata: {
        name: entry.name,
        capability: entry.capability as "swap",
        supportedChains: entry.supportedChains,
        version: entry.version,
        ...(entry.features !== undefined && { features: entry.features }),
        ...(entry.enabled !== undefined && { enabled: entry.enabled }),
      },
    }) satisfies SwapProvider;
}

function validConfig(): ProviderConfigFile {
  return {
    providers: [
      {
        name: "uniswap",
        capability: "swap",
        supportedChains: [1, 8453],
        version: "1.0.0",
        enabled: true,
      },
      {
        name: "aerodrome",
        capability: "swap",
        supportedChains: [8453],
        version: "1.0.0",
        enabled: true,
      },
    ],
  };
}

describe("loadProvidersFromConfig — config arg", () => {
  it("registers all enabled providers from in-memory config", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const result = loadProvidersFromConfig(r, {
      config: validConfig(),
      factory: factoryForFixed(),
    });
    expect(result.registered.sort()).toEqual(["aerodrome", "uniswap"]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(r.size()).toBe(2);
  });

  it("skips disabled providers by default", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const config: ProviderConfigFile = {
      providers: [
        { name: "uniswap", capability: "swap", supportedChains: [1], version: "1.0.0", enabled: true },
        { name: "thirdweb", capability: "swap", supportedChains: [1], version: "1.0.0", enabled: false },
      ],
    };
    const result = loadProvidersFromConfig(r, { config, factory: factoryForFixed() });
    expect(result.registered).toEqual(["uniswap"]);
    expect(result.skipped).toEqual([{ name: "thirdweb", reason: "disabled in config" }]);
    expect(r.getByName("thirdweb")).toBeUndefined();
  });

  it("with skipDisabled: false, sends disabled to factory + registry", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const config: ProviderConfigFile = {
      providers: [
        { name: "uniswap", capability: "swap", supportedChains: [1], version: "1.0.0", enabled: true },
        { name: "thirdweb", capability: "swap", supportedChains: [1], version: "1.0.0", enabled: false },
      ],
    };
    const result = loadProvidersFromConfig(r, {
      config,
      factory: factoryForFixed(),
      skipDisabled: false,
    });
    expect(result.registered.sort()).toEqual(["thirdweb", "uniswap"]);
    expect(r.size()).toBe(2);
    expect(r.listAll().map((p) => p.name)).toEqual(["uniswap"]); // listAll defaults to enabled-only
    expect(r.listAll({ includeDisabled: true }).map((p) => p.name).sort()).toEqual([
      "thirdweb",
      "uniswap",
    ]);
  });

  it("skips providers when factory returns null", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const factory: ProviderFactory<SwapProvider> = (entry) =>
      entry.name === "aerodrome" ? null : factoryForFixed()(entry);
    const result = loadProvidersFromConfig(r, { config: validConfig(), factory });
    expect(result.registered).toEqual(["uniswap"]);
    expect(result.skipped).toEqual([{ name: "aerodrome", reason: "factory returned null" }]);
  });
});

describe("loadProvidersFromConfig — validation failures", () => {
  it("aborts when ANY entry has invalid metadata, lists every error", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const config: ProviderConfigFile = {
      providers: [
        { name: "BadCase", capability: "swap", supportedChains: [1], version: "1.0.0" },
        { name: "unknown-cap", capability: "derivatives", supportedChains: [1], version: "1.0.0" },
      ],
    };
    expect(() =>
      loadProvidersFromConfig(r, { config, factory: factoryForFixed() })
    ).toThrowError(CapabilityError);

    try {
      loadProvidersFromConfig(r, { config, factory: factoryForFixed() });
    } catch (e) {
      const err = e as CapabilityError;
      expect(err.code).toBe("CAPABILITY_REGISTRY_LOAD_FAILED");
      expect(err.details).toMatchObject({
        validationErrors: expect.arrayContaining([
          expect.objectContaining({ name: "BadCase" }),
          expect.objectContaining({ name: "unknown-cap" }),
        ]),
      });
    }
    expect(r.size()).toBe(0); // no partial register
  });

  it("aborts when factory throws (treated as internal error)", () => {
    const r = new ProviderRegistry<SwapProvider>();
    const factory: ProviderFactory<SwapProvider> = vi.fn(() => {
      throw new Error("missing env var BENQI_RPC_URL");
    });
    expect(() =>
      loadProvidersFromConfig(r, { config: validConfig(), factory })
    ).toThrowError(/Factory threw for provider/);
    expect(factory).toHaveBeenCalledOnce(); // aborts on first failure
    expect(r.size()).toBe(0);
  });

  it("rejects config arg without providers array (bad shape)", () => {
    const r = new ProviderRegistry<SwapProvider>();
    expect(() =>
      loadProvidersFromConfig(r, {
        // @ts-expect-error — intentionally bad
        config: { wrong: true },
        factory: factoryForFixed(),
      })
    ).toThrow();
  });

  it("requires configPath OR config", () => {
    const r = new ProviderRegistry<SwapProvider>();
    expect(() =>
      loadProvidersFromConfig(r, {
        factory: factoryForFixed(),
      })
    ).toThrowError(/Either configPath or config/);
  });
});

describe("loadProvidersFromConfig — configPath (filesystem)", () => {
  it("reads + parses + loads from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "capability-loader-"));
    const path = join(dir, "providers.test.json");
    writeFileSync(path, JSON.stringify(validConfig()), "utf-8");

    const r = new ProviderRegistry<SwapProvider>();
    const result = loadProvidersFromConfig(r, {
      configPath: path,
      factory: factoryForFixed(),
    });
    expect(result.registered.sort()).toEqual(["aerodrome", "uniswap"]);
  });

  it("errors with a structured CapabilityError when file is missing", () => {
    const r = new ProviderRegistry<SwapProvider>();
    expect(() =>
      loadProvidersFromConfig(r, {
        configPath: "/nonexistent/path/providers.json",
        factory: factoryForFixed(),
      })
    ).toThrowError(/Cannot read provider config/);
  });

  it("errors when JSON is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "capability-loader-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, "{not json", "utf-8");

    const r = new ProviderRegistry<SwapProvider>();
    expect(() =>
      loadProvidersFromConfig(r, {
        configPath: path,
        factory: factoryForFixed(),
      })
    ).toThrowError(/not valid JSON/);
  });
});
