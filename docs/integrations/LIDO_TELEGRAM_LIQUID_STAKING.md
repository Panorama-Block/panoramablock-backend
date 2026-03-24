# PanoramaBlock — Lido Service + Telegram MiniApp (Liquid Staking)
Análise do projeto, arquitetura, integrações, modelagem de dados e plano de entrega.

> English version: `panorama-block-backend/LIDO_TELEGRAM_LIQUID_STAKING_EN.md`

> Escopo principal deste documento: entender como o `lido-service` funciona hoje, como ele se integra com o frontend do Telegram (MiniApp), e como suportar **stake/unstake/posições/tx/info** com **dois modos de saída**:
> 1) **Instant via Swap** (stETH → ETH)  
> 2) **Native Withdrawal Queue** (approve → request → wait → claim).

---

## 1) Mapa do monorepo

### Backend (`panorama-block-backend/`)
- `auth-service`: autenticação centralizada (SIWE/thirdweb), emissão/validação de JWT e sessões em Redis.
- `liquid-swap-service`: swap não-custodial (quote/tx bundle/status/history) com Uniswap Trading API / (opcional) Smart Router / thirdweb.
- `lido-service`: staking Lido em Ethereum (stake, withdrawal queue, posição, info, tracking/persistência).
- Outros serviços: `bridge-service`, `dca-service`, `lending-service`, `wallet-tracker-service`, etc.

### Telegram (`telegram/`)
- `apps/miniapp`: Next.js (basePath `/miniapp`) com páginas de staking, swap, chat, portfolio etc.
- `apps/gateway`: Fastify + grammy; proxy para `/miniapp/*` e `/swap/*`.

> Referência de arquitetura do backend (auth/swap) já existe em `panorama-block-backend/DOCUMENTACAO.md`.

---

## 2) Autenticação (padrão do ecossistema)

O padrão do projeto é **JWT centralizado** no `auth-service`:
1. `POST /auth/login` → gera payload SIWE.
2. Cliente assina a mensagem.
3. `POST /auth/verify` → recebe JWT (`token`) + cookie refresh.
4. Serviços (swap/lido/…) validam o JWT chamando `POST /auth/validate`.

No `lido-service`, rotas que criam transação exigem:
- `Authorization: Bearer <token>`
- e `userAddress` no body deve bater com o endereço do JWT (proteção contra “impersonation”).

Arquivos importantes:
- `panorama-block-backend/auth-service/src/routes/auth.ts`
- `panorama-block-backend/lido-service/src/infrastructure/http/middleware/auth.ts`

---

## 3) Lido Service (backend) — como funciona

### 3.1 Responsabilidade
O `lido-service` **não custodia** fundos:
- Ele **prepara** `transactionData` (to/data/value/gasLimit/chainId) para o cliente assinar/enviar.
- ✅ **Decisão:** não existe execução via `privateKey` no backend (removido). O fluxo é 100% non-custodial.

### 3.2 Contratos e chamadas on-chain (Ethereum Mainnet)
O repositório (`LidoRepository`) usa `ethers` para interagir com:
- `stETH` (Lido): `submit(referral)` para stake.
- `wstETH`: `balanceOf` e `getStETHByWstETH` para converter wstETH → “equivalente em stETH”.
- `WithdrawalQueue`:  
  - `requestWithdrawals([amount], owner)` para entrar na fila de saque  
  - `getWithdrawalRequests(owner)` / `getWithdrawalStatus(ids)` para listar status  
  - `findCheckpointHints(ids, from, to)` + `claimWithdrawals(ids, hints)` para claim.

Arquivos importantes:
- `panorama-block-backend/lido-service/src/infrastructure/config/lidoContracts.ts`
- `panorama-block-backend/lido-service/src/infrastructure/repositories/LidoRepository.ts`

### 3.3 Endpoints principais
- `POST /api/lido/stake` (JWT + body.userAddress) → prepara stake ETH→stETH
- `POST /api/lido/unstake` (JWT + body.userAddress) → prepara “withdrawal request” (stETH→WithdrawalQueue)
  - pode exigir **2 passos**: `unstake_approval` → depois `unstake`
- `GET /api/lido/position/:userAddress` → lê on-chain e retorna posição (padronizado em **wei strings**)
- `GET /api/lido/protocol/info` → info do protocolo (ex.: total staked em **wei string**)
- `GET /api/lido/history/:userAddress?limit=...` → histórico persistido (se DB configurado)
- `GET /api/lido/portfolio/:userAddress?days=30` → snapshot persistido (assets + métricas diárias)
- `GET /api/lido/withdrawals/:userAddress` → lista requests da fila + status
- `POST /api/lido/withdrawals/claim` (JWT + body.userAddress) → prepara claim de withdrawals finalizados
- `POST /api/lido/transaction/submit` (JWT + body.userAddress) → registra `txHash` para histórico/status
- `GET /api/lido/transaction/:hash` → consulta receipt e atualiza status (quando persistência ativa)

> Observação importante sobre unidades:
> - **Inputs** de stake/unstake: string decimal em ETH/stETH (ex.: `"0.05"`).
> - **Outputs** de position/protocol/history: valores monetários retornam como **wei strings** para padronização.

---

## 4) “Unstake”: os dois modos (como pedido)

### Modo 1 — Instant via Swap (stETH → ETH)
O “unstake instantâneo” **não é um saque do protocolo** — é um **swap** no mercado:
- Usuário vende `stETH` e recebe `ETH` imediatamente.
- Vantagens: velocidade (quase imediata), UX simples.
- Desvantagens: slippage, taxa, preço pode não ser 1:1.

Como fica no seu sistema:
- Reusa o **fluxo já existente de Swap** (mesma filosofia não-custodial, mesmo UX, mesmo histórico do swap).
- Na página de staking, há um CTA que abre `/swap` com prefill stETH→ETH em Ethereum.

Arquivos importantes:
- `telegram/apps/miniapp/src/app/staking/page.tsx` (CTA “Instant Unstake via Swap”)
- `telegram/apps/miniapp/src/app/swap/page.tsx` (prefill via querystring)
- `telegram/apps/miniapp/src/features/swap/*` (quote/tx)

### Modo 2 — Native Withdrawal Queue (approve → request → wait → claim)
Aqui o usuário faz o “unstake” nativo do Lido via Withdrawal Queue:
1. (se necessário) **Approve** `stETH` para a WithdrawalQueue
2. **Request** `requestWithdrawals([amount], owner)`
3. Aguardar finalizar (tempo variável, depende da fila/protocolo)
4. **Claim** `claimWithdrawals(ids, hints)` quando `isFinalized=true`

Vantagens:
- Não depende de liquidez de mercado (sem slippage)
- É o fluxo “nativo” do protocolo

Desvantagens:
- Não é instantâneo (há espera)
- Exige `stETH` (se usuário tiver `wstETH`, precisa unwrap ou swap antes)

---

## 5) Persistência (DB) — posições, txs, history, withdrawals

### 5.1 Por que persistir?
Sem DB, você consegue:
- posição e protocol info (on-chain / API)

Mas com DB você ganha:
- **histórico** por usuário (txs que o app preparou/executou)
- **status** de transações
- base para **rendimentos** e **portfolio** por snapshots (time series)

### 5.2 Schema atual do lido-service
Arquivo: `panorama-block-backend/lido-service/schema.sql`

Tabelas:
- `lido_users`: dono das posições (address).
- `lido_positions_current`: última posição conhecida (stETH/wstETH/total/apY/block).
- `lido_position_snapshots`: snapshots no tempo (para analytics).
- `lido_transactions`: transações preparadas (inclui `tx_data`) e `tx_hash` após o cliente enviar.
- `lido_withdrawal_requests`: requests da Withdrawal Queue + status.
- `lido_portfolio_assets`: “assets atuais” (stETH + wstETH) por usuário.
- `lido_portfolio_metrics_daily`: métricas diárias (time series) por usuário.
- `lido_user_links`: opcional (wallet ↔ telegram user / tenant), se você quiser unificar identidade.

Bootstrap:
- `panorama-block-backend/lido-service/src/infrastructure/database/database.service.ts` inicializa `schema.sql` quando `DATABASE_URL` existe.

> DB “já existente hoje”: vamos usar **o mesmo Postgres**, isolando o Lido num schema dedicado via `LIDO_DB_SCHEMA` (default: `lido`).

### 5.3 “Tabelas complexas” (rendimentos/portfolio/user info) — baseline implementado
Para suportar **portfolio** sem mocks, já adicionamos um baseline simples (extensível):
- `lido_portfolio_assets`:
  - `(address, chain_id, token_symbol, token_address, balance_wei, updated_at)`
- `lido_portfolio_metrics_daily`:
  - `(address, chain_id, date, steth_balance_wei, wsteth_balance_wei, total_staked_wei, apy_bps, updated_at)`
- `lido_user_links` (opcional):
  - `(address, telegram_user_id, tenant_id, metadata, created_at, updated_at)`

> Importante: “rendimentos” em Lido não é um “claim” clássico; em stETH (rebase) a posição cresce com o tempo. Para calcular yield real, você precisa ajustar por depósitos/saques (eventos) e comparar snapshots.

---

## 6) Telegram MiniApp — onde exibir e como integrar

### 6.1 Páginas envolvidas
- Liquid Staking: `telegram/apps/miniapp/src/app/staking/page.tsx`
- Swap: `telegram/apps/miniapp/src/app/swap/page.tsx`

### 6.2 Cliente de API (staking)
Arquivo: `telegram/apps/miniapp/src/features/staking/api.ts`
- `getTokens()`
- `getUserPosition()`
- `stake(amount)`
- `unstake(amount)`
- `getWithdrawals()`
- `claimWithdrawals(requestIds)`
- `getHistory(limit)`
- `getPortfolio(days)`
- `submitTransactionHash(id, txHash)`

### 6.3 Proxy/rewrites para o backend
Arquivo: `telegram/apps/miniapp/next.config.ts`
- Reescreve `/api/staking/*` para `NEXT_PUBLIC_STAKING_API_URL` (ou `VITE_STAKING_API_URL`).

Isso permite no MiniApp:
- `baseUrl = '/api/staking'` (padrão) → proxy para o host real do backend.

---

## 7) Fluxos end-to-end (o que testar)

### 7.1 Stake (ETH → stETH)
1. MiniApp pega JWT (auth-service).
2. `POST /api/lido/stake` retorna `transactionData`.
3. Cliente assina/envia (smart wallet / metamask).
4. Cliente chama `POST /api/lido/transaction/submit` com `{ id, userAddress, transactionHash }`.
5. `GET /api/lido/history/:address` passa a incluir a tx (quando DB ativo).

### 7.2 Withdrawal Queue (stETH → request → claim ETH)
1. `POST /api/lido/unstake`
2. Se vier `type=unstake_approval`, executar; depois chamar `unstake` novamente.
3. Aguardar request aparecer em `GET /api/lido/withdrawals/:address`.
4. Quando `isFinalized=true`, chamar `POST /api/lido/withdrawals/claim`.
5. Executar `withdrawal_claim` tx e enviar `transaction/submit`.

### 7.3 Instant via Swap (stETH → ETH)
1. No `/staking`, clicar “Instant Unstake via Swap”.
2. `/swap` abre com prefill (chain 1, sell stETH, buy ETH, amount opcional).
3. Fazer quote → preparar tx → assinar/enviar.
4. (Opcional) consolidar no futuro num “portfolio unified history”.

---

## 8) Checklist de testes (scripts + manual)

### Backend (docker-compose)
1. Subir stack: `panorama-block-backend/docker-compose.yml`
2. Garantir:
   - `AUTH_SERVICE_URL` configurado
   - `ETHEREUM_RPC_URL` válido
   - `DATABASE_URL`/`LIDO_DATABASE_URL` válido (para persistência)
3. Testar endpoints:
   - `/api/lido/protocol/info`
   - `/api/lido/position/:address`
   - `stake` / `unstake` (fluxo 2 passos)
   - `withdrawals` / `withdrawals/claim`
   - `transaction/submit` / `transaction/:hash`

Scripts úteis:
- `panorama-block-backend/lido-service/tests/quick-test.sh`
- `panorama-block-backend/lido-service/tests/test-lido-api.sh`

### Frontend (MiniApp)
1. Ver `NEXT_PUBLIC_STAKING_API_URL` apontando para o gateway/backend correto.
2. Abrir `/miniapp/staking`:
   - posição aparece (stETH e wstETH)
   - botão “Request Withdrawal (Lido Queue)”
   - botão “Instant Unstake via Swap”
   - seção “Withdrawals” lista requests
   - seção “Activity” lista histórico (quando DB ativo)

---

## 9) Perguntas abertas (para continuarmos passo a passo)

1) **DB “já existente hoje”**: você quer guardar as tabelas do Lido:
   - no mesmo Postgres do `engine_postgres` (compose), ou
   - em outro banco/cluster já usado pelo produto?

2) **Rendimentos/portfolio**: qual formato você quer exibir no Telegram?
   - “P&L” em ETH? em USD? ambos?
   - períodos: 24h/7d/30d/all?
   - quer “apr/apy histórico” (curva), ou só números?

3) **Item 4 (privateKey execution)**: confirmar se:
   - ✅ **Decisão:** removemos totalmente o caminho `privateKey` do backend (fluxo 100% non-custodial).
