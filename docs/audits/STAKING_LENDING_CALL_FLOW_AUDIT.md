# Staking + Lending v1 — Call Flow & Unit Audit (Repo-Grounded)

Date: 2026-02-10  
Scope: **Telegram MiniApp + Web** (Thirdweb WaaS) + backend services in `panorama-block-backend/*`  

This document is a **source-of-truth mapping** of:
- which UI action calls which backend route(s),
- what **amount unit** each route expects (`token` vs `wei`),
- what auth/address is used,
- and where the current foot-guns are.

---

## 1) Identity + Address Source (critical)

In the MiniApp we effectively have two identity signals:

1) **Thirdweb active account** (wallet that can sign txs): `useActiveAccount()`  
2) **JWT session** (Panorama auth): `localStorage.authToken` (payload `sub`/`address`)

### Current rule (recommended to keep)

- For **reads** (positions): use `effectiveAddress = account.address || jwtAddress`.
- For **writes** (tx execution): you must have a connected `account` and **block** if:
  - `jwtAddress` exists AND `account.address !== jwtAddress` (mismatch).

Frontend reference:
- `telegram/apps/miniapp/src/components/Staking.tsx`
- `telegram/apps/miniapp/src/features/lending/api.ts`

Why: if we sign txs from a wallet that isn’t the authenticated session wallet, the UI becomes untrustworthy (wrong positions, wrong exits, wrong support debugging).

---

## 2) Liquid Staking (Ethereum Mainnet, Lido) — Flows

### 2.1 Stake via Protocol (Lido mint)

**User intent:** “Stake ETH and receive stETH (mint).”

Frontend:
- UI: `telegram/apps/miniapp/src/components/Staking.tsx` → `handleStake()` with `stakeMethod="mint"`
- API client: `telegram/apps/miniapp/src/features/staking/api.ts` → `stake(amountHuman)`
- Execution: `stakingApi.executeTransaction(transactionData)`

Backend:
- `POST /api/lido/stake` (lido-service)

Amount unit:
- Frontend → backend: **`token`** (human decimal string, ETH units)

Notes:
- The backend returns `transactionData` (to/data/value/gas) for the wallet to send.
- UI should show “You get ~ stETH” as approximate 1:1 at submission time (not a DEX quote).

---

### 2.2 Stake via Market (swap ETH → stETH)

**User intent:** “Best price right now (market swap).”

Frontend:
- Quote: `swapApi.quote({ amount: <tokenUnits>, unit: "token" })`
- Prepare: `swapApi.prepare({ amount: <weiString> })`
- Execution: executes returned tx bundle sequentially (approval + swap)

Backend:
- `POST /swap/quote` (liquid-swap-service)
- `POST /swap/tx` (liquid-swap-service)

Amount unit:
- Quote: **`token`** (human string) + `unit: "token"`
- Prepare: **`wei`** string (bigint integer string)

Notes:
- This path can require **2 txs**: `ERC20 approve` then `swap`.
- Gas checks must account for:
  - ETH value sent (for native swaps), and
  - gas for every tx in the bundle (approval + swap).

---

### 2.3 Unstake via Protocol (Lido withdrawal queue)

**User intent:** “Withdraw via Lido queue (slower, avoids market slippage).”

Frontend:
- UI: `telegram/apps/miniapp/src/components/Staking.tsx` → `handleUnstake()` with `unstakeMethod="queue"`
- API client: `telegram/apps/miniapp/src/features/staking/api.ts` → `unstake(amountHuman)`
- Execution: `stakingApi.executeTransaction(transactionData)`

Backend:
- `POST /api/lido/unstake` (lido-service)

Amount unit:
- Frontend → backend: **`token`** (human decimal string, stETH units)

Notes:
- Lido unstake commonly involves an **approval** step if allowance is missing.
  - Current UI attempts follow-up automatically: approval tx → poll → withdrawal request tx.
  - UX must explain “2 steps” clearly to avoid “tx succeeded but UI failed” confusion.

---

### 2.4 Unstake via Market (swap stETH → ETH)

**User intent:** “Exit instantly (market swap).”

Frontend:
- Quote: `POST /swap/quote` with `unit:"token"` and `amount` in token units
- Prepare: `POST /swap/tx` with `amount` in wei string
- Execute tx bundle sequentially

Backend:
- liquid-swap-service `/swap/*`

Amount unit:
- Quote: **token units** + `unit:"token"`
- Prepare: **wei**

---

### 2.5 Claim finalized withdrawals

Frontend:
- `telegram/apps/miniapp/src/components/Staking.tsx` → `handleClaimAll()`

Backend:
- `POST /api/lido/withdrawals/claim`

Amount unit:
- request IDs only (no amount)

---

## 3) Liquid Swap Service — Contract (unit rules)

Backend code references:
- Request validation: `panorama-block-backend/liquid-swap-service/src/domain/validation/swap.schemas.ts`
- Quote conversion: `panorama-block-backend/liquid-swap-service/src/application/usecases/get.quote.usecase.ts`
- Prepare endpoint: `panorama-block-backend/liquid-swap-service/src/infrastructure/http/controllers/swap.controller.ts`

### 3.1 `/swap/quote`

- `amount` can be:
  - `unit:"token"` (default): human decimal string, e.g. `"0.015"`
  - `unit:"wei"`: integer string, e.g. `"15000000000000000"`
- **Callers must send `unit` explicitly** to prevent double conversion.
- Back-compat guardrail: if `unit` is omitted, backend infers:
  - decimal string → `token`
  - long integer (likely wei) → `wei`
  This protects the platform from the most common regression (wei passed as token).

### 3.2 `/swap/tx`

- `amount` must be **wei integer string**.

---

## 4) Lending (Avalanche, Benqi) — Flows

### 4.1 Read markets / tokens

Backend:
- `GET /benqi/qtokens` (lending-service)

Current response shape:
- `{ data: { qTokens: [{ symbol, address, underlying }...] } }`

Implication:
- The MiniApp lending module must treat these as **markets**, not generic “tokens from /dex/tokens”.

---

### 4.2 Read user positions

Backend:
- `GET /benqi/account/:address/info` (lending-service)

Current response shape (high level):
- `liquidity` (liquidity/shortfall, `isHealthy`)
- `assetsIn` (qTokens entered)
- `qTokenBalances[]` (qToken + underlyingBalance)
- `borrowBalances[]` (borrowBalance)

Important caveat:
- `summary.totalSupplied` currently sums across different assets (not meaningful without a price oracle normalization).
- For v1 UX, prefer **per-asset** display and a simple health label.

---

### 4.3 Exit flows (Withdraw / Repay)

Backend:
- Direct Benqi tx planners: `POST /benqi/redeem`, `POST /benqi/repay`
- “Validated” flows (multi-tx): `POST /benqi-validation/*`

Amount unit:
- **wei integer string** (backend enforces `/^\\d+$/`)

Frontend references:
- Client: `telegram/apps/miniapp/src/features/lending/api.ts` (`toWei()` uses BigInt parser)
- UI: `telegram/apps/miniapp/src/components/Lending.tsx` (needs completion; currently placeholders exist)

---

## 5) Foot-guns discovered (must address)

1) **Quote caching in liquid-swap-service** ✅ fixed
   - Product requirement: **no quote caching** (no Redis, no in-memory quote maps, no localStorage).
   - Implemented: quote caching is **disabled by default** in:
     - `uniswap.tradingapi.adapter.ts` (in-memory quote cache)
     - `cache.adapter.ts` (Redis quote cache, if adopted later)
   - Optional override: set `ENABLE_QUOTE_CACHE=true` to enable caching explicitly.

2) **Benqi read contract is not UI-friendly yet**
   - `/benqi/qtokens` + `/account/:address/info` is composable but forces client-side normalization.
   - Recommend: add a normalized `GET /benqi/markets` and/or `GET /benqi/account/:address/positions` returning a stable FE-ready payload.

3) **Tx result parsing is brittle**
   - Current execution wrappers often assume `tx.transactionHash` exists.
   - Some Thirdweb account types return different shapes (`hash`, nested receipts, etc).
   - Fix: central `extractTxHash()` + “submitted/pending/confirmed” tracker to avoid “tx executed but UI shows failure”.
