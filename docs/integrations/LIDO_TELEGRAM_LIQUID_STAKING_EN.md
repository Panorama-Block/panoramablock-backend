# PanoramaBlock — Lido Service + Telegram MiniApp (Liquid Staking)
Project analysis, architecture, integrations, data model, and delivery plan.

> Main scope: understand how `lido-service` works today, how it integrates with the Telegram MiniApp frontend, and how to support **stake/unstake/positions/tx/info** with **two exit modes**:
> 1) **Instant via Swap** (stETH → ETH)  
> 2) **Native Withdrawal Queue** (approve → request → wait → claim).

---

## 1) Monorepo map

### Backend (`panorama-block-backend/`)
- `auth-service`: centralized auth (SIWE/thirdweb), JWT issuance/validation, Redis sessions.
- `liquid-swap-service`: non-custodial swap (quote/tx bundle/status/history) via Uniswap Trading API / (optional) Smart Router / thirdweb.
- `lido-service`: Lido staking on Ethereum (stake, withdrawal queue, position, info, tracking/persistence).
- Other services: `bridge-service`, `dca-service`, `lending-service`, `wallet-tracker-service`, etc.

### Telegram (`telegram/`)
- `apps/miniapp`: Next.js (basePath `/miniapp`) with staking, swap, chat, portfolio pages, etc.
- `apps/gateway`: Fastify + grammy; proxy for `/miniapp/*` and `/swap/*`.

> Backend architecture reference (auth/swap) is documented in `panorama-block-backend/DOCUMENTACAO.md` (Portuguese).

---

## 2) Authentication (ecosystem standard)

The project standard is **centralized JWT auth** via `auth-service`:
1. `POST /auth/login` → generates SIWE payload.
2. Client signs the message.
3. `POST /auth/verify` → returns JWT (`token`) + refresh cookie.
4. Other services (swap/lido/…) validate the JWT by calling `POST /auth/validate`.

In `lido-service`, routes that **prepare transactions** require:
- `Authorization: Bearer <token>`
- and `userAddress` in the request body must match the JWT address (anti-impersonation).

Key files:
- `panorama-block-backend/auth-service/src/routes/auth.ts`
- `panorama-block-backend/lido-service/src/infrastructure/http/middleware/auth.ts`

---

## 3) Lido Service (backend) — how it works

### 3.1 Responsibility
`lido-service` is **non-custodial**:
- It **prepares** `transactionData` (to/data/value/gasLimit/chainId) for the client to sign and send.
- ✅ **Decision:** there is no `privateKey` execution path in the backend (removed). The flow is 100% non-custodial.

### 3.2 On-chain contracts (Ethereum Mainnet)
The repository (`LidoRepository`) uses `ethers` to interact with:
- `stETH` (Lido): `submit(referral)` for stake.
- `wstETH`: `balanceOf` and `getStETHByWstETH` to convert wstETH → “stETH equivalent”.
- `WithdrawalQueue`:
  - `requestWithdrawals([amount], owner)` to enter the withdrawal queue
  - `getWithdrawalRequests(owner)` / `getWithdrawalStatus(ids)` to list status
  - `findCheckpointHints(ids, from, to)` + `claimWithdrawals(ids, hints)` to claim.

Key files:
- `panorama-block-backend/lido-service/src/infrastructure/config/lidoContracts.ts`
- `panorama-block-backend/lido-service/src/infrastructure/repositories/LidoRepository.ts`

### 3.3 Main endpoints
- `POST /api/lido/stake` (JWT + body.userAddress) → prepares stake ETH→stETH
- `POST /api/lido/unstake` (JWT + body.userAddress) → prepares “withdrawal request” (stETH→WithdrawalQueue)
  - may require **2 steps**: `unstake_approval` → then `unstake`
- `GET /api/lido/position/:userAddress` → reads on-chain and returns position (standardized as **wei strings**)
- `GET /api/lido/protocol/info` → protocol info (e.g. total staked as **wei string**)
- `GET /api/lido/history/:userAddress?limit=...` → persisted history (if DB configured)
- `GET /api/lido/portfolio/:userAddress?days=30` → persisted snapshot (assets + daily metrics)
- `GET /api/lido/withdrawals/:userAddress` → lists withdrawal requests + status
- `POST /api/lido/withdrawals/claim` (JWT + body.userAddress) → prepares claim for finalized withdrawals
- `POST /api/lido/transaction/submit` (JWT + body.userAddress) → stores `txHash` for history/status
- `GET /api/lido/transaction/:hash` → checks receipt and updates status (when persistence is enabled)

> Units (important):
> - **Inputs** (`stake/unstake`): decimal string in ETH/stETH (e.g. `"0.05"`).
> - **Outputs** (`position/protocol/history`): monetary values are returned as **wei strings** (standard).

---

## 4) “Unstake”: the two modes (as requested)

### Mode 1 — Instant via Swap (stETH → ETH)
Instant “unstake” is **not a protocol withdrawal** — it’s a **market swap**:
- User sells `stETH` and receives `ETH` immediately.
- Pros: fast (near instant), simple UX.
- Cons: slippage, fees, price may not be 1:1.

How it fits your system:
- Reuses the **existing Swap flow** (same non-custodial philosophy, same UX, same swap history).
- On the staking page, there is a CTA that opens `/swap` with prefilled stETH→ETH on Ethereum.

Key files:
- `telegram/apps/miniapp/src/app/staking/page.tsx` (CTA “Instant Unstake via Swap”)
- `telegram/apps/miniapp/src/app/swap/page.tsx` (querystring prefill)
- `telegram/apps/miniapp/src/features/swap/*` (quote/tx)

### Mode 2 — Native Withdrawal Queue (approve → request → wait → claim)
Here the user performs a native Lido withdrawal via the Withdrawal Queue:
1. (if needed) **Approve** `stETH` to the WithdrawalQueue
2. **Request** `requestWithdrawals([amount], owner)`
3. Wait until finalized (time varies, depends on the queue/protocol)
4. **Claim** `claimWithdrawals(ids, hints)` when `isFinalized=true`

Pros:
- No dependency on market liquidity (no slippage)
- The “native” protocol flow

Cons:
- Not instant (there is waiting)
- Requires `stETH` (if user has `wstETH`, they must unwrap or swap first)

---

## 5) Persistence (DB) — positions, txs, history, withdrawals

### 5.1 Why persist?
Without a DB you can still:
- fetch position and protocol info (on-chain / API)

With a DB you additionally get:
- per-user **activity history** (transactions the app prepared/executed)
- **transaction status** tracking
- a foundation for **yield/portfolio** analytics via snapshots (time series)

### 5.2 Current `lido-service` schema
File: `panorama-block-backend/lido-service/schema.sql`

Tables:
- `lido_users`: address ownership.
- `lido_positions_current`: latest known position (stETH/wstETH/total/apy/block).
- `lido_position_snapshots`: time-series snapshots (analytics).
- `lido_transactions`: prepared transactions (includes `tx_data`) + `tx_hash` after client submits.
- `lido_withdrawal_requests`: withdrawal queue requests + status.
- `lido_portfolio_assets`: current assets (stETH + wstETH) per user.
- `lido_portfolio_metrics_daily`: daily metrics (time series) per user.
- `lido_user_links`: optional (wallet ↔ telegram user / tenant), if you want unified identity.

Bootstrap:
- `panorama-block-backend/lido-service/src/infrastructure/database/database.service.ts` initializes `schema.sql` when `DATABASE_URL` is set.

> Existing DB: we will use the **same Postgres**, isolating Lido tables in a dedicated schema via `LIDO_DB_SCHEMA` (default: `lido`).

### 5.3 “Complex tables” (yield/portfolio/user info) — baseline implemented
To support **portfolio** without mocks, we added a simple baseline (extensible):
- `lido_portfolio_assets`:
  - `(address, chain_id, token_symbol, token_address, balance_wei, updated_at)`
- `lido_portfolio_metrics_daily`:
  - `(address, chain_id, date, steth_balance_wei, wsteth_balance_wei, total_staked_wei, apy_bps, updated_at)`
- `lido_user_links` (optional):
  - `(address, telegram_user_id, tenant_id, metadata, created_at, updated_at)`

> Note: Lido “rewards” are not a classic claim; stETH is rebasing and the position increases over time. To compute yield you need to account for deposits/withdrawals and compare snapshots.

---

## 6) Telegram MiniApp — where to display and how to integrate

### 6.1 Relevant pages
- Liquid Staking: `telegram/apps/miniapp/src/app/staking/page.tsx`
- Swap: `telegram/apps/miniapp/src/app/swap/page.tsx`

### 6.2 Staking API client
File: `telegram/apps/miniapp/src/features/staking/api.ts`
- `getTokens()`
- `getUserPosition()`
- `stake(amount)`
- `unstake(amount)`
- `getWithdrawals()`
- `claimWithdrawals(requestIds)`
- `getHistory(limit)`
- `getPortfolio(days)`
- `submitTransactionHash(id, txHash)`

### 6.3 Proxy/rewrites to the backend
File: `telegram/apps/miniapp/next.config.ts`
- Rewrites `/api/staking/*` to `NEXT_PUBLIC_STAKING_API_URL` (or `VITE_STAKING_API_URL`).

This enables:
- `baseUrl = '/api/staking'` (default) → proxies to the real backend host.

---

## 7) End-to-end flows (what to test)

### 7.1 Stake (ETH → stETH)
1. MiniApp obtains JWT (auth-service).
2. `POST /api/lido/stake` returns `transactionData`.
3. Client signs/sends (smart wallet / MetaMask).
4. Client calls `POST /api/lido/transaction/submit` with `{ id, userAddress, transactionHash }`.
5. `GET /api/lido/history/:address` includes the tx (when DB enabled).

### 7.2 Withdrawal Queue (stETH → request → claim ETH)
1. `POST /api/lido/unstake`
2. If `type=unstake_approval`, execute it; then call `unstake` again.
3. Wait for the request to show up in `GET /api/lido/withdrawals/:address`.
4. When `isFinalized=true`, call `POST /api/lido/withdrawals/claim`.
5. Execute the `withdrawal_claim` tx and `transaction/submit`.

### 7.3 Instant via Swap (stETH → ETH)
1. On `/staking`, click “Instant Unstake via Swap”.
2. `/swap` opens prefilled (chain 1, sell stETH, buy ETH, optional amount).
3. Quote → prepare tx → sign/send.
4. (Optional) unify into a single “portfolio history” later.

---

## 8) Test checklist (scripts + manual)

### Backend (docker-compose)
1. Start stack: `panorama-block-backend/docker-compose.yml`
2. Ensure:
   - `AUTH_SERVICE_URL` configured
   - `ETHEREUM_RPC_URL` valid
   - `DATABASE_URL`/`LIDO_DATABASE_URL` valid (for persistence)
3. Test endpoints:
   - `/api/lido/protocol/info`
   - `/api/lido/position/:address`
   - `stake` / `unstake` (2-step flow)
   - `withdrawals` / `withdrawals/claim`
   - `transaction/submit` / `transaction/:hash`

Useful scripts:
- `panorama-block-backend/lido-service/tests/quick-test.sh`
- `panorama-block-backend/lido-service/tests/test-lido-api.sh`

### Frontend (MiniApp)
1. Ensure `NEXT_PUBLIC_STAKING_API_URL` points to the correct gateway/backend.
2. Open `/miniapp/staking`:
   - position shows (stETH and wstETH)
   - “Request Withdrawal (Lido Queue)” button
   - “Instant Unstake via Swap” button
   - “Withdrawals” section lists queue requests
   - “Activity” section shows history (when DB enabled)

---

## 9) Open questions (to continue step-by-step)

1) **Your “existing DB today”**: where should Lido tables live?
   - the same `engine_postgres` (compose), or
   - another database/cluster already used by PanoramaBlock?

2) **Yield/portfolio UX**: what format do you want inside Telegram?
   - P&L in ETH? USD? both?
   - time windows: 24h/7d/30d/all?
   - do you want historical APR/APY curves, or just summary numbers?

3) **Item 4 (privateKey execution)**: confirm whether:
   - ✅ **Decision:** we removed the `privateKey` execution path from the backend (100% non-custodial flow).
