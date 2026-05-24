# Liquidity Capability — Interface Contract

> **Cards #250 + #251 + #252.** Liquidity (AMM LP) capability service.
> **Audience:** anyone adding an LP provider (Aerodrome on Base, Trader Joe LB on Avax, future Uniswap V4 LP).

This service implements the **liquidity** capability under the shared Capability + Provider pattern (see `@panorama/capability/CONVENTIONS.md` and `execution-layer/docs/adr/002-capability-provider-abstraction.md`).

Concrete LP implementations live in `src/infrastructure/adapters/` and implement `ILiquidityProvider` from `src/domain/ports/liquidity.provider.port.ts`.

---

## 1. What this service is — and is not

✅ **Owns:**

- Provider-agnostic LP discovery (`getPools`) and read endpoints (`getPosition`, `getApr`)
- Transaction preparation for add/remove/claim (`prepareAdd`, `prepareRemove`, `prepareClaim`)
- HTTP namespace `/v1/capability/liquidity/*`
- Health-aware provider selection via `ProviderRegistry<ILiquidityProvider>` + policy

❌ **Does not own:**

- Swap routing → that's `liquid-swap-service` (capability `swap`)
- Staking single-token positions → that's `lido-service` (capability `staking`)
- Cross-chain bridging → that's `bridge-service` (capability `bridge`)
- DCA automation → that's `dca-service` (capability `automation`)
- Token registries → consumed read-only from `@panorama/capability/chains`

A pool that is **also** a Uniswap V3 trading venue is registered with the **liquidity** capability for `prepareAdd/prepareRemove/prepareClaim` and with the **swap** capability (in `liquid-swap-service`) for `quote/prepare-swap`. Two registrations, two adapters, one underlying protocol.

---

## 2. What an `ILiquidityProvider` must declare

```typescript
import type { ProviderMetadata } from '@panorama/capability';
import {
  ILiquidityProvider,
  PrepareAddInput,
  PrepareRemoveInput,
  PrepareClaimInput,
} from '../../domain/ports/liquidity.provider.port';
import type { Pool, LpPosition, GetPoolsFilter } from '../../domain/entities/pool';

export class MyLpAdapter implements ILiquidityProvider {
  public readonly name = 'my-lp';                                   // matches metadata.name
  public readonly metadata: ProviderMetadata = {
    name: 'my-lp',
    capability: 'liquidity',
    supportedChains: [8453],                                         // chains the provider can serve
    features: ['volatile', 'stable', 'gauge-rewards'],
    version: '1.0.0',
    enabled: true,                                                   // false → registry skips by default
  };

  async healthCheck() { /* optional — polled every 30s if ProviderHealthTracker is attached */ }

  async supportsRoute(params): Promise<boolean> { /* ... */ }
  async getPools(filter: GetPoolsFilter): Promise<Pool[]> { /* ... */ }
  async getPosition(addr, poolId): Promise<LpPosition | null> { /* ... */ }
  async prepareAdd(input: PrepareAddInput): Promise<Transaction[]> { /* ... */ }
  async prepareRemove(input: PrepareRemoveInput): Promise<Transaction[]> { /* ... */ }
  async prepareClaim(input: PrepareClaimInput): Promise<Transaction[]> { /* ... */ }
  async getApr(poolId, chainId): Promise<number | null> { /* ... */ }
}
```

### `metadata.supportedChains`

The shared `ProviderRegistry` uses this list to short-circuit `listByChain(chainId)` calls (used by `_discovery` and `policy.rank`). It is **NOT** a substitute for `supportsRoute()` — `supportsRoute` may further reject unknown pools or asset pairs even on a supported chain.

Be conservative: declare only chains the adapter can actually serve. Adding a chain later is non-breaking.

### `metadata.enabled`

- `true` (default) — `registry.listAll()` and `registry.listByChain()` include the adapter.
- `false` — registry skips by default (use `listAll({ includeDisabled: true })` to opt in).

Stubs (card #254 — Trader Joe LB) ship with `enabled: false` until they have a real implementation.

---

## 3. Port methods — contract

### `supportsRoute(params)`

Lightweight predicate (no network calls unless absolutely necessary). Returns `false` (never throws) when the provider cannot serve the chain / pool / asset pair. Wrap any network probe in a 3 s timeout and treat any error as `false`.

### `getPools(filter)`

Returns pools considered active on `filter.chainId`. Pagination is provider-defined via `filter.cursor` / `filter.limit`. The `Pool.id` is opaque to consumers — for Aerodrome it is the pool contract address; for concentrated-liquidity providers it can be a composite key.

### `getPosition(userAddress, poolId)`

Returns the user's `LpPosition` or `null` when the user has never deposited. Should be cheap — caller may poll. Implementations should cache aggressively at adapter level (e.g. 30s TTL on RPC reads).

### `getApr(poolId, chainId)`

Combined trading-fee + reward-emissions APR. Returns `null` when the provider cannot compute it cheaply. Aerodrome adapter (card #253) returns gauge-rewards APR + 0% trading fee placeholder until subgraph integration lands.

### `prepareAdd / prepareRemove / prepareClaim`

Each returns a `Transaction[]` ready for client-side signature. Multi-step bundles include approvals and optional gauge stake/unstake. The user's wallet signs each in order. **No on-chain mutation happens server-side.**

State-mutating endpoints accept `x-idempotency-key` header — controller forwards it on the envelope; adapter is responsible for the cache when needed (most LP prepare flows are pure functions of `(chain, pool, amounts, slippage)` so idempotency is naturally satisfied).

---

## 4. Error handling — what to throw

Use `CapabilityError` from `@panorama/capability`. The FE pattern-matches on `error.category` (not `error.code`):

| Situation | Category | Factory |
|---|---|---|
| Bad input (malformed pool id, negative amounts, slippage > 100%) | `VALIDATION` | `CapabilityError.validation({ capability: 'liquidity', message, errors })` |
| Provider doesn't support the chain / pool | `UNSUPPORTED_ROUTE` | `CapabilityError.unsupportedRoute({ capability: 'liquidity', chainId, attempted })` |
| Pool drained / single-side deposit limits exceeded | `INSUFFICIENT_LIQUIDITY` | `new CapabilityError({ code: 'CAPABILITY_LIQUIDITY_INSUFFICIENT_DEPTH', category: INSUFFICIENT_LIQUIDITY, ... })` |
| Upstream RPC 5xx / timeout | `PROVIDER_FAILURE` | `CapabilityError.providerFailure({ capability: 'liquidity', provider: this.name, ... })` |
| Upstream rate limit | `RATE_LIMITED` | `CapabilityError.rateLimited({ capability: 'liquidity', provider: this.name })` |
| All providers exhausted | `UNAVAILABLE` | `CapabilityError.allProvidersFailed({ capability: 'liquidity', attempts })` |
| Bug we want pageable | `INTERNAL` | `CapabilityError.internal(message, cause)` |

---

## 5. Endpoints (card #252)

```
GET  /v1/capability/liquidity/_discovery
GET  /v1/capability/liquidity/pools?chainId=<id>[&type=<type>][&asset=<addr>][&limit=N][&cursor=...]
GET  /v1/capability/liquidity/position/:address/:poolId?chainId=<id>
GET  /v1/capability/liquidity/apr/:poolId?chainId=<id>
POST /v1/capability/liquidity/prepare-add        body: { userAddress, chainId, poolId, amounts:[a0,a1], stake?, slippageBps? }
POST /v1/capability/liquidity/prepare-remove     body: { userAddress, chainId, poolId, lpAmountWei, slippageBps?, unstakeFirst? }
POST /v1/capability/liquidity/prepare-claim      body: { userAddress, chainId, poolId, rewardAssets? }
```

All POST bodies are validated with Zod in the controller; malformed bodies → 400 `VALIDATION`.

Headers (per CONVENTIONS.md §4 + envelope):

| Header | Required for | Meaning |
|---|---|---|
| `x-tenant-id` | All | Multi-tenancy key. Defaults to `userAddress` lowercased if absent. |
| `x-trace-id` | All | Propagated trace id. Auto-generated UUID if absent. |
| `x-chain-id` | GETs without explicit `?chainId` | Per-request chain override. |
| `x-idempotency-key` | POSTs (state-mutating) | Hash(key + body) → cached response. |

---

## 6. Registering a new adapter

1. Create `src/infrastructure/adapters/<provider>-lp.provider.adapter.ts` implementing `ILiquidityProvider` (see §2).
2. Pass it to `buildLiquidityContainer({ providers: [...] })` from `src/infrastructure/di/container.ts`, or register directly via `registry.register(...)`.
3. Add unit tests at `src/infrastructure/adapters/__tests__/<provider>-lp.adapter.test.ts`.
4. Add integration tests forking mainnet (`BASE_RPC_URL=... npm test`) when the adapter talks to on-chain contracts. **No Solidity mocks** (project rule `feedback_no_mocks`).
5. Update the policy (`buildLiquidityContainer` `policy` option) to position the new provider in the per-chain priority list.

---

## 7. Health checks

Optional but recommended. Pattern: probe the cheapest available read endpoint (e.g. `router.factory()` view call) and treat any error as unhealthy. `ProviderHealthTracker` (`@panorama/capability`) — not wired in this scaffold but supported — polls every 30 s and marks unhealthy after 3 consecutive failures, filtering the provider from `registry.listByChain()` by default.

Reference: `lido-service/src/infrastructure/adapters/lido.provider.adapter.ts:62-80`.

---

## 8. Scaffold scope (this PR)

✅ **In scope (#250 + #251 + #252):**

- Service scaffold (package, tsconfig, vitest config)
- Port + entities + facade + controller + routes + DI
- Empty registry — discovery returns `{ capabilities: [...], providers: [] }`
- Smoke tests via supertest (no network)
- Doc (this file)

⏳ **Out of scope (later cards):**

- `AerodromeLpAdapter` → card **#253**
- `TraderJoeLpAdapter` stub (`enabled:false`) → card **#254**
- Conformance suite → card **#255**
- Auth middleware integration (consume `auth-service`) → cross-cut
- Persistence (Postgres) → cross-cut
- `ProviderHealthTracker` wiring → after first real adapter lands

---

## 9. References

- **Port:** `src/domain/ports/liquidity.provider.port.ts`
- **Entities:** `src/domain/entities/pool.ts`
- **Facade:** `src/application/services/liquidity.capability.service.ts`
- **Controller:** `src/infrastructure/http/controllers/liquidity.controller.ts`
- **Routes:** `src/infrastructure/http/routes/liquidity.routes.ts`
- **DI:** `src/infrastructure/di/container.ts`
- **Shared base:** `@panorama/capability` (`ICapabilityProvider`, `ProviderRegistry`, `fallbackInvoke`, `CapabilityError`)
- **ADR 002:** Capability + Provider abstraction (`execution-layer/docs/adr/002-...`)
- **ADR 004:** Layer dependency rules (`execution-layer/docs/adr/004-...`)
- **Lido reference:** `lido-service/` — same pattern, applied to the staking capability.
- **Sprint context:** `SPRINT_KICKOFF.md` §3 + §4, `SPRINT_RIZZI.md` Bloco 2
