# TON → Ethereum via LayerZero — Implementation Tracker

Guiding doc to track the migration from TAC bridge flows to direct TON → Ethereum (and other EVM) via LayerZero, landing in user thirdweb Smart Wallets.

## Current status
- Overall: scaffolding exists; LayerZero TON→ETH payload builder present in `src/infrastructure/ton/TonBridgeAdapter.ts`.
- Codebase touch points: `src/infrastructure/di`, `src/infrastructure/ton`, `src/application/services`, `src/domain/interfaces`, `src/infrastructure/clients`, `src/application/usecases`, `src/config`.

### Latest implementation notes
- TonBridgeAdapter now reads LayerZero config from env (endpoint ID, OFT contract, opcode, token allowlist, fee/gas estimates) via DI (`container.ts`), and validates supported tokens before building payloads.
- New use case `InitiateTonToEthBridgeUseCase` added to orchestrate TON wallet ownership checks, resolve destination smart wallet (EVM chainId default 1), call `TonBridgeAdapter`, and emit an event; exposed via DI as `initiateTonToEthBridge`.
- API route `/api/bridge/ton/out` now uses the new use case with validation, leverages authenticated user context, and returns the LayerZero payload + destination info; `/api/bridge/ton/quote` returns structured responses.
- Added Prisma model `TonBridgeRequest` to persist TON→EVM bridge requests; initiation flow stores the record; status endpoint updates records and enforces ownership.
- Frontend miniapp bridge page now calls the authenticated backend endpoint, passes TON + smart wallet addresses, and consumes the LayerZero payload for TonConnect signature; shows bridgeId for follow-up.

## Task list
- [ ] **Task 1 — TON → Ethereum bridge integration (LayerZero)**
  - [x] Scaffold LayerZero TON→ETH payload builder (`TonBridgeAdapter.bridgeTonToEthereum`), returning BOC payload + bridgeId.
  - [ ] Harden adapter: configurable LZ endpoint IDs per env, token allowlist, slippage/min-output handling, and proper gas/fee estimation.
  - [ ] Define `ITonToEvmBridgeService` (or reuse `ITonBridgeService`) contract for LayerZero-specific params (destination smart wallet, token mapping).
  - [ ] Wire hardened adapter into DI container; inject into operation/bridge flows as primary TON→EVM path (feature-flag TAC vs LayerZero).
  - [ ] Add validation for supported tokens/chains (TON, USDC, USDT, WTON) and normalize addresses.
- [ ] **Task 2 — Smart Wallet lifecycle (Ethereum)**
  - [ ] Add a `SmartWalletService` (wrapper around thirdweb SDK) with `getOrCreateSmartWallet(userId, chainId)` returning `{ address, deployed }`.
  - [ ] Persist smart wallet address per user (new repo method and model field if missing).
  - [ ] Ensure bridge destination uses this wallet; validate ownership.
  - [ ] Add config/env for chain RPC and relayer key.
- [ ] **Task 3 — TON wallet connect + bridge initiation**
  - [ ] Add endpoint/use case to start TON → ETH bridge: accepts `token`, `amount`, `tonAddress`, `userId`, `smartWallet?: string`.
  - [ ] Integrate Tonkeeper/Tonhub connect flow in frontend to fetch `tonAddress` + signature payloads.
  - [ ] Validate amount/token, fetch/create smart wallet, then call `LayerZeroBridgeAdapter.transfer`.
  - [ ] Return payloads needed for TON signing (if any) and track an `operationId`/`bridgeRequestId`.
- [ ] **Task 4 — Bridge completion tracking + credit**
  - [ ] Add Ethereum listener (or reuse existing indexer) to watch `Transfer`/message events for the LayerZero-wrapped tokens to smart wallet addresses.
  - [ ] Correlate inbound transfer with pending bridge requests; mark as confirmed, store tx hash/block.
  - [ ] Update user balances (repository + `TacBalanceService.syncUserBalances`) and send notification.
  - [ ] Handle failure/timeout retries and user-facing status.
- [ ] **Task 5 — Reuse existing DeFi logic (EVM)**
  - [ ] Ensure post-bridge funds route into existing swap/stake/lend flows (LiquidSwap client, lending client, Lido, etc.) without TAC-specific steps.
  - [ ] Add a “bridge then act” flow that, after confirmation, triggers the requested DeFi action using the smart wallet as the actor (respecting slippage/preferences).
- [ ] **Task 6 — UX & safety**
  - [ ] Expose ETA/confirmations from LayerZero in API responses; include provider name and fees.
  - [ ] Standardize error codes for bridge rejection, insufficient gas/fees, unsupported token.
  - [ ] Track pending deposits in DB with TTL; surface in `/operations` or dedicated `/bridges`.
  - [ ] Notifications: initiated, in-flight, confirmed, failed.
- [ ] **Task 7 — Configuration & observability**
  - [ ] Add env vars for LayerZero endpoints, token addresses, RPCs, relayer keys.
  - [ ] Metrics/logging around bridge latency, success rate, failures by reason.
  - [ ] Feature flag to toggle TAC bridge vs LayerZero (default to LayerZero).
- [ ] **Task 8 — Testing & validation**
  - [ ] Unit tests for adapter + smart wallet service stubs/mocks.
  - [ ] Integration test: initiate bridge, simulate LayerZero confirmation, assert balance update + notification.
  - [ ] E2E manual checklist for TON wallet connect → ETH arrival → swap.

## Notes / assumptions
- LayerZero supports TON → Ethereum path for the chosen tokens; confirm canonical token contracts and message versions.
- Smart Wallet is thirdweb-based; relayer is available for gasless DeFi actions post-bridge.
- Prefer landing funds on Ethereum mainnet first; keep architecture extensible for other EVM chains.

## Next immediate steps
1) Define `ITonToEvmBridgeService` interface and drop-in `LayerZeroBridgeAdapter` scaffold.  
2) Add `SmartWalletService` contract and persistence of `user.smartWalletEth`.  
3) Update DI container to provide both to operation/bridge flows and add a minimal bridge initiation use case.
