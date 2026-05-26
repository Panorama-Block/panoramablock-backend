/**
 * Conformance test — verifies swap adapters satisfy the shared registry contract.
 */
import { describe, it, expect } from "@jest/globals";
import { ProviderRegistry, type ProviderMetadata } from "@panorama/capability";
import { ISwapProvider } from "../domain/ports/swap.provider.port";
import { SwapRequest, SwapQuote } from "../domain/entities/swap";

class FakeSwapProvider implements ISwapProvider {
  public readonly metadata: ProviderMetadata;
  constructor(
    public readonly name: string,
    private readonly chains: number[] = [1, 8453]
  ) {
    this.metadata = {
      name,
      capability: "swap",
      supportedChains: chains,
      version: "1.0.0",
      enabled: true,
    };
  }
  async supportsRoute(params: any): Promise<boolean> {
    return this.metadata.supportedChains.includes(params.fromChainId);
  }
  async getQuote(_request: SwapRequest): Promise<SwapQuote> {
    return new SwapQuote(BigInt(1000), BigInt(0), BigInt(100), 1.0, 30);
  }
  async prepareSwap(): Promise<any> {
    return { provider: this.name, transactions: [], estimatedDuration: 30 };
  }
  async monitorTransaction(): Promise<any> {
    return "COMPLETED";
  }
}

describe("swap provider conformance", () => {
  it("registers and retrieves providers by name", () => {
    const registry = new ProviderRegistry<ISwapProvider>();
    const p = new FakeSwapProvider("test-swap");
    registry.register(p);
    expect(registry.getByName("test-swap")).toBe(p);
    expect(registry.size()).toBe(1);
  });

  it("rejects duplicate registration", () => {
    const registry = new ProviderRegistry<ISwapProvider>();
    registry.register(new FakeSwapProvider("dup"));
    expect(() => registry.register(new FakeSwapProvider("dup"))).toThrow();
  });

  it("listByChain filters correctly", () => {
    const registry = new ProviderRegistry<ISwapProvider>();
    registry.register(new FakeSwapProvider("base-only", [8453]));
    registry.register(new FakeSwapProvider("eth-only", [1]));
    registry.register(new FakeSwapProvider("multi", [1, 8453]));

    const baseProviders = registry.listByChain(8453);
    expect(baseProviders.map((p) => p.name).sort()).toEqual(["base-only", "multi"]);

    const ethProviders = registry.listByChain(1);
    expect(ethProviders.map((p) => p.name).sort()).toEqual(["eth-only", "multi"]);
  });

  it("disabled providers excluded by default", () => {
    const registry = new ProviderRegistry<ISwapProvider>();
    const enabled = new FakeSwapProvider("enabled");
    const disabled = new FakeSwapProvider("disabled");
    (disabled.metadata as any).enabled = false;
    registry.register(enabled);
    registry.register(disabled);

    expect(registry.listAll().length).toBe(1);
    expect(registry.listAll({ includeDisabled: true }).length).toBe(2);
  });

  it("metadata validates on register", () => {
    const registry = new ProviderRegistry<ISwapProvider>();
    const bad = new FakeSwapProvider("UPPERCASE");
    expect(() => registry.register(bad)).toThrow();
  });

  it("name must match metadata.name", () => {
    const registry = new ProviderRegistry<ISwapProvider>();
    const mismatch = new FakeSwapProvider("one");
    Object.defineProperty(mismatch, "name", { value: "two" });
    expect(() => registry.register(mismatch)).toThrow();
  });

  it("supportsRoute returns boolean without throwing", async () => {
    const p = new FakeSwapProvider("test-route", [8453]);
    expect(await p.supportsRoute({ fromChainId: 8453, toChainId: 8453, fromToken: "A", toToken: "B" })).toBe(true);
    expect(await p.supportsRoute({ fromChainId: 1, toChainId: 1, fromToken: "A", toToken: "B" })).toBe(false);
  });

  it("getQuote returns a SwapQuote", async () => {
    const p = new FakeSwapProvider("quoter");
    const req = new SwapRequest(8453, 8453, "0xA", "0xB", BigInt(1000), "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222");
    const quote = await p.getQuote(req);
    expect(quote).toBeInstanceOf(SwapQuote);
    expect(typeof quote.estimatedReceiveAmount).toBe("bigint");
  });
});
