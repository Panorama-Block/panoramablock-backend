# @panorama/capability — Conventions

This package is the **foundation** consumed by every backend service. The conventions below are intentionally rigid: drift breaks the shared contract and ripples through 6 services. Read this before adding to `shared/capability/` or before consuming it in a service.

For the architectural rationale, see `execution-layer/docs/adr/002-capability-provider-abstraction.md` and `004-layer-dependency-rules.md`.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Capability** | A verb-shaped backend ability. The closed set: `swap`, `lending`, `staking`, `liquidity`, `bridge`, `automation`. Adding one requires an ADR. |
| **Provider** | A concrete implementation of one capability (e.g. `uniswap`, `lido`, `benqi`). String name, lowercase. |
| **Adapter** | Same class as a Provider — "adapter" emphasises the hex architecture role; "provider" emphasises the business role. |
| **Port** | The interface every provider of a capability must implement (`I<Cap>Provider`). |
| **Registry** | Generic container holding providers; answers `listByChain`, `getByName`. |
| **Policy** | Strategy that ranks providers for a given request (priority list per chain). |
| **Facade / Capability Service** | Application-layer service that orchestrates registry + policy + selected provider per request. |
| **Envelope** | `CapabilityRequest<T>` / `CapabilityResponse<T>` — the shape every capability speaks. |

---

## 2. File naming

Inside `shared/capability/` and inside any consumer service:

| Pattern | Example | Where |
|---|---|---|
| `<thing>.types.ts` | `envelope.types.ts`, `provider.types.ts` | shared types/interfaces |
| `<thing>.ts` | `errors.ts`, `registry.ts`, `policy.ts` | runtime modules |
| `<cap>.provider.port.ts` | `swap.provider.port.ts` | port (interface) in a service's `domain/ports/` |
| `<provider>.<cap>.adapter.ts` | `uniswap.swap.adapter.ts`, `lido.provider.adapter.ts` | adapter in `infrastructure/adapters/` |
| `<cap>.capability.service.ts` | `swap.capability.service.ts` | facade in `application/services/` |
| `<thing>.test.ts` | `envelope.types.test.ts` | tests, colocated under `__tests__/` |
| `<resource>.schema.ts` | `provider.schema.ts` | optional runtime validation (Zod) for a `.types.ts` sibling |

---

## 3. TypeScript suffixes (mandatory)

| Suffix | Meaning |
|---|---|
| `Port` | Interface that providers/adapters implement. Example: `ISwapProvider`, `IStakingProvider`. Always prefixed with `I`. |
| `Adapter` | Concrete implementation of a port. Example: `UniswapSwapAdapter`, `LidoProviderAdapter`. |
| `Service` | Application layer orchestrator. Example: `SwapCapabilityService`, `ProviderSelectorService`. |
| `Repository` | Domain persistence interface (not provider-related). |
| `UseCase` | Single-purpose application script. |

---

## 4. HTTP endpoint pattern

```
/v1/capability/<capability-slug>/<action>
```

- **`<capability-slug>`** = lowercase kebab-case from the closed set (`swap`, `lending`, `staking`, `liquidity`, `bridge`, `automation`).
- **`<action>`** = kebab-case verb or noun (`quote`, `prepare-stake`, `position/:address`, `_discovery`).
- Special endpoints prefixed with `_` (underscore) are introspective: `_discovery`, `_health`. Reserved.

Examples:

| Capability | Endpoint |
|---|---|
| swap | `POST /v1/capability/swap/quote` |
| swap | `POST /v1/capability/swap/prepare` |
| lending | `GET /v1/capability/lending/pools/:chainId` |
| lending | `POST /v1/capability/lending/prepare-supply` |
| staking | `GET /v1/capability/staking/position/:address` |
| any | `GET /v1/capability/_discovery` |

**Backward compatibility:** old per-service routes (e.g. `/api/swap/*`, `/api/lending/benqi/*`) continue to serve with a `Deprecation: true` + `Sunset: <date>` header for one release after the capability namespace is live. Then they're removed in a cleanup PR.

---

## 5. Provider naming

Provider name = lowercase, ASCII, no spaces. One token where possible.

| ✅ Good | ❌ Bad |
|---|---|
| `uniswap` | `Uniswap`, `Uni Swap` |
| `uniswap-trading-api` | `uniswapTradingAPI` |
| `lido` | `lido-finance` (redundant) |
| `traderjoe` | `trader-joe` (split decision: stay one-word to match how the protocol brands itself) |
| `aave` | `Aave V3` (versioning goes in `metadata.version`, not the name) |

Mapping protocol → provider names lives in each service's `infrastructure/di/container.ts`.

---

## 6. Error code pattern

```
CAPABILITY_<CAP>_<TYPE>
```

- `<CAP>` = uppercase capability slug.
- `<TYPE>` = uppercase, snake_case-like, describes the failure category for FE/agents.

Examples:

| Code | Meaning |
|---|---|
| `CAPABILITY_SWAP_NO_LIQUIDITY` | No pool depth for the requested swap |
| `CAPABILITY_SWAP_UNSUPPORTED_ROUTE` | No provider supports `from→to` on this chain |
| `CAPABILITY_LENDING_INSUFFICIENT_COLLATERAL` | Borrow would exceed health factor |
| `CAPABILITY_STAKING_AMOUNT_TOO_SMALL` | Below protocol minimum |
| `CAPABILITY_BRIDGE_DESTINATION_UNAVAILABLE` | Source chain OK, dest chain unreachable |
| `CAPABILITY_AUTOMATION_INVALID_SCHEDULE` | Cron expression invalid |
| `CAPABILITY_AUTH_CHALLENGE_EXPIRED` | Nonce older than TTL |

**Always** throw a `CapabilityError` with a code in this format. Never `throw new Error(string)` in capability code paths — codes are the API the FE pattern-matches on.

---

## 7. Imports — what's allowed

Every file in `shared/capability/`:

✅ Imports allowed:
- Standard lib / built-in Node
- Whitelisted external libs: `zod` (optional, for runtime schemas)
- Other modules **within** `shared/capability/`

❌ Imports forbidden:
- Anything under `backend/<service>/*` (cross-service or service-to-foundation invert)
- Anything under `execution-layer/*`
- Heavy frameworks (no Express, no Fastify, no Nest — `shared/capability` must stay framework-agnostic)

Service consumers import from `shared/capability/` via path mapping in their `tsconfig.json`:

```jsonc
// in <service>/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@panorama/capability": ["../shared/capability/index.ts"],
      "@panorama/capability/*": ["../shared/capability/*"]
    }
  }
}
```

The first card that consumes `shared/capability/` from a service is responsible for adding the paths block to that service's tsconfig.

---

## 8. Testing

- **Unit tests** colocated in `__tests__/<file>.test.ts` (same dir, suffixed).
- **Vitest** as the runner. No Jest in this package.
- **No mocking of `shared/capability/`** from inside `shared/capability/`. If something is hard to test without mocking, the design needs refactor.
- **Conformance helpers** for cross-service reuse are exported (e.g. `__tests__/registry.conformance.ts` from card #210) — they are documented as part of the public API of the package.

Run: `npm test` (from `shared/capability/`) or `npm run test:watch`.

---

## 9. Versioning

This package is `0.x` while the sprint is in flight. After the sprint review (semana 4), promote to `1.0.0` with a CHANGELOG entry summarising the locked API surface.

Inside `0.x`, breaking changes are allowed but must be announced in `#panorama-dev` with a 24h heads-up.

---

## 10. When in doubt

- If a type is needed by 2+ services → it goes in `shared/capability/`.
- If a class has runtime logic and 2+ services need it → it goes in `shared/capability/`.
- If only 1 service uses it → it stays in that service.
- If a rule isn't covered here → ask the foundation owner (Hugo) before adding; the alternative is silent drift across services.

---

## See also

- ADR 002 — Capability + Provider abstraction (`execution-layer/docs/adr/002-...`)
- ADR 003 — Lane and feature taxonomy
- ADR 004 — Layer dependency rules
- `SPRINT_KICKOFF.md` § 3 (capability pattern in 5 layers)
