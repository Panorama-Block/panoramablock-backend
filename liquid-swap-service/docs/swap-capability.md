# Swap Capability — Interface Contract

> **Card #229** — `liquid-swap-service` swap-provider contract.
> **Audience:** anyone adding a new swap adapter (Uniswap V5, 1inch, Trader Joe, Curve, etc.).

This service implements the **swap** capability under the shared Capability + Provider pattern (see `@panorama/capability/CONVENTIONS.md` and `execution-layer/docs/adr/002-capability-provider-abstraction.md`).

Every concrete swap implementation lives in `src/infrastructure/adapters/` and **must** implement `ISwapProvider` from `src/domain/ports/swap.provider.port.ts`. The port extends `ICapabilityProvider` from `@panorama/capability` and adds the swap-specific actions.

---

## 1. What an `ISwapProvider` must declare

```typescript
import type { ProviderMetadata } from "@panorama/capability";
import { ISwapProvider, RouteParams, PreparedSwap } from "../../domain/ports/swap.provider.port";

export class MyAdapter implements ISwapProvider {
  // Inherited from ICapabilityProvider
  public readonly name = "my-provider";                              // matches metadata.name
  public readonly metadata: ProviderMetadata = {
    name: "my-provider",                                              // lowercase, kebab-case
    capability: "swap",
    supportedChains: [1, 8453, 137],                                  // chains the provider can route on
    features: ["same-chain", "permit2"],                              // free-form tags
    version: "1.0.0",                                                 // adapter SemVer (not protocol)
    enabled: true,                                                    // false → registry skips by default
  };

  async healthCheck() { /* optional — polled every 30s by ProviderHealthTracker */ }

  // Swap-specific port methods
  async supportsRoute(params: RouteParams): Promise<boolean> { /* ... */ }
  async getQuote(request: SwapRequest): Promise<SwapQuote> { /* ... */ }
  async prepareSwap(request: SwapRequest): Promise<PreparedSwap> { /* ... */ }
  async monitorTransaction(txHash: string, chainId: number): Promise<TransactionStatus> { /* ... */ }
}
```

### `metadata.supportedChains`

The shared `ProviderRegistry` uses this list to short-circuit `listByChain(chainId)` calls (used by the `_discovery` endpoint and future `policy.rank` in card #231). It is **NOT** a substitute for `supportsRoute()` — `supportsRoute` may further reject specific token pairs even on a supported chain.

Be conservative: declare only chains the adapter can actually serve. Adding a chain later is non-breaking; falsely advertising one breaks discovery.

### `metadata.enabled`

- `true` (default) — `registry.listAll()` and `registry.listByChain()` include the adapter.
- `false` — registry skips by default (still selectable via `listAll({ includeDisabled: true })`).

Use `enabled: false` for **registered stubs** (e.g. `UniswapSmartRouterAdapter`, future Trader Joe LP stub) that ship structurally complete but are not yet operational.

---

## 2. Swap port methods — contract

### `supportsRoute(params)`

Lightweight predicate. Should **not** call the upstream API/RPC if it can be answered from local state (chain whitelist, token registry). Returns `false` (never throws) when:

- The provider has no implementation for the chain pair.
- A required external service is misconfigured (e.g. missing API key).
- Tokens involved are unknown.

If you have to call the network, wrap it in a 3s timeout and treat any error as `false`.

### `getQuote(request)`

Returns a `SwapQuote` with **accurate** `estimatedReceiveAmount`, `bridgeFee`, `gasFee`, `exchangeRate`, and `estimatedDuration`. Throw on:

- No liquidity / route → wrap as `SwapError(NO_ROUTE)` or, preferably going forward, `CapabilityError.unsupportedRoute({...})`.
- Rate limit → `CapabilityError.rateLimited({ capability: 'swap', provider: this.name })`.
- Timeout / upstream 5xx → `CapabilityError.providerFailure({ capability: 'swap', provider: this.name, message, cause })`.

### `prepareSwap(request)`

Builds the `Transaction[]` the user signs client-side. Approvals come first if needed (Permit2 or ERC-20). Each transaction includes a human-readable `action` field for UX (`"Approve USDC"`, `"Swap USDC → ETH"`).

State-mutating call → callers attach `x-idempotency-key`; the controller layer is responsible for caching (not the adapter).

### `monitorTransaction(txHash, chainId)`

Polls RPC (on-chain txs) or the provider's order API (UniswapX, etc.). Returns one of `PENDING | CONFIRMED | COMPLETED | FAILED`. Idempotent; safe to retry.

---

## 3. Error handling — what to throw

Going forward we **prefer `CapabilityError`** from `@panorama/capability` over the legacy `SwapError` taxonomy. The FE pattern-matches on `error.category` (not `error.code`), so picking the right category is what matters:

| Situation | Category | Factory |
|---|---|---|
| Bad input (slippage > 50%, malformed address) | `VALIDATION` | `CapabilityError.validation({ capability: 'swap', message, errors })` |
| No provider supports this route (router-level) | `UNSUPPORTED_ROUTE` | `CapabilityError.unsupportedRoute({ capability: 'swap', chainId, attempted, fromAsset, toAsset })` |
| Pool depth too low / no route on this provider | `INSUFFICIENT_LIQUIDITY` | `new CapabilityError({ code: 'CAPABILITY_SWAP_INSUFFICIENT_LIQUIDITY', category: INSUFFICIENT_LIQUIDITY, ... })` |
| Upstream HTTP 5xx / timeout | `PROVIDER_FAILURE` | `CapabilityError.providerFailure({...})` |
| Upstream rate limit | `RATE_LIMITED` | `CapabilityError.rateLimited({...})` |
| All providers exhausted | `UNAVAILABLE` | `CapabilityError.allProvidersFailed({ capability: 'swap', attempts })` |
| Bug we want pageable | `INTERNAL` | `CapabilityError.internal(message, cause)` |

Existing `SwapError` paths keep working — they will be migrated incrementally (card #231/#233 surface).

---

## 4. Registering a new adapter

1. Create `src/infrastructure/adapters/<provider>.swap.adapter.ts` implementing `ISwapProvider` (see §1).
2. Open `src/infrastructure/di/container.ts` and call `registry.register(new <Provider>SwapAdapter(...))` next to the existing four.
3. Add unit tests (mock external HTTP, no real RPC) at `src/infrastructure/adapters/__tests__/<provider>.swap.adapter.test.ts`.
4. Add an integration test forking mainnet (`BASE_RPC_URL=... npm test`) when the adapter talks to real on-chain contracts. **No Solidity mocks** (project rule `feedback_no_mocks`).
5. Update `swap-priority.policy.json` (card #231) to position the new provider in the chain priority list.
6. Update `metadata.supportedChains` honestly — the `_discovery` endpoint advertises this to the FE.

---

## 5. Backward compatibility (during sprint)

The legacy `/api/swap/*` namespace continues to serve responses with `Deprecation: true` + `Sunset: <date>` headers until the capability namespace is fully migrated (card #232). Adapters do not need to know about routes — they get a `SwapRequest` either way.

---

## 6. Health checks

Optional but recommended. `ProviderHealthTracker` (`@panorama/capability`) polls `healthCheck()` every 30s. A provider returning unhealthy 3 consecutive times is filtered out of `listByChain()` by default. The probe **must** be lightweight (< 5s, < 1 KB outbound).

Lido pattern (`lido-service/src/infrastructure/adapters/lido.provider.adapter.ts`) is a good reference: probes the cheapest available read endpoint and treats any error as unhealthy.

---

## 7. References

- **Port:** `src/domain/ports/swap.provider.port.ts`
- **Shared base:** `@panorama/capability/provider.types.ts` (`ICapabilityProvider`, `ProviderMetadata`)
- **Registry:** `@panorama/capability/registry.ts` (`ProviderRegistry<ISwapProvider>`)
- **Errors:** `@panorama/capability/errors.ts` (`CapabilityError`, `ErrorCategory`)
- **ADR 002:** Capability + Provider abstraction (`execution-layer/docs/adr/002-...`)
- **ADR 004:** Layer dependency rules (`execution-layer/docs/adr/004-...`)
- **Sprint context:** `SPRINT_KICKOFF.md` §3 + §4, `SPRINT_RIZZI.md` Bloco 1
