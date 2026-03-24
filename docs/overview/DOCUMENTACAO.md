  PanoramaBlock Backend (Microservices)

  Visão geral

  - Conjunto de microsserviços para autenticação, swap e rastreamento de carteiras, com práticas de arquitetura hexagonal no serviço de swap.
  - Principais serviços:
    - `auth-service` (Node + Express): SIWE/thirdweb Auth, emissão/validação de JWT, sessões em Redis.
    - `liquid-swap-service` (Node + Express/TS): orquestra provedores de swap (Uniswap Trading API, Uniswap Smart Router, thirdweb Bridge), prepara bundles para o cliente assinar e monitora status.
    - `wallet-tracker-service` (Go): rastreamento/monitoramento (fora do escopo principal desta doc).
    - `avax-service` (Foundry/Node): utilitários e rotas específicas de Avalanche/Validação (auxiliar).

  Arquitetura por serviço

  auth-service

  - Objetivo: autenticar usuários com carteiras EVM (SIWE) via thirdweb, emitir JWT e manter sessão refresh em Redis.
  - Entradas:
    - `POST /auth/login` → gera `payload` (ThirdwebAuth.payload) para endereço informado. Referência: `panorama-block-backend/auth-service/src/routes/auth.ts:19`.
    - `POST /auth/verify` → verifica assinatura (primeiro com `thirdweb/auth`, fallback ThirdwebAuth.verify) e retorna `{ token, address, sessionId }`, salvando sessão Redis e setando cookie refresh (configurável). Referência: `panorama-block-backend/auth-service/src/routes/auth.ts:95`.
    - `POST /auth/validate` → valida JWT (uso interno por outros serviços). Referência: `panorama-block-backend/auth-service/src/routes/auth.ts:140`.
    - `POST /auth/logout` → invalida sessão no Redis e limpa cookie. Referência: `panorama-block-backend/auth-service/src/routes/auth.ts:197`.
    - `POST /auth/session/refresh` → reemite token a partir do cookie de refresh e rotaciona `sessionId`. Referência: `panorama-block-backend/auth-service/src/routes/auth.ts:311`.
  - Implementação:
    - ThirdwebAuth + PrivateKeyWallet inicializados só quando `AUTH_PRIVATE_KEY` presente. Referência: `panorama-block-backend/auth-service/src/utils/thirdwebAuth.ts:1`.
    - CORS com allowlist de origens, cookies com SameSite/secure configuráveis e domínio (produção). Referência: `panorama-block-backend/auth-service/src/index.ts:36`.
    - HTTPS opcional com certificados (Let's Encrypt), com logs de fallback a HTTP. Referência: `panorama-block-backend/auth-service/src/index.ts:15`.

  liquid-swap-service

  - Objetivo: oferecer API de swap não-custodial:
    - `POST /swap/quote` → obtém cotação com provedor selecionado (auto/seletivo). **Recomendado enviar `unit`** (`token` ou `wei`) para evitar dupla conversão.
    - `POST /swap/tx` → prepara bundle de transações (approve? + swap) para o cliente assinar.
    - `GET /swap/status/:hash?chainId=...` → monitora status (quando suportado). 
    - `GET /swap/history` → histórico por usuário autenticado.
  - Segurança: todas as rotas `/swap/*` exigem JWT em `Authorization: Bearer ...`. Referência: `panorama-block-backend/liquid-swap-service/src/middleware/authMiddleware.ts:1`.
  - Arquitetura (hexagonal):
    - Domain: entidades (`SwapRequest`, `SwapQuote`, `PreparedSwap`), portas (`ISwapProvider`, `IExecutionPort`), serviços de domínio (`RouterDomainService`, `SwapDomainService`).
    - Application: casos de uso (`GetQuoteUseCase`, `PrepareSwapUseCase`, `ExecuteSwapUseCase`, `GetSwapStatusUseCase`), orquestrador de provedores (`ProviderSelectorService`).
    - Infrastructure: adapters para provedores (Uniswap Trading API, Uniswap Smart Router, thirdweb), adapters utilitários (provider de chain, repo de swaps), HTTP controllers/rotas e middlewares.
  - Seleção de Provedor (estratégia)
    - Same-chain: prioridade para Uniswap (Trading API V3; Smart Router V2/V3 temporariamente desativado por issues de subgraph), fallback Thirdweb. Referência: `panorama-block-backend/liquid-swap-service/src/domain/services/router.domain.service.ts:120`.
    - Cross-chain: preferência Thirdweb Bridge, fallback outros. Referência: `panorama-block-backend/liquid-swap-service/src/domain/services/router.domain.service.ts:292`.
    - `ProviderSelectorService` resolve alias e permite forçar provedor em `/swap/tx` (`provider`). Referência: `panorama-block-backend/liquid-swap-service/src/application/services/provider-selector.service.ts:1`.
  - Adapters de Provedores
    - Uniswap Trading API (`uniswap-trading-api`): integra REST oficial (`/quote`, `/check_approval`, `/create`), usa `generatePermitAsTransaction` e normaliza approvals (Permit2). Faz retry/backoff, calcula taxas, e retorna transações com gasLimit sugerido. Referência: `panorama-block-backend/liquid-swap-service/src/infrastructure/adapters/uniswap.tradingapi.adapter.ts:1`.
    - Uniswap Smart Router (`uniswap-smart-router`): AlphaRouter (V2/V3), lookup de tokens (registry/on-chain), tolerância de slippage configurável (`UNISWAP_SLIPPAGE_BPS`), apenas same-chain. Referência: `panorama-block-backend/liquid-swap-service/src/infrastructure/adapters/uniswap.smartrouter.adapter.ts:1`.
    - Thirdweb Provider (`thirdweb`): envolve `ThirdwebSwapAdapter` e filtra transações para cadeia de origem (evita executar passos em chain destino). Integra Bridge.Sell (`quote`, `prepare`, `status`). Referência: `panorama-block-backend/liquid-swap-service/src/infrastructure/adapters/thirdweb.provider.adapter.ts:1`.
  - Casos de uso
    - GetQuote: normaliza tokens (`native`), converte `amount` para WEI, enriquece USD (thirdweb price service) e retorna provedor usado. Referência: `panorama-block-backend/liquid-swap-service/src/application/usecases/get.quote.usecase.ts:1`.
    - PrepareSwap: cria `SwapRequest` e chama `prepareSwapWithProvider` (auto/forçado). Retorna `{ prepared, provider }`. Referência: `panorama-block-backend/liquid-swap-service/src/application/usecases/prepare.swap.usecase.ts:1`.
    - ExecuteSwap: desabilitado no V1 não-custodial (opcional via Engine quando `ENGINE_ENABLED=true`). Referência: `panorama-block-backend/liquid-swap-service/src/infrastructure/http/controllers/swap.controller.ts:121`.
  - HTTP e Middlewares
    - Rotas: `swap.routes.ts` (quote/tx/execute/history/status). Referência: `panorama-block-backend/liquid-swap-service/src/infrastructure/http/routes/swap.routes.ts:1`.
    - Controller: valida parâmetros obrigatórios (inclui `smartAccountAddress` no quote) e serializa `bigint` para JSON. Referência: `panorama-block-backend/liquid-swap-service/src/infrastructure/http/controllers/swap.controller.ts:1`.
    - Auth middleware: valida JWT com `auth-service` (`/auth/validate`). Referência: `panorama-block-backend/liquid-swap-service/src/middleware/authMiddleware.ts:1`.
    - HTTPS opcional (certificados), logs estruturados e Health/Root info. Referência: `panorama-block-backend/liquid-swap-service/src/index.ts:1`.

  Integrações com APIs (Thirdweb SDK e Uniswap API)

  - Thirdweb SDK (Bridge)
    - `createThirdwebClient` com `THIRDWEB_CLIENT_ID` (+ opcional `THIRDWEB_SECRET_KEY`).
    - `Bridge.Sell.quote/prepare/status` para cross-chain; `prepare` retorna `steps/transactions` com `expiresAt`. Referência: `panorama-block-backend/liquid-swap-service/src/infrastructure/adapters/thirdweb.swap.adapter.ts:1`.
    - Filtro de transações: apenas cadeia de origem executada no cliente; cadeia destino é efeito do bridge.
    - Observação de UX: approvals “exatos” podem exigir reenvio; Uniswap prioriza `MaxUint256` via Trading API.

  - Uniswap Trading API
    - Endpoints: `/quote`, `/check_approval`, `/create` (gateway `UNISWAP_API_URL`, header `x-api-key`).
    - Slippage configurável (`UNISWAP_TRADING_API_SLIPPAGE`), retry/backoff, logs detalhados (rota/hops, estimativas de gas). Referência: `uniswap.tradingapi.adapter.ts`.
    - Apenas same-chain; Universal Router (`execute(bytes,bytes[])`).

  - Uniswap Smart Router (SDK)
    - `AlphaRouter` + `@uniswap/sdk-core`, `ethers` provider estático por chain, tolerância de slippage em bps (`UNISWAP_SLIPPAGE_BPS`).
    - Apenas same-chain (rota V2/V3), quote e bundle com gas buffer (headroom). Referência: `uniswap.smartrouter.adapter.ts`.

  Variáveis de ambiente (principais)

  - Comuns: `NODE_ENV`, `DEBUG`
  - Auth: `AUTH_SERVICE_URL` (para validar JWT no swap service)
  - Thirdweb: `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY`
  - Uniswap: `UNISWAP_API_KEY`, `UNISWAP_API_URL`, `UNISWAP_TRADING_API_SLIPPAGE`
  - Smart Router: `SMART_ROUTER_QUOTE_TIMEOUT_MS`, `SMART_ROUTER_RPC_TIMEOUT_MS`, `UNISWAP_SLIPPAGE_BPS`
  - RPCs: `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `AVALANCHE_RPC_URL`, etc.
  - Engine (opcional): `ENGINE_ENABLED`, `ENGINE_URL`, `ADMIN_WALLET_ADDRESS`

  Interação entre repositórios

  - MiniApp (telegram) → Auth
    - `newchat` chama `POST /auth/login` e `POST /auth/verify` (auth-service) usando thirdweb para assinar payload, guarda `authToken` no `localStorage`. Referência: `telegram/apps/miniapp/src/app/newchat/page.tsx:114`.
  - MiniApp (telegram) → Swap
    - Chama `POST /swap/quote` e `POST /swap/tx` via gateway (proxy) com `Authorization: Bearer <token>`. O backend responde com provedor usado e bundle de transações. Referência: `telegram/apps/miniapp/src/features/swap/api.ts:173`.
  - MiniApp (telegram) → Agentes
    - `AgentsClient` conversa com `zico_agents/new_zico`, recebe resposta/metadata do `swap_agent` para conduzir a coleta de campos do swap. Referência: `telegram/apps/miniapp/src/clients/agentsClient.ts:1`.
  - Gateway (telegram)
    - Proxy transparente: `/miniapp/*` (Next) e `/swap/*` (liquid-swap-service). Healths e manifest TonConnect. Referência: `telegram/apps/gateway/src/server.ts:99`.

  UX/negócio

  - Experiência não-custodial: o backend nunca assina nem executa transações do usuário; retorna transactions/steps para assinatura local.
  - Same-chain prioriza Uniswap para melhor liquidez; cross-chain prioriza thirdweb (Bridge). Usuário assina e envia.
  - Erros user-facing no MiniApp (título, descrição, ações) mapeados a partir das respostas do backend de swap.

  Referências rápidas

  - Auth: `panorama-block-backend/auth-service/src/` (rotas e thirdwebAuth util).
  - Swap: `panorama-block-backend/liquid-swap-service/src/index.ts:1`, `.../di/container.ts:1`, `.../application/usecases/*.ts`, `.../infrastructure/adapters/*`.
  - Docs auxiliares: `THIRDWEB_IMPLEMENTATION_ANALYSIS.md`, `UNISWAP_API_AUDIT.md`, `SWAP_INTEGRATION_ROADMAP.md`.
