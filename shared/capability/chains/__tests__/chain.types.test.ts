import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadChains,
  getChain,
  tryGetChain,
  listChains,
  listKnownChains,
  validateChainManifest,
  _resetChainsCache,
  type ChainManifest,
} from "../chain.types";
import { CapabilityError } from "../../errors";

function manifest(input: Partial<ChainManifest> & Pick<ChainManifest, "id" | "slug">): ChainManifest {
  return {
    id: input.id,
    slug: input.slug,
    name: input.name ?? input.slug,
    nativeAsset: input.nativeAsset ?? { symbol: "ETH", decimals: 18 },
    rpcDefaults: input.rpcDefaults ?? ["https://example.com/rpc"],
    blockExplorerUrl: input.blockExplorerUrl ?? "https://example.com",
    capabilitiesSupported: input.capabilitiesSupported ?? ["swap"],
  };
}

beforeEach(() => {
  _resetChainsCache();
});

describe("validateChainManifest", () => {
  it("accepts a complete valid manifest", () => {
    expect(validateChainManifest(manifest({ id: 1, slug: "ethereum" })).ok).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateChainManifest(null).ok).toBe(false);
    expect(validateChainManifest("manifest").ok).toBe(false);
  });

  it("rejects invalid id (zero, negative, non-integer, missing)", () => {
    const base = manifest({ id: 1, slug: "x" });
    expect(validateChainManifest({ ...base, id: 0 }).ok).toBe(false);
    expect(validateChainManifest({ ...base, id: -1 }).ok).toBe(false);
    expect(validateChainManifest({ ...base, id: 1.5 }).ok).toBe(false);
    const { id: _id, ...withoutId } = base;
    expect(validateChainManifest(withoutId).ok).toBe(false);
  });

  it("rejects invalid slug (uppercase, starts with digit, underscores)", () => {
    expect(validateChainManifest(manifest({ id: 1, slug: "Base" })).ok).toBe(false);
    expect(validateChainManifest(manifest({ id: 1, slug: "1eth" })).ok).toBe(false);
    expect(validateChainManifest(manifest({ id: 1, slug: "my_chain" })).ok).toBe(false);
  });

  it("rejects bad nativeAsset", () => {
    expect(
      validateChainManifest({ ...manifest({ id: 1, slug: "x" }), nativeAsset: null }).ok
    ).toBe(false);
    expect(
      validateChainManifest({
        ...manifest({ id: 1, slug: "x" }),
        nativeAsset: { symbol: "", decimals: 18 },
      }).ok
    ).toBe(false);
    expect(
      validateChainManifest({
        ...manifest({ id: 1, slug: "x" }),
        nativeAsset: { symbol: "ETH", decimals: -1 },
      }).ok
    ).toBe(false);
  });

  it("rejects empty rpcDefaults or non-http(s) entries", () => {
    expect(
      validateChainManifest(manifest({ id: 1, slug: "x", rpcDefaults: [] })).ok
    ).toBe(false);
    expect(
      validateChainManifest(
        manifest({ id: 1, slug: "x", rpcDefaults: ["ftp://no.scheme/"] })
      ).ok
    ).toBe(false);
    expect(
      validateChainManifest(
        manifest({ id: 1, slug: "x", rpcDefaults: ["wss://websocket.example/"] })
      ).ok
    ).toBe(false);
  });

  it("rejects invalid blockExplorerUrl", () => {
    expect(
      validateChainManifest(manifest({ id: 1, slug: "x", blockExplorerUrl: "not-a-url" })).ok
    ).toBe(false);
  });

  it("rejects unknown capability slug", () => {
    expect(
      validateChainManifest({
        ...manifest({ id: 1, slug: "x" }),
        capabilitiesSupported: ["derivatives" as unknown as "swap"],
      }).ok
    ).toBe(false);
  });

  it("rejects duplicate capabilities", () => {
    expect(
      validateChainManifest(
        manifest({ id: 1, slug: "x", capabilitiesSupported: ["swap", "swap"] })
      ).ok
    ).toBe(false);
  });

  it("collects multiple errors at once", () => {
    const r = validateChainManifest({
      id: 0,
      slug: "BAD",
      name: "",
      nativeAsset: null,
      rpcDefaults: [],
      blockExplorerUrl: "x",
      capabilitiesSupported: ["unknown"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(5);
  });
});

describe("loadChains — from injected manifests", () => {
  it("returns the manifests and caches them", () => {
    const m = [manifest({ id: 1, slug: "ethereum" }), manifest({ id: 8453, slug: "base" })];
    const result = loadChains({ manifests: m });
    expect(result).toEqual(m);
    expect(listChains()).toEqual(m);
  });

  it("throws aggregating every invalid manifest", () => {
    const bad: ChainManifest[] = [
      manifest({ id: 0, slug: "BAD" }), // invalid id + slug
      manifest({ id: 1, slug: "ok" }),
      { id: 2, slug: "x" } as unknown as ChainManifest, // missing required fields
    ];
    expect(() => loadChains({ manifests: bad })).toThrowError(CapabilityError);
    try {
      loadChains({ manifests: bad });
    } catch (e) {
      const err = e as CapabilityError;
      expect(err.code).toBe("CAPABILITY_CHAIN_LOAD_FAILED");
      expect(Array.isArray((err.details as { errors: unknown[] }).errors)).toBe(true);
    }
  });

  it("throws on duplicate id", () => {
    try {
      loadChains({
        manifests: [
          manifest({ id: 1, slug: "ethereum" }),
          manifest({ id: 1, slug: "ethereum-classic" }),
        ],
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CapabilityError).code).toBe("CAPABILITY_CHAIN_DUPLICATE_ID");
    }
  });

  it("throws on duplicate slug", () => {
    try {
      loadChains({
        manifests: [
          manifest({ id: 1, slug: "ethereum" }),
          manifest({ id: 999, slug: "ethereum" }),
        ],
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as CapabilityError).code).toBe("CAPABILITY_CHAIN_DUPLICATE_SLUG");
    }
  });
});

describe("getChain / tryGetChain / listKnownChains", () => {
  beforeEach(() => {
    loadChains({
      manifests: [
        manifest({ id: 1, slug: "ethereum", name: "Ethereum" }),
        manifest({ id: 8453, slug: "base", name: "Base" }),
      ],
    });
  });

  it("looks up by id", () => {
    expect(getChain(1).slug).toBe("ethereum");
    expect(getChain(8453).slug).toBe("base");
  });

  it("looks up by slug", () => {
    expect(getChain("ethereum").id).toBe(1);
    expect(getChain("base").id).toBe(8453);
  });

  it("throws on unknown lookup with informative message", () => {
    expect(() => getChain(137)).toThrowError(/Unknown chain/);
    try {
      getChain("solana");
    } catch (e) {
      const err = e as CapabilityError;
      expect(err.code).toBe("CAPABILITY_CHAIN_UNKNOWN");
      expect(err.message).toContain("ethereum(1)");
      expect(err.message).toContain("base(8453)");
    }
  });

  it("tryGetChain returns undefined for unknown", () => {
    expect(tryGetChain(137)).toBeUndefined();
    expect(tryGetChain("solana")).toBeUndefined();
  });

  it("listKnownChains returns slug(id) strings", () => {
    expect(listKnownChains().sort()).toEqual(["base(8453)", "ethereum(1)"]);
  });
});

describe("loadChains — from a real directory", () => {
  it("reads *.manifest.json files (sorted), parses, validates", () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-load-"));
    writeFileSync(
      join(dir, "base.manifest.json"),
      JSON.stringify(manifest({ id: 8453, slug: "base", name: "Base" })),
      "utf-8"
    );
    writeFileSync(
      join(dir, "ethereum.manifest.json"),
      JSON.stringify(manifest({ id: 1, slug: "ethereum", name: "Ethereum" })),
      "utf-8"
    );
    // Non-manifest files are ignored.
    writeFileSync(join(dir, "README.md"), "ignore me", "utf-8");

    const chains = loadChains({ directory: dir, reload: true });
    expect(chains.map((c) => c.slug).sort()).toEqual(["base", "ethereum"]);
  });

  it("throws when directory missing", () => {
    expect(() =>
      loadChains({ directory: "/nonexistent/dir", reload: true })
    ).toThrowError(/Chains directory not found/);
  });

  it("throws when JSON is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "chain-load-"));
    writeFileSync(join(dir, "bad.manifest.json"), "{not json", "utf-8");
    expect(() => loadChains({ directory: dir, reload: true })).toThrowError(
      /not valid JSON/
    );
  });
});

describe("loadChains — auto-load default directory", () => {
  it("loads committed manifests (base, avalanche, ethereum, arbitrum, ton)", () => {
    _resetChainsCache();
    const chains = loadChains();
    const slugs = chains.map((c) => c.slug).sort();
    expect(slugs).toEqual(["arbitrum", "avalanche", "base", "ethereum", "ton"]);

    expect(getChain("base").id).toBe(8453);
    expect(getChain("avalanche").id).toBe(43114);
    expect(getChain("ethereum").id).toBe(1);
    expect(getChain("arbitrum").id).toBe(42161);
    expect(getChain("ton").id).toBe(607);
  });

  it("Base manifest declares swap, lending, liquidity, bridge", () => {
    _resetChainsCache();
    const base = getChain("base");
    expect(new Set(base.capabilitiesSupported)).toEqual(new Set(["swap", "lending", "liquidity", "bridge"]));
  });

  it("Avalanche manifest declares swap, lending, liquidity, staking, bridge", () => {
    _resetChainsCache();
    const av = getChain("avalanche");
    expect(new Set(av.capabilitiesSupported)).toEqual(
      new Set(["swap", "lending", "liquidity", "staking", "bridge"])
    );
  });

  it("Ethereum manifest declares swap, staking, bridge", () => {
    _resetChainsCache();
    const eth = getChain("ethereum");
    expect(new Set(eth.capabilitiesSupported)).toEqual(new Set(["swap", "staking", "bridge"]));
  });
});
