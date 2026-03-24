# Database Gateway Contract: Staking + Lending

Date: 2026-02-17  
Status: Phase 1 contract (ready to implement in services)

## 1) Purpose

Standardize how `lido-service` and `lending-service` persist data in the central `database` gateway.

Rules:
- On-chain adapters remain source-of-truth for balances and positions.
- Gateway stores snapshots/history/tx tracking.
- All gateway writes are authenticated service-to-service with JWT + tenant.

## 2) Gateway base

- Base URL: `http://gateway-database:8080` (example)
- Health: `GET /health`
- CRUD base: `/v1/:entity`
- Transact: `POST /v1/_transact`

## 3) Required headers

For all non-health calls:

- `Authorization: Bearer <service_jwt>`
- `x-tenant-id: <tenant_id>`
- `Content-Type: application/json`

For mutating calls (`POST/PATCH/DELETE`):

- `Idempotency-Key: <stable_unique_key>`

## 4) Service JWT claims

Recommended minimum claims:

```json
{
  "sub": "lending-service",
  "service": "lending-service",
  "roles": ["admin"],
  "tenant": "panorama-default"
}
```

Notes:
- JWT must be signed with gateway `JWT_SECRET`.
- If `tenant` claim exists and `x-tenant-id` header exists, they must match.

## 5) Entity mapping

Use these collections already registered in gateway:

- `users`
- `lending-markets`
- `lending-positions`
- `lending-snapshots`
- `lending-txs`
- `lido-positions`
- `lido-withdrawals`
- `lido-txs`

## 6) ID strategy (deterministic)

Use deterministic IDs to simplify update-first persistence:

- `marketId = "43114:<qTokenAddressLowercase>"`
- `positionId = "<userId>:<marketId>"`
- `lidoPositionId = "<userId>:1:lido"`
- `lendingTxId = "<chainId>:<txHashLowercase>"` (fallback to server-generated UUID if hash unknown)
- `lidoTxId = "<chainId>:<txHashLowercase>"`
- `withdrawalId = "<userId>:1:<requestId>"`

`userId` convention:
- Prefer canonical app user ID if already available.
- If not available, use normalized wallet address lowercase.

## 7) Upsert pattern (gateway has no native upsert route)

For each record:
1. Try `PATCH /v1/:entity/:id`.
2. If `404`, run `POST /v1/:entity`.

For users:
- first call `PATCH /v1/users/:userId` to update `walletAddress/lastSeenAt`
- on `404`, call `POST /v1/users` with minimal payload.

## 8) Contract by service

## 8.1 lending-service

### A) Sync markets (periodic)

`PATCH /v1/lending-markets/:marketId` (fallback create)

Payload:
```json
{
  "chainId": 43114,
  "protocol": "benqi",
  "qTokenSymbol": "qiAVAX",
  "underlyingSymbol": "AVAX",
  "underlyingDecimals": 18,
  "collateralFactorBps": 7400,
  "supplyApyBps": 95,
  "borrowApyBps": 298,
  "isActive": true,
  "metadata": { "source": "onchain" }
}
```

### B) Sync account positions (on read/refresh)

1) Ensure user exists (`users`).
2) For each market position:
   - `PATCH /v1/lending-positions/:positionId` (fallback create)
3) Write daily snapshot:
   - `PATCH /v1/lending-snapshots/:snapshotId` (fallback create)

### C) Track tx lifecycle

On tx prepared/submitted/confirmed/failed:
- `PATCH /v1/lending-txs/:txId` (fallback create)

## 8.2 lido-service

### A) Sync current position

`PATCH /v1/lido-positions/:positionId` (fallback create)

Payload:
```json
{
  "userId": "0xabc...",
  "chainId": 1,
  "stethWei": "123000000000000000",
  "wstethWei": "0",
  "apyBps": 280
}
```

### B) Sync withdrawals

For each request:
- `PATCH /v1/lido-withdrawals/:withdrawalId` (fallback create)

### C) Track tx lifecycle

Stake/unstake/claim:
- `PATCH /v1/lido-txs/:txId` (fallback create)

## 9) Idempotency key examples

- market sync: `lend:market:43114:0x5c0401...`
- position sync: `lend:pos:<userId>:<marketId>:<unixMinute>`
- lending tx: `lend:tx:<txHash>`
- lido position: `lido:pos:<userId>:1`
- lido withdrawal: `lido:wd:<userId>:<requestId>`
- lido tx: `lido:tx:<txHash>`

## 10) Minimal rollout plan

1. Apply gateway migration with lending/lido tables.
2. Enable write path in `lending-service` for positions + tx.
3. Enable write path in `lido-service` for position/withdrawals + tx.
4. Keep reads on-chain (do not switch truth to DB).
5. Add reconciliation cron (optional) for drift repair.

