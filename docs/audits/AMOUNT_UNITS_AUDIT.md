# Amount Units Audit (token vs wei)

This repo has multiple “amount” representations. The most common regression is **passing wei while the receiver expects token units** (or vice‑versa), producing nonsense quotes (e.g. `1 ETH -> 426 stETH`).

This document records the **unit contract** per endpoint and the **call-sites** that must comply.

---

## Definitions

- `token`: human/token units, decimal string (e.g. `"0.015"`)
- `wei`: base units, integer string (e.g. `"15000000000000000"`)

---

## Liquid Swap Service (`panorama-block-backend/liquid-swap-service`)

### Endpoints

#### `POST /swap/quote` (and back-compat `POST /quote`)
- **Input:** `amount` can be `token` or `wei`
- **Required:** callers should send `unit: "token" | "wei"`
- **Server behavior:** if `unit` missing, service infers it (logs a warning)
- **Conversion happens in:** `src/application/usecases/get.quote.usecase.ts`

#### `POST /swap/tx` (and back-compat `POST /tx`, `POST /swap/prepare`, `POST /prepare`)
- **Input:** `amount` can be `token` or `wei`
- **Required:** callers should send `unit`
- **Server behavior:** if `unit` missing, service infers it (logs a warning)
- **Conversion happens in:** `src/application/usecases/prepare.swap.usecase.ts`

### Validation
- Request schemas: `src/domain/validation/swap.schemas.ts`
  - Prevents decimals when `unit="wei"`
  - Prevents long-integer “wei-looking” values when `unit="token"`

---

## Telegram MiniApp (swap + staking call-sites)

### Swap API client
- Quote: `telegram/apps/miniapp/src/features/swap/api.ts`
  - Calls `POST .../quote` with `QuoteRequest`
  - Has runtime guardrails/warnings if the unit looks wrong

### Staking (market swap path)
- Uses the Swap API client to quote/prepare market swaps:
  - The **quote** call must send `unit: "token"` with decimal strings.
  - The **prepare** call may send `unit: "wei"` + integer, or `unit:"token"` + decimal (server converts safely).

---

## Lending Service (Benqi) amounts

Benqi transaction prep endpoints typically expect **token amounts** from UI and convert to base units internally.

If you see “could not decode result data (value=0x)” it is almost always:
- wrong contract address (constants drift), or
- wrong ABI method (per-block vs per-timestamp rate functions)

---

## Quick self-test snippets

### Liquid swap quote (token units)
```bash
curl -s http://localhost:3002/swap/quote \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "fromChainId": 1,
    "toChainId": 1,
    "fromToken": "native",
    "toToken": "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    "amount": "0.01",
    "unit": "token",
    "type": "EXACT_INPUT",
    "slippage": "0.5",
    "smartAccountAddress": "0x0000000000000000000000000000000000000000"
  }' | jq
```

### Liquid swap prepare (wei units)
```bash
curl -s http://localhost:3002/swap/tx \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "fromChainId": 1,
    "toChainId": 1,
    "fromToken": "native",
    "toToken": "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    "amount": "10000000000000000",
    "unit": "wei",
    "sender": "0x0000000000000000000000000000000000000000"
  }' | jq
```

