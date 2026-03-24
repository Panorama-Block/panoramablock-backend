# Lido Service — Centralized Auth Integration (PanoramaBlock)

This document describes how `lido-service` integrates with the PanoramaBlock backend stack and the centralized `auth-service` (same pattern used by `liquid-swap-service`).

For full API details, also see: `panorama-block-backend/lido-service/README.md`.

---

## What changed (high level)

### Before
- `lido-service` had its own JWT logic and `/api/lido/auth/*` endpoints.
- Tokens were issued/validated locally.
- Service was not consistently integrated into the main backend compose.

### Now
- **Centralized authentication** via `auth-service` (shared JWT across services).
- Protected endpoints require:
  - `Authorization: Bearer <token>`
  - and `userAddress` in the body must match the JWT address.
- The service is wired into the backend docker-compose.
- Optional persistence to Postgres (positions, tx history, withdrawal queue requests).

---

## Running the stack (Docker Compose)

From `panorama-block-backend/`:

```bash
docker-compose up --build
```

Relevant services:
- Redis
- Postgres (`engine_postgres`)
- thirdweb Engine (`engine`)
- `auth_service`
- `lido_service`

---

## Authentication (SIWE via auth-service)

The flow is the same for all PanoramaBlock services:

### 1) Request a SIWE payload
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"address":"0xYourWalletAddress"}'
```

### 2) Sign the payload with the wallet
Use your wallet (ethers/web3/thirdweb) to sign the returned payload string.

### 3) Verify signature and receive JWT
```bash
curl -X POST http://localhost:3001/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"payload":{...},"signature":"0x..."}'
```

Response contains:
- `token` (JWT)
- `address`
- `sessionId`

---

## Lido Service usage

Base URL (local): `http://localhost:3004/api/lido`

### Units (important)
- **Inputs** (stake/unstake): `amount` is a decimal string in ETH/stETH (e.g. `"0.01"`, `"1.5"`).
- **Outputs** (position/protocol/history): monetary fields are returned as **wei strings**.

### Stake (ETH → stETH)
```bash
curl -X POST http://localhost:3004/api/lido/stake \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"userAddress":"0xYourWalletAddress","amount":"0.05"}'
```

### Unstake (Withdrawal Queue: stETH → request)
This is the native Lido flow and may require 2 steps:
1) `unstake_approval` (approve stETH to WithdrawalQueue)
2) `unstake` (request withdrawal)

```bash
curl -X POST http://localhost:3004/api/lido/unstake \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"userAddress":"0xYourWalletAddress","amount":"0.05"}'
```

### Position
```bash
curl -X GET http://localhost:3004/api/lido/position/0xYourWalletAddress
```

### Protocol info
```bash
curl -X GET http://localhost:3004/api/lido/protocol/info
```

> Note: `currentAPY` can be `null` if the upstream protocol API is unavailable.

### Portfolio (assets + daily metrics)
Requires DB for daily metrics; if DB is disabled you still get an on-chain asset snapshot (no history).

```bash
curl -X GET "http://localhost:3004/api/lido/portfolio/0xYourWalletAddress?days=30"
```

### History (prepared txs)
Requires DB; returns an empty array if persistence is disabled.

```bash
curl -X GET "http://localhost:3004/api/lido/history/0xYourWalletAddress?limit=25"
```

### Withdrawal requests (queue status)
```bash
curl -X GET http://localhost:3004/api/lido/withdrawals/0xYourWalletAddress
```

### Claim finalized withdrawals
```bash
curl -X POST http://localhost:3004/api/lido/withdrawals/claim \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"userAddress":"0xYourWalletAddress","requestIds":["123456"]}'
```

### Track tx hash (non-custodial history/status)
After the client broadcasts a tx built from `transactionData`, submit the hash so the backend can persist it:

```bash
curl -X POST http://localhost:3004/api/lido/transaction/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"id":"tx_...","userAddress":"0xYourWalletAddress","transactionHash":"0x..."}'
```

---

## Persistence (optional but recommended)

If `DATABASE_URL` is set for `lido-service`, the service will:
- initialize `panorama-block-backend/lido-service/schema.sql` on boot
- persist:
  - current position + snapshots
  - prepared transactions + tx hashes + status
  - withdrawal requests

The main backend compose already includes a default:
- `DATABASE_URL=${LIDO_DATABASE_URL:-postgresql://...@engine_postgres:5432/...}`

---

## Security notes

- `privateKey` execution is **not supported** (removed).
- Keep the flow **non-custodial** (backend prepares txs; client signs and sends).

---

## Environment variables (lido-service)

Common:
- `PORT` (default `3004`)
- `AUTH_SERVICE_URL` (e.g. `http://auth_service:3001`)
- `ETHEREUM_RPC_URL` (required)
- `DATABASE_URL` (optional; enables persistence)
- `LIDO_DB_SCHEMA` (optional; isolates tables in a dedicated schema, default `lido`)
