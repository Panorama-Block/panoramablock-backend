# PanoramaBlock — Local Test Runbook (Staking + Lending)

This runbook is the **minimum, repeatable** way to validate the stack locally (Docker backend + Telegram MiniApp frontend), focusing on:
- Liquid Staking (Lido on Ethereum) — stake/unstake/positions/history
- Lending (Benqi on Avalanche) — markets list, positions (v1), and transaction prep

It is written to help you diagnose failures quickly and avoid the “tx succeeded but UI says failed” trust breaker.

---

## 0) Prerequisites

- Docker Desktop running
- A browser wallet (MetaMask) on:
  - Ethereum Mainnet (for Lido staking)
  - Avalanche C-Chain (for Benqi lending)
- You have **real balances** (no mocks). For staking tests you need ETH. For lending tests you need AVAX + some token supported by Benqi.

---

## 1) Backend — start everything

From repo root:

```bash
cd panorama-block-backend
docker compose up --build
```

### 1.1) What “good” looks like in logs

- `panorama-engine-postgres` becomes healthy.
- `panorama-engine-postgres-bootstrap` prints:
  - `Applying tac-bootstrap.sql...`
  - `Bootstrap finished...`
- `panorama-liquid-swap` prints:
  - `Swap API: http://localhost:3002/swap/`
- `panorama-lido-service` prints:
  - `Lido Service running on port 3004`
- `panorama-lending-service` prints:
  - `Servidor rodando em http://localhost:3006`

### 1.2) Quick health checks (copy/paste)

```bash
curl -s http://localhost:3001/health | jq
curl -s http://localhost:3002/health | jq
curl -s http://localhost:3004/health | jq
curl -s http://localhost:3006/health | jq
curl -s http://localhost:3007/health | jq
```

If you don’t have `jq`, remove the pipe.

---

## 2) Backend — validate the two biggest blockers

### 2.1) Bridge DB bootstrap (tac_service role/db)

Symptom:
- `bridge_service` fails with `Role "tac_service" does not exist`

Fix expectation:
- The bootstrap container should create the role/db even when the Postgres volume already exists.

Check:

```bash
docker compose logs -f engine_postgres_bootstrap
```

You should see it apply `bridge-service/database/tac-bootstrap.sql`.

### 2.2) Lending markets (Benqi) must return 200

Symptom:
- MiniApp shows `Failed to load lending markets`
- Backend logs: `GET /benqi/markets ... 500`

Test:

```bash
curl -s http://localhost:3006/benqi/markets | jq '.status, (.data.total // .data.markets|length)'
```

Expected:
- `status: 200`
- a non-zero `total` (or a non-empty `markets` array)

---

## 3) Frontend — run the Telegram MiniApp locally

```bash
cd telegram/apps/miniapp
npm run dev
```

Open:
- `http://localhost:3000/miniapp/chat`
- `http://localhost:3000/miniapp/portfolio`

### 3.2) Proxy sanity check (this catches 90% of “timeout” bugs)

With the MiniApp dev server running (`npm run dev`), these should return **fast**:

```bash
curl -i http://localhost:3000/api/lending/benqi/markets
curl -i http://localhost:3000/api/staking/health
curl -i http://localhost:3000/api/swap/health
```

If these hang or time out:
- check the MiniApp terminal output for lines like `[Next.js] Lending API proxy configured: ...`
- and ensure the proxy is pointing to `http://localhost:3006` (not `http://lending_service:3006`).

### 3.1) Required envs (local)

The MiniApp proxies to your backend via Next.js rewrites:
- `/api/staking/*` → Lido service (default `http://localhost:3004`)
- `/api/lending/*` → Lending service (default `http://localhost:3006`)
- `/api/swap/*` → Liquid Swap service (default `http://localhost:3002`)

If you don’t set any env vars, **local dev defaults to localhost ports** above.

If you want to override (e.g. pointing to a remote backend), set one of:
- `VITE_STAKING_API_URL`
- `VITE_LENDING_API_BASE` (or `NEXT_PUBLIC_LENDING_API_URL`)
- `VITE_SWAP_API_BASE` (or `NEXT_PUBLIC_SWAP_API_BASE`)

Important:
- In local dev, if you accidentally set docker-internal hostnames like `http://lending_service:3006`, the proxy can hang/time out. The MiniApp now normalizes these to `http://localhost:*` by default.
- After changing env vars, **restart** `npm run dev` so rewrites are reloaded.

If you prefer `NEXT_PUBLIC_*` vars, the app supports:
- `NEXT_PUBLIC_STAKING_API_URL`
- `NEXT_PUBLIC_LENDING_API_URL`
- `NEXT_PUBLIC_SWAP_API_BASE`

---

## 4) End-to-end tests (product-level)

### 4.1) Portfolio page

Go to `http://localhost:3000/miniapp/portfolio`.

Expected:
- Staking card shows `stETH`/`wstETH` balances (if you have them) and a `Manage` CTA.
- Lending card shows:
  - markets/positions data (no red “failed to load markets”)
  - a `Manage` CTA

### 4.2) Staking (Lido on Ethereum)

Open staking:
- Via `Manage` on the Staking card **or**
- Via `http://localhost:3000/miniapp/staking`

Validate:
- **Stake**: ETH → stETH
  - When you type `You pay` (ETH), `You get` (stETH) updates.
- **Unstake (market)**: stETH → ETH
  - When you type `You pay` (stETH), `You get` (ETH) updates.
- If the wallet broadcasts a transaction but the SDK throws a generic `{}` error:
  - UI should still capture the tx hash (when available) and show `Pending` → `Confirmed`.

### 4.3) Lending (Benqi on Avalanche)

Open lending:
- Via `Manage` on the Lending card **or**
- Via `http://localhost:3000/miniapp/lending`

Validate:
- Tokens/markets load (no 500).
- Pick a token, choose `Supply` or `Borrow`, and go through `Review` → `Confirm`.

---

## 5) Unit policy (important to avoid “426 stETH for 1 ETH” bugs)

For Liquid Swap quotes/tx preparation:
- **Quote**: `amount` is in **token units** (decimal string), and callers should send `unit: "token"`.
- **Prepare tx**: `amount` may be in **wei** (integer string) *only when* `unit: "wei"` is sent.

If you ever see a quote that is wildly wrong (e.g. `1 ETH -> 426 stETH`), it is almost always:
- wei being sent while the server interprets it as token units, or
- decimals mismatch for the input token

---

## 6) If something still fails (fast triage)

- Lending markets 500:
  - verify RPC URL is reachable
  - verify Benqi addresses (comptroller + qiTokens) are correct
- Swap quote 404:
  - check you’re calling `/swap/quote` (or the back-compat `/quote` alias)
- Staking/Lending modal/page “crashes”:
  - check browser console for a `ReferenceError` or hydration mismatch
  - restart `npm run dev` (Next can hold stale state)
