# PanoramaBlock Backend — Microservices Overview

## Summary

Set of microservices for authentication, swap, and wallet tracking, with hexagonal architecture applied to the swap service.

Main services:
- `auth-service` (Node + Express): SIWE/thirdweb auth, JWT issuance/validation, Redis sessions.
- `liquid-swap-service` (Node + Express/TS): orchestrates swap providers (Uniswap Trading API, Uniswap Smart Router, thirdweb Bridge), prepares bundles for the client to sign and monitors status.
- `avax-service` (Foundry/Node): Avalanche-specific utilities and routes (auxiliary).

---

## Service Architecture

### auth-service

**Purpose:** authenticate users with EVM wallets (SIWE) via thirdweb, issue JWT, and maintain a Redis refresh session.

**Endpoints:**
- `POST /auth/login` — generates a `payload` (ThirdwebAuth.payload) for the given address. Ref: `auth-service/src/routes/auth.ts:19`.
- `POST /auth/verify` — verifies signature (first with `thirdweb/auth`, fallback ThirdwebAuth.verify) and returns `{ token, address, sessionId }`, saving session to Redis and setting a refresh cookie (configurable). Ref: `auth-service/src/routes/auth.ts:95`.
- `POST /auth/validate` — validates JWT (internal use by other services). Ref: `auth-service/src/routes/auth.ts:140`.
- `POST /auth/logout` — invalidates session in Redis and clears cookie. Ref: `auth-service/src/routes/auth.ts:197`.
- `POST /auth/session/refresh` — re-issues token from refresh cookie, rotates `sessionId`. Ref: `auth-service/src/routes/auth.ts:311`.

**Implementation:**
- ThirdwebAuth + PrivateKeyWallet initialized only when `AUTH_PRIVATE_KEY` is present. Ref: `auth-service/src/utils/thirdwebAuth.ts:1`.
- CORS with origin allowlist, cookies with configurable SameSite/secure and domain (production). Ref: `auth-service/src/index.ts:36`.
- Optional HTTPS with certificates (Let's Encrypt), with fallback log to HTTP. Ref: `auth-service/src/index.ts:15`.

---

### liquid-swap-service

**Purpose:** provide a non-custodial swap API:
- `POST /swap/quote` — fetches quote with selected provider (auto/selective). **Recommended: send `unit`** (`token` or `wei`) to avoid double conversion.
- `POST /swap/tx` — prepares a transaction bundle (approve? + swap) for the client to sign.
- `GET /swap/status/:hash?chainId=...` — monitors status (when supported).
- `GET /swap/history` — history per authenticated user.

**Security:** all `/swap/*` routes require JWT in `Authorization: Bearer ...`. Ref: `liquid-swap-service/src/middleware/authMiddleware.ts:1`.

**Architecture (hexagonal):**
- Domain: entities (`SwapRequest`, `SwapQuote`, `PreparedSwap`), ports (`ISwapProvider`, `IExecutionPort`), domain services (`RouterDomainService`, `SwapDomainService`).
- Application: use cases (`GetQuoteUseCase`, `PrepareSwapUseCase`, `ExecuteSwapUseCase`, `GetSwapStatusUseCase`), provider orchestrator (`ProviderSelectorService`).
- Infrastructure: provider adapters (Uniswap Trading API, Uniswap Smart Router, thirdweb), utility adapters (chain provider, swap repo), HTTP controllers/routes, and middleware.

**Provider selection strategy:**
- Same-chain: priority Uniswap (Trading API V3; Smart Router V2/V3 temporarily disabled due to subgraph issues), fallback Thirdweb. Ref: `liquid-swap-service/src/domain/services/router.domain.service.ts:120`.
- Cross-chain: prefer Thirdweb Bridge, fallback others. Ref: `liquid-swap-service/src/domain/services/router.domain.service.ts:292`.
- `ProviderSelectorService` resolves aliases and allows forcing a provider in `/swap/tx` via the `provider` field. Ref: `liquid-swap-service/src/application/services/provider-selector.service.ts:1`.

**Provider adapters:**
- Uniswap Trading API (`uniswap-trading-api`): integrates the official REST API (`/quote`, `/check_approval`, `/create`), uses `generatePermitAsTransaction` and normalizes approvals (Permit2). Retries/backoff, fee calculation, returns transactions with suggested gasLimit. Ref: `liquid-swap-service/src/infrastructure/adapters/uniswap.tradingapi.adapter.ts:1`.
- Uniswap Smart Router (`uniswap-smart-router`): AlphaRouter (V2/V3), token lookup (registry/on-chain), configurable slippage tolerance (`UNISWAP_SLIPPAGE_BPS`), same-chain only. Ref: `liquid-swap-service/src/infrastructure/adapters/uniswap.smartrouter.adapter.ts:1`.
- Thirdweb Provider (`thirdweb`): wraps `ThirdwebSwapAdapter` and filters transactions to the origin chain (avoids executing destination-chain steps). Integrates Bridge.Sell (`quote`, `prepare`, `status`). Ref: `liquid-swap-service/src/infrastructure/adapters/thirdweb.provider.adapter.ts:1`.

**Use cases:**
- GetQuote: normalizes tokens (`native`), converts `amount` to WEI, enriches USD (thirdweb price service), returns provider used. Ref: `liquid-swap-service/src/application/usecases/get.quote.usecase.ts:1`.
- PrepareSwap: creates `SwapRequest` and calls `prepareSwapWithProvider` (auto/forced). Returns `{ prepared, provider }`. Ref: `liquid-swap-service/src/application/usecases/prepare.swap.usecase.ts:1`.
- ExecuteSwap: disabled in V1 non-custodial (optional via Engine when `ENGINE_ENABLED=true`). Ref: `liquid-swap-service/src/infrastructure/http/controllers/swap.controller.ts:121`.

**HTTP and middleware:**
- Routes: `swap.routes.ts` (quote/tx/execute/history/status). Ref: `liquid-swap-service/src/infrastructure/http/routes/swap.routes.ts:1`.
- Controller: validates required params (includes `smartAccountAddress` in quote) and serializes `bigint` to JSON. Ref: `liquid-swap-service/src/infrastructure/http/controllers/swap.controller.ts:1`.
- Auth middleware: validates JWT with `auth-service` (`/auth/validate`). Ref: `liquid-swap-service/src/middleware/authMiddleware.ts:1`.
- Optional HTTPS (certificates), structured logs, Health/Root info. Ref: `liquid-swap-service/src/index.ts:1`.

---

## API Integrations

### Thirdweb SDK (Bridge)
- `createThirdwebClient` with `THIRDWEB_CLIENT_ID` (+ optional `THIRDWEB_SECRET_KEY`).
- `Bridge.Sell.quote/prepare/status` for cross-chain; `prepare` returns `steps/transactions` with `expiresAt`. Ref: `liquid-swap-service/src/infrastructure/adapters/thirdweb.swap.adapter.ts:1`.
- Transaction filter: only origin-chain transactions are executed by the client; destination-chain steps are effects of the bridge.
- UX note: "exact" approvals may require resubmission; Uniswap prioritizes `MaxUint256` via Trading API.

### Uniswap Trading API
- Endpoints: `/quote`, `/check_approval`, `/create` (gateway `UNISWAP_API_URL`, header `x-api-key`).
- Configurable slippage (`UNISWAP_TRADING_API_SLIPPAGE`), retry/backoff, detailed logs (route/hops, gas estimates). Ref: `uniswap.tradingapi.adapter.ts`.
- Same-chain only; Universal Router (`execute(bytes,bytes[])`).

### Uniswap Smart Router (SDK)
- `AlphaRouter` + `@uniswap/sdk-core`, static `ethers` provider per chain, slippage tolerance in bps (`UNISWAP_SLIPPAGE_BPS`).
- Same-chain only (V2/V3 route), quote and bundle with gas headroom. Ref: `uniswap.smartrouter.adapter.ts`.

---

## Environment Variables

- Common: `NODE_ENV`, `DEBUG`
- Auth: `AUTH_SERVICE_URL` (for JWT validation in the swap service)
- Thirdweb: `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY`
- Uniswap: `UNISWAP_API_KEY`, `UNISWAP_API_URL`, `UNISWAP_TRADING_API_SLIPPAGE`
- Smart Router: `SMART_ROUTER_QUOTE_TIMEOUT_MS`, `SMART_ROUTER_RPC_TIMEOUT_MS`, `UNISWAP_SLIPPAGE_BPS`
- RPCs: `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `AVALANCHE_RPC_URL`, etc.
- Engine (optional): `ENGINE_ENABLED`, `ENGINE_URL`, `ADMIN_WALLET_ADDRESS`

---

## Cross-Repository Interactions

**MiniApp (telegram) → Auth**
- `newchat` calls `POST /auth/login` and `POST /auth/verify` (auth-service) using thirdweb to sign the payload, stores `authToken` in `localStorage`. Ref: `telegram/apps/miniapp/src/app/newchat/page.tsx:114`.

**MiniApp (telegram) → Swap**
- Calls `POST /swap/quote` and `POST /swap/tx` via gateway (proxy) with `Authorization: Bearer <token>`. The backend responds with provider used and transaction bundle. Ref: `telegram/apps/miniapp/src/features/swap/api.ts:173`.

**MiniApp (telegram) → Agents**
- `AgentsClient` talks to `zico_agents/new_zico`, receives response/metadata from `swap_agent` to drive swap field collection. Ref: `telegram/apps/miniapp/src/clients/agentsClient.ts:1`.

**Gateway (telegram)**
- Transparent proxy: `/miniapp/*` (Next) and `/swap/*` (liquid-swap-service). Health checks and TonConnect manifest. Ref: `telegram/apps/gateway/src/server.ts:99`.

---

## UX / Business Model

- Non-custodial: the backend never signs or executes user transactions — it returns transactions/steps for local signing.
- Same-chain defaults to Uniswap for best liquidity; cross-chain defaults to thirdweb (Bridge). The user signs and broadcasts.
- User-facing errors in the MiniApp (title, description, actions) are mapped from swap backend responses.

---

## Quick References

- Auth: `auth-service/src/` (routes and thirdwebAuth util).
- Swap: `liquid-swap-service/src/index.ts:1`, `.../di/container.ts:1`, `.../application/usecases/*.ts`, `.../infrastructure/adapters/*`.
- Supplemental docs: `THIRDWEB_IMPLEMENTATION_ANALYSIS.md`, `UNISWAP_API_AUDIT.md`, `SWAP_INTEGRATION_ROADMAP.md`.
