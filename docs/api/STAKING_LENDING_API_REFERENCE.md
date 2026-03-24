# PanoramaBlock Staking & Lending API Reference

**Version date:** February 19, 2026  
**Scope:** Full `lido-service` + full `lending-service`, plus miniapp integration paths  
**Status:** As implemented in repository code (not a product spec)

## Scope and source of truth

This document is derived from live code in:

- `panorama-block-backend/lido-service/src/*`
- `panorama-block-backend/lending-service/*`
- `telegram/apps/miniapp/src/features/staking/*`
- `telegram/apps/miniapp/src/features/lending/*`
- `telegram/apps/miniapp/next.config.ts`

**As-implemented disclaimer:** behavior here reflects current code paths and middleware. If older markdown files conflict, this reference is authoritative for current implementation.

## Related diagrams

- `panorama-block-backend/diagrams/staking-lending-architecture.mmd`
- `panorama-block-backend/diagrams/staking-flow-sequence.mmd`
- `panorama-block-backend/diagrams/lending-flow-sequence.mmd`

## Service map

| Component | Default Port | Main Route Prefixes | Notes |
|---|---:|---|---|
| auth-service | 3001 | `/auth/*` | JWT issuance/validation (`/auth/login`, `/auth/verify`, `/auth/validate`) |
| liquid-swap-service | 3002 | `/swap/*` | JWT-protected quote/tx planner used by staking market path |
| lido-service | 3004 | `/api/lido/*` | Ethereum mainnet staking planner + position APIs |
| lending-service | 3006 | `/dex/*`, `/benqi/*`, `/benqi-validation/*`, `/validation/*`, `/validation-swap/*` | Avalanche DEX + Benqi + validation contract APIs |
| miniapp (Next.js) | 3000 | `/api/staking/*`, `/api/lending/*`, `/api/swap/*` | Proxy rewrites to backend services |

### Miniapp proxy paths (as implemented)

| Miniapp Path | Proxied To |
|---|---|
| `/api/staking/:path*` | `http://localhost:3004/:path*` |
| `/api/lending/:path*` | `http://localhost:3006/:path*` |
| `/api/swap/:path*` | `http://localhost:3002/swap/:path*` |

## Authentication model

## JWT flow

1. Client requests login payload from auth-service (`POST /auth/login`).
2. Client signs payload with wallet.
3. Client verifies signature (`POST /auth/verify`) and receives JWT.
4. Client sends `Authorization: Bearer <token>` to staking/lending/swap services.

## Service-side enforcement

- **lido-service protected POST routes**
  - Requires valid JWT.
  - Requires `userAddress` in body.
  - Requires body `userAddress` to match JWT wallet address.
- **lido-service optional GET routes**
  - Accept JWT but do not require it.
- **lending-service routes using `verifySignature`**
  - First tries JWT validation via auth-service.
  - Falls back to signature-based auth if JWT is missing/invalid.
  - For account-specific routes, enforces requested address equals authenticated address.
- **liquid-swap-service**
  - `/swap/*` and compatibility aliases are JWT-protected.

## Global conventions

## Chains

- **Staking/Lido:** Ethereum mainnet (`chainId = 1`).
- **Lending/Validation:** Avalanche C-Chain (`chainId = 43114`).

## Amount unit semantics

| API Family | Endpoint Pattern | Amount Unit |
|---|---|---|
| Lido | `POST /api/lido/stake`, `POST /api/lido/unstake` | Wei integer string (frontend sends human input converted to wei) |
| Lending Benqi | `POST /benqi/*` tx-prep routes | Wei integer string |
| Benqi Validation | `POST /benqi-validation/*` | Wei integer string |
| Validation | `POST /validation/calculate`, `POST /validation/payAndValidate`, etc. | Wei integer string |
| Swap quote | `POST /swap/quote` | Token units by default; can pass `unit: "wei"` |
| Swap tx plan | `POST /swap/tx` | Wei integer string |

## Response/error shapes (current)

- **lido-service** mostly returns:
  - success: `{ "success": true, "data": ... }`
  - error: either
    - `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }` (standardized path), or
    - `{ "success": false, "error": "..." }` (controller-local path)
- **lending-service** typically returns:
  - success: `{ "status": 200, "msg": "success", "data": ... }`
  - error: `{ "status": <code>, "msg": "error", "data": { "error": "...", "details": "..." } }`

## Lido API reference (full)

Base URL examples:

- Direct service: `http://localhost:3004`
- Via miniapp proxy: `http://localhost:3000/api/staking`

## Operational endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | Public | Service health + circuit breaker + DB connectivity flags |
| GET | `/` | Public | Service info and endpoint listing |

## Staking routes (`/api/lido/*`)

| Method | Path | Auth | Required Input | Amount Unit | Chain | Response Contract |
|---|---|---|---|---|---:|---|
| POST | `/api/lido/stake` | JWT required | `userAddress`, `amount` | Wei string | 1 | `StakingTransaction` with `transactionData` |
| POST | `/api/lido/unstake` | JWT required | `userAddress`, `amount` | Wei string | 1 | `StakingTransaction`; may be `unstake_approval` with follow-up flag |
| POST | `/api/lido/claim-rewards` | JWT required | `userAddress` | N/A | 1 | Legacy/no-op style tx prep |
| GET | `/api/lido/position/:userAddress` | Optional JWT | `userAddress` path | N/A | 1 | Position or null |
| GET | `/api/lido/history/:userAddress` | Optional JWT | `userAddress` path, optional `limit` | N/A | 1 | Array of staking tx history |
| GET | `/api/lido/portfolio/:userAddress` | Optional JWT | `userAddress` path, optional `days` | N/A | 1 | `{ userAddress, assets, dailyMetrics }` |
| GET | `/api/lido/withdrawals/:userAddress` | Optional JWT | `userAddress` path | N/A | 1 | Withdrawal request list |
| POST | `/api/lido/withdrawals/claim` | JWT required | `userAddress`, `requestIds[]` | N/A | 1 | `withdrawal_claim` tx prep |
| POST | `/api/lido/transaction/submit` | JWT required | `id`, `userAddress`, `transactionHash` | N/A | 1 | Persists tx hash against prepared transaction |
| GET | `/api/lido/transaction/:transactionHash` | Public | `transactionHash` path | N/A | 1 | Current tx status (`pending/completed/failed`) |
| GET | `/api/lido/protocol/info` | Public | none | N/A | 1 | Total pooled ETH + APY snapshot |

## Lido workflow notes

- **Unstake may require 2-step execution**:
  1. `unstake_approval` transaction (if allowance is insufficient).
  2. Follow-up unstake request transaction.
- **Claim withdrawals** requires finalized, unclaimed request IDs that belong to caller.
- **Transaction status tracking** can be enriched by calling `/api/lido/transaction/submit` after wallet broadcast.
- **Portfolio history** depends on persistence being configured (`DATABASE_URL` and schema initialization).

## Lido example payloads

### Stake request

```json
{
  "userAddress": "0xYourAddress",
  "amount": "10000000000000000"
}
```

### Claim withdrawals request

```json
{
  "userAddress": "0xYourAddress",
  "requestIds": ["12345", "12346"]
}
```

## Lending API reference (full)

Base URL examples:

- Direct service: `http://localhost:3006`
- Via miniapp proxy: `http://localhost:3000/api/lending`

## Service-level operational endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | Public | Includes circuit breaker status and DB gateway mode |
| GET | `/info` | Public | Lists route groups and advertised features |
| GET | `/network/status` | Public | RPC connectivity + block/gas snapshot |
| GET | `/config` | Public | Network/rate-limit/security config snapshot |

## Benqi routes (`/benqi/*`)

| Method | Path | Auth | Required Input | Amount Unit | Chain | Notes |
|---|---|---|---|---|---:|---|
| GET | `/benqi/qtokens` | Public | none | N/A | 43114 | qToken list (on-chain discovery with fallback) |
| GET | `/benqi/markets` | Public | none | N/A | 43114 | UI-oriented markets with APY bps + collateral factor |
| GET | `/benqi/qtokens/:address` | JWT/signature | `address` path | N/A | 43114 | qToken metadata |
| GET | `/benqi/qtokens/:address/rates` | JWT/signature | `address` path | N/A | 43114 | supply/borrow APY |
| GET | `/benqi/account/:address/liquidity` | JWT/signature | `address` path | N/A | 43114 | liquidity + shortfall |
| GET | `/benqi/account/:address/assets` | JWT/signature | `address` path | N/A | 43114 | entered collateral markets |
| GET | `/benqi/account/:address/balance/:qTokenAddress` | JWT/signature | path params | N/A | 43114 | supplied balances |
| GET | `/benqi/account/:address/borrow/:qTokenAddress` | JWT/signature | path params | N/A | 43114 | borrow balance |
| GET | `/benqi/account/:address/info` | JWT/signature | `address` path | N/A | 43114 | aggregate liquidity/assets/balances |
| GET | `/benqi/account/:address/positions` | JWT/signature | `address` path | N/A | 43114 | normalized per-asset positions for frontend |
| POST | `/benqi/supply` | JWT/signature | `qTokenAddress`, `amount` | Wei string | 43114 | tx prep |
| POST | `/benqi/redeem` | JWT/signature | `qTokenAddress`, `amount`, optional `isUnderlying` | Wei string | 43114 | tx prep |
| POST | `/benqi/borrow` | JWT/signature | `qTokenAddress`, `amount` | Wei string | 43114 | tx prep |
| POST | `/benqi/repay` | JWT/signature | `qTokenAddress`, `amount` | Wei string | 43114 | tx prep |
| POST | `/benqi/enterMarkets` | JWT/signature | `qTokenAddresses[]` | N/A | 43114 | tx prep |
| POST | `/benqi/exitMarket` | JWT/signature | `qTokenAddress` | N/A | 43114 | tx prep |
| GET | `/benqi/account/:address/history` | JWT/signature | `address` path, optional `limit` | N/A | 43114 | DB gateway-backed tx history |
| GET | `/benqi/account/:address/snapshots` | JWT/signature | `address` path, optional `days` | N/A | 43114 | DB gateway-backed daily snapshots |

## Benqi validation routes (`/benqi-validation/*`)

| Method | Path | Auth | Required Input | Amount Unit | Chain | Notes |
|---|---|---|---|---|---:|---|
| POST | `/benqi-validation/validateAndSupply` | JWT/signature | `amount`, `qTokenAddress` | Wei string | 43114 | Returns `validation` + `supply` tx plans |
| POST | `/benqi-validation/validateAndBorrow` | JWT/signature | `amount`, `qTokenAddress` | Wei string | 43114 | Returns `validation` + `borrow` tx plans |
| POST | `/benqi-validation/getValidationAndSupplyQuote` | JWT/signature | `amount`, `qTokenAddress` | Wei string | 43114 | Quote only, no tx plan execution |
| POST | `/benqi-validation/getValidationAndBorrowQuote` | JWT/signature | `amount`, `qTokenAddress` | Wei string | 43114 | Quote only |
| POST | `/benqi-validation/validateAndWithdraw` | JWT/signature | `amount`, `qTokenAddress` | Wei string | 43114 | Returns `validation` + `withdraw` tx plans |
| POST | `/benqi-validation/validateAndRepay` | JWT/signature | `amount`, `qTokenAddress` | Wei string | 43114 | Returns `validation` + `repay` tx plans |

If validation contract is not configured, these routes can return direct action tx plans with `validationBypassed: true`.

## Validation contract routes (`/validation/*`)

| Method | Path | Auth | Required Input | Amount Unit | Chain | Notes |
|---|---|---|---|---|---:|---|
| GET | `/validation/info` | JWT/signature | none | N/A | 43114 | Owner/taxRate metadata |
| POST | `/validation/calculate` | JWT/signature | `amount` | Wei string | 43114 | Calculates tax and rest amount |
| POST | `/validation/setTaxRate` | JWT/signature | `newTaxRate` | N/A | 43114 | Owner operation, returns tx prep |
| POST | `/validation/payAndValidate` | JWT/signature | `amount` | Wei string | 43114 | Returns tx prep for payable validate call |
| POST | `/validation/withdraw` | JWT/signature | none | N/A | 43114 | Owner withdraw tx prep |
| GET | `/validation/balance` | JWT/signature | none | N/A | 43114 | Contract balance |
| POST | `/validation/prepare` | JWT/signature | `functionName`, optional `params` | function dependent | 43114 | Generic transaction encoder |

## Validation+swap routes (`/validation-swap/*`)

| Method | Path | Auth | Required Input | Amount Unit | Chain | Notes |
|---|---|---|---|---|---:|---|
| POST | `/validation-swap/validateAndSwap` | JWT/signature | `amount`, `tokenIn`, `tokenOut` | Wei string | 43114 | Returns validation tx + swap metadata |
| POST | `/validation-swap/getValidationAndSwapQuote` | JWT/signature | `amount`, `tokenIn`, `tokenOut` | Wei string | 43114 | Returns validation + simulated swap quote |

## DEX routes (`/dex/*`)

| Method | Path | Auth | Required Input | Amount Unit | Chain | Notes |
|---|---|---|---|---|---:|---|
| GET | `/dex/getprice` | JWT/signature | Query: `dexId`, `path`, `amountIn` | Wei string | 43114 | `dexId` must be `"2100"` |
| POST | `/dex/getprice` | JWT/signature | Body: `dexId`, `path`, `amountIn` | Wei string | 43114 | `path` can be comma string or array |
| GET | `/dex/getuserliquidity` | JWT/signature | Query: `tokenA`, `tokenB`, `dexId`, `address`, `id` | N/A | 43114 | User LP info |
| GET | `/dex/getpoolliquidity` | JWT/signature | Query: `poolAddress`, `dexId`, `id` | N/A | 43114 | Pool liquidity |
| GET | `/dex/gettokenliquidity` | JWT/signature | Query: `poolAddress`, `dexId` | N/A | 43114 | Token-level pool liquidity |
| POST | `/dex/swap` | JWT/signature | `dexId`, `path`, `amountIn`, `amountOutMin`, `to`, `from`, `deadline` | Wei string | 43114 | Swap tx prep |
| POST | `/dex/addliquidity` | JWT/signature | `dexId`, `tokenA`, `tokenB`, `amountA`, `amountB`, `amountAMin`, `amountBMin`, `deadline`, `to`, `from` | Wei string | 43114 | Add liquidity tx prep |
| POST | `/dex/removeliquidity` | JWT/signature | `dexId`, `tokenA`, `tokenB`, `amountAMin`, `amountBMin`, `deadline`, `from`, `to`, `binStep`, `ids[]`, `amounts[]` | Wei string | 43114 | Remove liquidity tx prep |
| GET | `/dex/tokens` | Public | none | N/A | 43114 | Token catalog |
| GET | `/dex/tokens/:symbol` | Public | `symbol` path | N/A | 43114 | Token address lookup |

## Miniapp integration mapping

| Miniapp Action | API Calls |
|---|---|
| Stake via protocol | `POST /api/staking/api/lido/stake` |
| Unstake via queue | `POST /api/staking/api/lido/unstake` |
| Claim finalized withdrawals | `POST /api/staking/api/lido/withdrawals/claim` |
| Staking position/history/withdrawals | `GET /api/staking/api/lido/position/:address`, `GET /api/staking/api/lido/history/:address`, `GET /api/staking/api/lido/withdrawals/:address` |
| Stake/unstake via market | `POST /api/swap/quote`, `POST /api/swap/tx` |
| Lending markets | `GET /api/lending/benqi/markets` |
| Lending account positions | `GET /api/lending/benqi/account/:address/positions` |
| Lending actions | `POST /api/lending/benqi-validation/validateAndSupply|Borrow|Withdraw|Repay` |
| Lending history/snapshots | `GET /api/lending/benqi/account/:address/history`, `GET /api/lending/benqi/account/:address/snapshots` |
| Lending DEX support (optional) | `GET|POST /api/lending/dex/getprice`, `POST /api/lending/dex/swap`, `GET /api/lending/dex/tokens` |

## Operational smoke checks

## Basic health checks

```bash
curl -s http://localhost:3004/health
curl -s http://localhost:3006/health
curl -s http://localhost:3002/health
```

## Core read checks

```bash
curl -s http://localhost:3004/api/lido/protocol/info
curl -s http://localhost:3006/benqi/markets
curl -s http://localhost:3006/dex/tokens
```

## Through miniapp proxy (with Next.js running)

```bash
curl -s http://localhost:3000/api/staking/health
curl -s http://localhost:3000/api/lending/benqi/markets
curl -s http://localhost:3000/api/swap/health
```

## Authenticated read and tx-prep checks

```bash
export TOKEN="<jwt>"
export ADDRESS="<wallet_address>"
export QTOKEN="<benqi_qtoken_address>"

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3006/benqi/account/$ADDRESS/positions

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3004/api/lido/stake \
  -d "{\"userAddress\":\"$ADDRESS\",\"amount\":\"1000000000000000\"}"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3006/benqi-validation/validateAndSupply \
  -d "{\"address\":\"$ADDRESS\",\"amount\":\"1000000000000000000\",\"qTokenAddress\":\"$QTOKEN\"}"
```

## Troubleshooting

- **401/403 on protected routes**
  - Verify JWT is valid (`/auth/validate`) and wallet address matches route/body address.
- **Miniapp proxy timeout**
  - Check `telegram/apps/miniapp/next.config.ts` rewrites and ensure local targets are `localhost` ports.
- **Wrong network at wallet execution**
  - Staking transactions require Ethereum mainnet; lending requires Avalanche C-Chain.
- **Validation contract errors on lending validation routes**
  - Check `VALIDATION_CONTRACT_ADDRESS`; when missing/zero, some routes fall back to direct tx prep.
- **Rate-limited markets or action routes**
  - Retry after backoff; lending uses route-level and global rate limits.
- **No history/snapshots data**
  - DB gateway integration may be disabled (`DB_GATEWAY_SYNC_ENABLED=false`).

## Known implementation inconsistencies

- `lido-service` request validation middleware accepts decimal-like amount strings, but service layer enforces integer wei strings.
- `lido-service` error shape is not fully uniform across all controller paths.
- Several lending GET routes read optional `rpc` from `req.body`; GET bodies are not reliable across clients.
- `lending-service/README.md` and `lido-service/README.md` include examples that can diverge from current runtime behavior.

## Older docs marked as potentially outdated

Use this file as the current reference before trusting older docs:

- `panorama-block-backend/lending-service/README.md`
- `panorama-block-backend/lido-service/README.md`
- `panorama-block-backend/STAKING_LENDING_CALL_FLOW_AUDIT.md`
- `panorama-block-backend/LOCAL_TEST_RUNBOOK_STAKING_LENDING.md`
