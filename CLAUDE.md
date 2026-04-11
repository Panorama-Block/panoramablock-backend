# CLAUDE.md — Panorama Block Backend

> Este arquivo é destinado ao agente de código (Claude Code) e ao desenvolvedor que for rodar os testes localmente antes do deploy em produção.
> Gerado após sessão de saneamento de código em 2026-04-11.

---

## O que é este repositório

Backend microservices do ecossistema Panorama Block — plataforma DeFi servida como Telegram MiniApp. Este repo faz parte de um ecossistema com 4 repositórios:

```
panorama/
├── panorama-block-backend   ← ESTE REPO — Backend microservices
├── execution-layer          ← Smart contracts + adapter layer (Solidity + Node.js)
├── telegram/
│   ├── apps/miniapp         ← Frontend Next.js (Telegram MiniApp)
│   └── apps/gateway         ← Telegram Bot + API reverse proxy
└── zico_agents              ← Sistema de agentes AI (Zico)
```

---

## Arquitetura dos Serviços Ativos

Após o saneamento de 2026-04-11, os serviços ativos são:

| Serviço | Porta | Responsabilidade |
|---------|-------|-----------------|
| `auth-service` | 3001 | JWT, TON proof, Telegram ID linking. **Dependência crítica de todos os outros.** |
| `liquid-swap-service` | 3002 | Aggregator de swap EVM. Integra Uniswap Trading API + Thirdweb. Chama execution-layer para Aerodrome quotes. |
| `bridge-service` | 3003 (host) / 3005 (container) | Bridge TON ↔ EVM via LayerSwap. Único handler para operações envolvendo TON chain. |
| `lido-service` | 3004 | Liquid staking Ethereum via Lido (stETH/wstETH). Execução via Thirdweb Engine. |
| `lending-service` | 3007 | Lending/borrowing Benqi (Avalanche). Proxy para execution-layer. |
| `dca-service` | 3008 | DCA com cron executor. Smart account (custodial) + DCAVault Base chain (non-custodial). |
| `database` (gateway) | 8080 | API REST sobre Postgres — fonte de dados históricos centralizada. |

**Infraestrutura de suporte:**
- `shared/token-registry.json` — Registro de tokens compartilhado por `liquid-swap-service` e `bridge-service`
- Redis — usado por `auth-service` (sessões) e `dca-service` (filas)
- PostgreSQL — usado por `bridge-service`, `lido-service`, `dca-service`, `database`
- Thirdweb Engine — usado por `lido-service`, `dca-service`, `bridge-service`

---

## Fluxo de Dados (exemplos)

### Swap EVM
```
miniapp SwapWidget
  → POST /swap/quote        → liquid-swap-service
    → Uniswap Trading API  (externo)
    → GET /provider/swap   → execution-layer:3011 → Aerodrome (Base)
  → POST /swap/tx           → liquid-swap-service
    → Thirdweb SDK (prepara tx, usuário assina)
```

### Swap TON ↔ EVM
```
miniapp SwapWidget (detecta TON_CHAIN_ID em provider.ts)
  → POST /bridge/quote      → bridge-service
    → LayerSwap API         (externo)
  → POST /bridge/transaction
```

### Lending Benqi
```
miniapp Lending.tsx
  → GET  /benqi/markets     → lending-service → execution-layer:/avax/lending/markets
  → POST /benqi-validation/validateAndSupply → lending-service → execution-layer:/avax/lending/prepare-supply
```

### DCA
```
miniapp DCA.tsx
  → POST /dca/create-strategy → dca-service (salva no Postgres)
  → cron executor interno (roda a cada minuto) → executa swap via Thirdweb Engine
  → POST /dca/vault/prepare-create → dca-service → execution-layer:/dca/prepare-create → DCAVault.sol
```

---

## O que foi feito na sessão de saneamento (2026-04-11)

### Fase 1 — Arquivos órfãos removidos (20 arquivos)

| Arquivo | Categoria |
|---------|-----------|
| `dca-service/src/services/auditLog.service.old.ts` | Código morto (.old) |
| `dca-service/src/services/dca.service.old.ts` | Código morto (.old) |
| `dca-service/src/services/smartAccount.service.old.ts` | Código morto (.old) |
| `liquid-swap-service/comparison-result.json` | Artefato de teste commitado (19.6 KB) |
| `liquid-swap-service/test-integration.ts` | Script manual ad-hoc |
| `liquid-swap-service/test-routing.ts` | Script manual ad-hoc |
| `liquid-swap-service/test-uniswap.ts` | Script manual ad-hoc |
| `liquid-swap-service/test-registry-load.ts` | Script manual ad-hoc |
| `liquid-swap-service/test-world-chain.ts` | Script manual ad-hoc |
| `lido-service/tests/blockchain-test.sh` | Shell script ad-hoc |
| `lido-service/tests/final-test.sh` | Shell script ad-hoc |
| `lido-service/tests/real-blockchain-test.sh` | Shell script ad-hoc |
| `lido-service/tests/simple-test.sh` | Shell script ad-hoc |
| `lido-service/tests/token-test.sh` | Shell script ad-hoc |
| `lido-service/tests/quick-test.sh` | Shell script ad-hoc |
| `lido-service/tests/test-lido-api.sh` | Shell script ad-hoc |
| `lending-service/update-validation-contract.sh` | Script de manutenção one-off |
| `docs/gaps/SWAP_INTEGRATION_ROADMAP.md` | Draft vazio (nunca completado) |
| `docs/gaps/THIRDWEB_IMPLEMENTATION_ANALYSIS.md` | Draft vazio (nunca completado) |
| `docs/gaps/UNISWAP_API_AUDIT.md` | Draft vazio (nunca completado) |

### Fase 2 — Serviços legados removidos

| Serviço | Razão da remoção |
|---------|-----------------|
| `avax-service/` | Superconjunto absorvido pelo `lending-service` + `execution-layer`. Zero referências no frontend ou qualquer compose. Porta 3001 entrou em colisão com `auth-service`. `benqiValidationRoutes` referenciado mas nunca criado — implementação abandonada. |
| `diagram-service/` | Frontend nunca chamou a API. O diagrama arquitetural em `architecture-diagram.tsx` é 100% client-side (React Flow hardcoded). Serviço tinha schema Prisma ambicioso (agentes, DCA, wallet tracking) mas implementou apenas CRUD de nodes/edges. |
| `wallet-tracker-service/` | Go service. Portfolio migrou para Thirdweb SDK direto no frontend + serviços de protocolo individuais. Ausente do docker-compose de dev. Último commit: 2025-12-02. Dependia de MongoDB que nunca existiu no stack. |

**CI/CD corrigido junto com a Fase 2:**
- `.github/workflows/deploy-vm-backend.yml` — `diagram-service` removido do build matrix e do `SERVICES` no deploy step
- `.github/workflows/deploy-vm-diagram-service.yml` — workflow manual deletado

### Fase 3 — PENDENTE (não executada)

Referências stale em arquivos de infraestrutura que apontam para serviços removidos. **Não causam falha em produção agora** (serviços já não sobem), mas devem ser limpas antes do próximo deploy:

| Arquivo | Referência stale | Impacto se não limpo |
|---------|-----------------|---------------------|
| `docker-compose.yml` (local) | `diagram_service` com `build: context: ./diagram-service` | `docker compose up` falha localmente (contexto de build não existe) |
| `docker-compose-deploy.yml` (raiz) | `wallet_tracker_service` com `context: ./wallet-tracker-service` | Idem acima |
| `deploy/azure-vm/docker-compose.yml` | bloco `diagram_service` completo | Pull de imagem falha no próximo deploy Azure VM |
| `deploy/azure-vm/docker-compose.heavy.yml` | bloco `diagram_service` | Idem |
| `deploy/azure-vm/caddy/Caddyfile` | rota `/diagram*` → porta 3010 | 502 para rota sem serviço (ninguém chama, mas rota existe) |
| `deploy/public-api-vm/caddy/Caddyfile` | rota `/diagram*` → HEAVY_VM_BACKHAUL | Idem |
| `infra/container-apps/bridge-service.yaml` | `avax-service-url` env var | Inofensivo — campo `optional()` no Zod do bridge-service, nunca lido |

---

## Testes obrigatórios antes do deploy em produção

### Testes automatizados (rodar na máquina)

```bash
# T01 — Confirmar zero referências aos serviços removidos no backend ativo
grep -rn "avax.service\|diagram.service\|wallet.tracker" \
  auth-service bridge-service dca-service lending-service lido-service liquid-swap-service shared \
  --include="*.ts" --include="*.js" --exclude-dir=node_modules
# Esperado: zero resultados

# T02 — Confirmar que workflows CI não referenciam serviços removidos
grep -rn "avax\|diagram_service\|wallet.tracker" .github/workflows/
# Esperado: apenas "avax-rpc-url" e "avax-executor-address" (credenciais do execution-layer, não do avax-service)

# T03 — Health check de todos os serviços ativos (rodar cada um isolado)
curl http://localhost:3001/health  # auth-service
curl http://localhost:3002/health  # liquid-swap-service
curl http://localhost:3003/health  # bridge-service (porta host)
curl http://localhost:3004/health  # lido-service
curl http://localhost:3007/health  # lending-service
curl http://localhost:3008/health  # dca-service
curl http://localhost:8080/health  # database-gateway

# T04 — Endpoint público lending (não requer auth)
curl http://localhost:3007/benqi/markets
# Esperado: JSON com lista de mercados Benqi

# T05 — Endpoint público lido (não requer auth)
curl http://localhost:3004/api/lido/protocol/info
# Esperado: JSON com APY e dados do protocolo Lido

# T06 — Endpoint de quote swap (não requer auth)
curl -X POST http://localhost:3002/swap/quote \
  -H "Content-Type: application/json" \
  -d '{"fromToken":"0x4200000000000000000000000000000000000006","toToken":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","amount":"1000000000000000000","chainId":8453}'
# Esperado: JSON com cotação de ETH→USDC na Base
```

### Testes manuais (com frontend rodando localmente ou apontado para staging)

**TM01 — Autenticação**
1. Faça login com carteira EVM (ThirdWeb)
2. Faça login com TON wallet
3. Verifique que JWT é emitido e rotas protegidas funcionam
4. Network tab: chamadas devem ir para `/auth/*` → porta 3001
- Critério: login completa sem erro 401/502

**TM02 — Swap EVM**
1. Abra a página de Swap
2. Execute cotação ETH→USDC na Base chain
3. Network tab: confirmar chamadas para `/api/swap/*` — **não** para `/dex/*` (era avax-service)
- Critério: cotação retorna, preparação de tx funciona

**TM03 — Lending Benqi**
> Cenário de maior risco — avax-service tinha as rotas Benqi originais.
1. Acesse `/lending`
2. Verifique que mercados Benqi carregam
3. Verifique posição do usuário
4. Network tab: chamadas devem ir para `/api/lending/*` → porta 3007
- Critério: mercados e posições carregam sem 404/502

**TM04 — Diagrama de Arquitetura**
1. Acesse `/docs` no miniapp
2. Diagrama de arquitetura deve renderizar com nós e arestas
3. Network tab: **zero chamadas** para `/diagram`, `/api/diagram` ou porta 3010
- Critério: renderiza client-side sem nenhum request de rede para backend

**TM05 — Documentation Hub**
1. Acesse `/documentation`
2. Clique em "Open Official Documentation"
3. Deve abrir `https://docs.panoramablock.com` (GitBook externo) em nova aba
4. Clique em "Architecture Diagram" → deve ir para `/docs` (interno)
- Critério: GitBook abre corretamente, sem chamada para diagram-service

**TM06 — Portfolio / Saldo de Carteira**
1. Faça login e acesse tela de portfolio
2. Saldos EVM e TON devem carregar
3. Network tab: saldos vêm de Thirdweb SDK / RPC direto — **não** de `/api/wallets/*` (era wallet-tracker)
- Critério: portfolio carrega sem chamada para `/api/wallets/details`

**TM07 — DCA (regressão geral)**
1. Acesse `/dca`
2. Verifique listagem de estratégias
3. Crie uma estratégia de teste
4. Verifique histórico de execuções
- Critério: DCA funciona sem regressão

---

## Como rodar serviços em isolado (máquina sem recursos para o stack completo)

### Serviços que sobem sem infra adicional

```bash
# lido-service — tem .env completo com credenciais reais
cd lido-service && npm install && npm run dev
# Endpoints públicos disponíveis em http://localhost:3004

# lending-service — tem .env mas AUTH_SERVICE_URL está com devtunnel expirado
# Corrigir antes de subir:
# AUTH_SERVICE_URL=http://localhost:3001  (no .env)
cd lending-service && npm install && node index.js
# Endpoints públicos (/benqi/markets, /health) disponíveis em http://localhost:3007

# liquid-swap-service — tem .env completo e bem documentado
cd liquid-swap-service && npm install && npm run dev
# Cotações disponíveis em http://localhost:3002 (sem auth)
```

### Serviços que precisam de Redis

```bash
# Subir só o Redis do compose (leve)
docker compose up redis -d

# Depois subir auth-service
# ATENÇÃO: auth-service não tem .env nem .env.example
# Precisa criar .env com as variáveis extraídas do código:
# JWT_SECRET, AUTH_PRIVATE_KEY, REDIS_HOST, REDIS_PORT, REDIS_PASS,
# TON_JWT_SECRET, TON_JWT_ISSUER, TON_JWT_AUDIENCE, TON_PROOF_DOMAIN,
# AUTH_DOMAIN, CORS_ORIGIN
```

### Stack mínimo recomendado (auth + serviço alvo)

```bash
# Sobe redis + auth + o serviço que quer testar (sem engine, sem postgres pesado)
docker compose up redis auth_service lending_service --no-deps
```

---

## Estado dos arquivos .env por serviço

| Serviço | Arquivo | Observação |
|---------|---------|-----------|
| `auth-service` | Nenhum | Precisa criar do zero. Ver variáveis em `src/index.ts` e `src/routes/auth.ts` |
| `bridge-service` | `.env.example` (78 linhas) | Precisa de `LAYERSWAP_API_KEY` real. Contém `AVAX_SERVICE_URL` stale (inofensivo — campo `optional()`) |
| `dca-service` | `.env.example` (28 linhas) | Precisa de Redis + PostgreSQL + ThirdWeb credentials reais |
| `lending-service` | `.env` | `AUTH_SERVICE_URL` aponta para devtunnel expirado — corrigir para `http://localhost:3001` |
| `lido-service` | `.env` | Completo com credenciais reais. Pronto para rodar. |
| `liquid-swap-service` | `.env` | Completo e bem documentado com comentários. Pronto para rodar. |

---

## Dual-track de CI/CD

| Workflow prefix | Deploya para | Mecanismo |
|----------------|-------------|-----------|
| `deploy-*.yml` | Azure Container Apps | GHCR image push → Container App update |
| `deploy-vm-*.yml` | Azure VM (heavy) | SSH → docker compose pull & restart |

Serviços no Container Apps: `auth`, `bridge`, `liquid-swap`, `lido`, `lending`, `dca`, `database-gateway`
Serviços na VM (heavy): `redis`, `engine`, `execution-layer`, `database-gateway`, `dca`

---

## Dependências externas críticas

| Serviço externo | Usado por | Propósito |
|----------------|-----------|-----------|
| Thirdweb Engine | `bridge-service`, `lido-service`, `dca-service` | Execução de transações via smart accounts |
| Thirdweb SDK | `liquid-swap-service`, frontend | Cotação e preparação de swaps |
| Uniswap Trading API | `liquid-swap-service` | Cotações de swap EVM |
| LayerSwap API | `bridge-service` | Bridge TON ↔ EVM |
| Ankr RPC (ETH) | `lido-service` | Leitura de contratos Lido no mainnet |
| Avalanche RPC | `lending-service`, `execution-layer` | Interação com Benqi |
| Base RPC | `liquid-swap-service`, `execution-layer` | Aerodrome swaps e DCAVault |
| CoinGecko API | Frontend (portfolio) | Preços de tokens |
| GitBook | Frontend (documentation) | Docs externas em `docs.panoramablock.com` |
