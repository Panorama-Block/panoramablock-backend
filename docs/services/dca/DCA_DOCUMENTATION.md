# PanoramaBlock DCA (Dollar Cost Averaging) - Documentação Completa

## 📋 Sumário

1. [Visão Geral](#visão-geral)
2. [Arquitetura do Sistema](#arquitetura-do-sistema)
3. [Componentes](#componentes)
4. [Fluxo de Funcionamento](#fluxo-de-funcionamento)
5. [API Endpoints](#api-endpoints)
6. [Estrutura de Dados](#estrutura-de-dados)
7. [Segurança](#segurança)
8. [Como Usar](#como-usar)
9. [Troubleshooting](#troubleshooting)
10. [Roadmap](#roadmap)

---

## 🎯 Visão Geral

O **PanoramaBlock DCA Service** é um sistema de Dollar Cost Averaging (DCA) automatizado para compras recorrentes de criptomoedas. Permite que usuários configurem estratégias de compra automática que são executadas periodicamente usando **Account Abstraction (ERC-4337)** e **Session Keys**.

### Principais Características

- ✅ **Compras Recorrentes Automatizadas**: Daily, Weekly, Monthly
- ✅ **Account Abstraction (ERC-4337)**: Smart Wallets com session keys
- ✅ **Execução Segura**: Session keys criptografadas, nunca expostas ao frontend
- ✅ **Swaps Reais**: Integração direta com Uniswap V3
- ✅ **Cron Job Automático**: Executa estratégias agendadas a cada minuto
- ✅ **Suporte Multi-Token**: ETH nativo e tokens ERC20
- ✅ **Histórico Completo**: Todas as execuções são registradas
- ✅ **API de Debug**: Visualização completa do estado do sistema

### Tecnologias Utilizadas

- **Backend**: Node.js + TypeScript + Express
- **Database**: Redis (porta 6380)
- **Blockchain SDK**: Thirdweb SDK v5
- **DEX**: Uniswap V3
- **Wallet**: Smart Wallets (Account Abstraction)
- **Scheduler**: node-cron

---

## 🏗 Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                       │
│  - DCA Page UI                                              │
│  - Smart Account Management                                 │
│  - Strategy Creation                                        │
└─────────────────┬───────────────────────────────────────────┘
                  │ HTTP/REST API
                  ↓
┌─────────────────────────────────────────────────────────────┐
│               DCA Service (Port 3004)                       │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  DCA Routes  │  │Transaction   │  │Smart Account │     │
│  │              │  │  Service     │  │   Service    │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                  │             │
│         └─────────────────┴──────────────────┘             │
│                           │                                │
│                           ↓                                │
│              ┌────────────────────────┐                    │
│              │   DCA Executor         │                    │
│              │   (Cron Job)           │                    │
│              │   Runs every minute    │                    │
│              └────────────────────────┘                    │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────────────────┐
│                    Redis Database                           │
│                                                             │
│  - Smart Accounts (smart-account:{address})                │
│  - DCA Strategies (dca-strategy:{id})                      │
│  - Scheduled Queue (dca-scheduled sorted set)              │
│  - Execution History (dca-history:{accountId})             │
│  - Session Keys (Encrypted)                                │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────────────────────┐
│               Blockchain Layer                              │
│                                                             │
│  - Thirdweb SDK → Smart Wallets (ERC-4337)                 │
│  - Uniswap V3 Router (0xE592427A0AEce92De3Edee1F18E0157C...) │
│  - Ethereum Mainnet, Polygon, Base, etc.                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧩 Componentes

### 1. **DCA Service** (`src/index.ts`)

Servidor Express principal que:
- Inicializa conexão com Redis
- Registra rotas de API
- Inicia o cron job automático
- Porta: `3004`

### 2. **Smart Account Service** (`src/services/smartAccount.service.ts`)

Gerencia smart wallets com session keys:
- Criação de smart accounts
- Geração e armazenamento de session keys (criptografadas)
- Validação de permissões
- Recuperação de session keys para assinatura

### 3. **DCA Service** (`src/services/dca.service.ts`)

Gerencia estratégias DCA:
- Criação de estratégias
- Listagem de estratégias por conta
- Toggle ativo/inativo
- Agendamento de execuções
- Histórico de execuções
- Cálculo de próxima execução

### 4. **Transaction Service** (`src/services/transaction.service.ts`)

Executa transações usando session keys:
- Assina transações com session key (backend-only)
- Valida permissões
- Envia User Operations via smart wallet
- Retorna transaction hash

### 5. **DCA Executor** (`src/jobs/dca.executor.ts`)

Cron job que roda a cada minuto:
- Busca estratégias prontas para executar
- Valida session keys
- Executa swaps via Uniswap V3
- Registra resultados
- Reagenda próxima execução

### 6. **DCA Routes** (`src/routes/dca.routes.ts`)

Endpoints da API:
- CRUD de smart accounts
- CRUD de estratégias DCA
- Histórico de execuções
- **Debug endpoints** (visualização do banco)
- **Execução manual** de estratégias

---

## 🔄 Fluxo de Funcionamento

### Criação de Estratégia DCA

```
1. Usuário acessa /dca page
   ↓
2. Seleciona smart wallet (ou cria uma nova)
   ↓
3. Configura swap (ETH → USDC, daily)
   ↓
4. Frontend → POST /dca/create-strategy
   {
     smartAccountId: "0x...",
     fromToken: "0x0000...",
     toToken: "0xa0b8...",
     amount: "1",
     interval: "daily"
   }
   ↓
5. Backend salva no Redis:
   - dca-strategy:{id} (hash)
   - dca-scheduled (sorted set com score = nextExecution)
   - account:strategies:{accountId} (set)
   ↓
6. Retorna strategyId e nextExecution
```

### Execução Automática (Cron Job)

```
Cron Job (a cada minuto)
   ↓
1. Busca estratégias prontas (nextExecution <= now)
   zRangeByScore('dca-scheduled', 0, now)
   ↓
2. Para cada estratégia:
   ↓
3. Recupera session key criptografada
   ↓
4. Cria conta Thirdweb com session key
   ↓
5. Conecta ao smart wallet
   ↓
6. Prepara transação Uniswap V3:
   - Se ETH: executa swap direto
   - Se ERC20: approve + swap
   ↓
7. Envia transação (User Operation)
   ↓
8. Registra no histórico:
   - txHash
   - status (success/failed)
   - timestamp
   ↓
9. Reagenda próxima execução (+24h para daily)
   ↓
10. Atualiza sorted set dca-scheduled
```

### Execução Manual (Debug)

```
POST /dca/debug/execute/{strategyId}
   ↓
1. Busca estratégia no Redis
   ↓
2. Valida se está ativa
   ↓
3. Executa swap (mesmo fluxo do cron)
   ↓
4. Retorna resultado imediato
```

---

## 📡 API Endpoints

### Base URL
```
http://localhost:3004
```

### Rotas de Produção

#### 1. **Smart Accounts**

```bash
# Criar smart account
POST /dca/create-account
Body: {
  "userId": "0x...",           # Endereço da wallet principal
  "name": "My DCA Wallet",
  "permissions": {
    "approvedTargets": ["*"],  # "*" = qualquer contrato
    "nativeTokenLimit": "0.1", # Max ETH por transação
    "durationDays": 30         # Validade do session key
  }
}
Response: {
  "smartAccountAddress": "0x...",
  "sessionKeyAddress": "0x...",
  "expiresAt": "2025-12-11T..."
}

# Listar smart accounts do usuário
GET /dca/accounts/:userId
Response: {
  "accounts": [
    {
      "address": "0x...",
      "name": "My DCA Wallet",
      "createdAt": 1234567890,
      "expiresAt": 1234567890,
      "permissions": {...}
    }
  ]
}

# Buscar smart account específica
GET /dca/account/:address

# Deletar smart account
DELETE /dca/account/:address
Body: { "userId": "0x..." }
```

#### 2. **Estratégias DCA**

```bash
# Criar estratégia DCA
POST /dca/create-strategy
Body: {
  "smartAccountId": "0x...",
  "fromToken": "0x0000000000000000000000000000000000000000", # ETH
  "toToken": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",   # USDC
  "fromChainId": 1,
  "toChainId": 1,
  "amount": "1",
  "interval": "daily" // "daily" | "weekly" | "monthly"
}
Response: {
  "strategyId": "0x...-1234567890",
  "nextExecution": "2025-11-12T05:30:00.000Z"
}

# Listar estratégias de uma smart account
GET /dca/strategies/:smartAccountId
Response: {
  "strategies": [
    {
      "smartAccountId": "0x...",
      "fromToken": "0x...",
      "toToken": "0x...",
      "amount": "1",
      "interval": "daily",
      "nextExecution": 1234567890,
      "isActive": true
    }
  ]
}

# Ativar/desativar estratégia
PATCH /dca/strategy/:strategyId/toggle
Body: { "isActive": true }

# Deletar estratégia
DELETE /dca/strategy/:strategyId

# Histórico de execuções
GET /dca/history/:smartAccountId?limit=100
Response: {
  "history": [
    {
      "timestamp": 1234567890,
      "txHash": "0x...",
      "amount": "1",
      "fromToken": "0x...",
      "toToken": "0x...",
      "status": "success"
    }
  ]
}
```

### Rotas de Debug/Admin

```bash
# Estatísticas gerais do Redis
GET /dca/debug/redis-stats
Response: {
  "stats": {
    "smartAccounts": 2,
    "strategies": 5,
    "scheduledStrategies": 3
  },
  "keys": {
    "accountKeys": ["smart-account:0x..."],
    "strategyKeys": ["dca-strategy:0x...-123"]
  }
}

# Todas as smart accounts
GET /dca/debug/all-accounts
Response: {
  "total": 2,
  "accounts": [...]
}

# Todas as estratégias DCA
GET /dca/debug/all-strategies
Response: {
  "total": 5,
  "strategies": [
    {
      "strategyId": "0x...-123",
      "smartAccountId": "0x...",
      "fromToken": "0x...",
      "toToken": "0x...",
      "amount": "1",
      "interval": "daily",
      "nextExecution": 1234567890,
      "nextExecutionDate": "2025-11-12T05:30:00.000Z",
      "isActive": true
    }
  ]
}

# Fila de execução agendada
GET /dca/debug/scheduled
Response: {
  "total": 3,
  "ready": 1,  # Quantas estão prontas agora
  "currentTime": "2025-11-11T05:30:00.000Z",
  "scheduled": [
    {
      "strategyId": "0x...-123",
      "nextExecution": 1234567890,
      "nextExecutionDate": "2025-11-12T05:30:00.000Z",
      "isReady": false
    }
  ]
}

# Todo o histórico de execuções
GET /dca/debug/all-history
Response: {
  "total": 50,
  "history": [...]
}

# ⭐ EXECUTAR ESTRATÉGIA MANUALMENTE
POST /dca/debug/execute/:strategyId
Response: {
  "success": true,
  "execution": {
    "strategyId": "0x...-123",
    "txHash": "0xabc123...",
    "timestamp": 1234567890,
    "amount": "1",
    "fromToken": "0x...",
    "toToken": "0x..."
  },
  "nextExecution": {
    "timestamp": 1234567890,
    "date": "2025-11-12T05:30:00.000Z"
  }
}
```

---

## 📊 Estrutura de Dados

### Redis - Estruturas

#### 1. Smart Account
```
Key: smart-account:{address}
Type: Hash
Fields:
  - userId: "0x..."
  - name: "My DCA Wallet"
  - sessionKeyAddress: "0x..."
  - createdAt: "1234567890"
  - expiresAt: "1234567890"
  - permissions: JSON string
```

#### 2. Session Key (Encrypted)
```
Key: session-key:{smartAccountAddress}
Type: String
Value: Encrypted private key (AES-256)
```

#### 3. DCA Strategy
```
Key: dca-strategy:{strategyId}
Type: Hash
Fields:
  - smartAccountId: "0x..."
  - fromToken: "0x..."
  - toToken: "0x..."
  - fromChainId: "1"
  - toChainId: "1"
  - amount: "1"
  - interval: "daily"
  - lastExecuted: "1234567890"
  - nextExecution: "1234567890"
  - isActive: "true"
```

#### 4. Scheduled Queue
```
Key: dca-scheduled
Type: Sorted Set
Members: strategyId
Scores: nextExecution (timestamp)

Exemplo:
  "0x...-123" → 1234567890
  "0x...-456" → 1234567900
```

#### 5. Account Strategies Index
```
Key: account:strategies:{smartAccountId}
Type: Set
Members: strategyId's

Exemplo:
  "0x...-123"
  "0x...-456"
```

#### 6. Execution History
```
Key: dca-history:{smartAccountId}
Type: List
Values: JSON strings (máximo 100 registros)

Exemplo:
[
  "{\"timestamp\":1234567890,\"txHash\":\"0x...\",\"status\":\"success\",...}",
  "{\"timestamp\":1234567800,\"txHash\":\"0x...\",\"status\":\"failed\",...}"
]
```

---

## 🔒 Segurança

### Session Keys

- **Nunca expostas ao frontend**: Session keys são geradas e armazenadas exclusivamente no backend
- **Criptografia AES-256**: Armazenadas criptografadas no Redis
- **Password-based encryption**: Usa `ENCRYPTION_PASSWORD` do `.env`
- **Permissões limitadas**:
  - Approved targets (contratos permitidos)
  - Native token limit (máximo ETH por transação)
  - Time window (validade temporal)

### Validações

1. **Ownership**: Apenas o dono da smart account pode criar estratégias
2. **Session key expiration**: Estratégias são pausadas se session key expirou
3. **Permission checks**: Toda transação valida targets e limites
4. **Amount validation**: Verifica se está dentro do limite permitido

### Environment Variables

```bash
# Obrigatórias
THIRDWEB_SECRET_KEY=xxx       # Thirdweb API secret
ENCRYPTION_PASSWORD=xxx       # Para criptografar session keys
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASS=xxx

# Opcionais
DCA_PORT=3004
NODE_ENV=development
```

---

## 🚀 Como Usar

### 1. Setup do Ambiente

```bash
cd panorama-block-backend/dca-service

# Instalar dependências
npm install

# Configurar .env
cp .env.example .env
# Editar .env com suas credenciais

# Verificar Redis
docker ps | grep redis

# Iniciar serviço
npm run dev
```

### 2. Criar Smart Account (Frontend)

```typescript
// Frontend: /app/account/page.tsx
const result = await createSmartAccount({
  userId: account.address,
  name: "My DCA Wallet",
  permissions: {
    approvedTargets: ["*"],
    nativeTokenLimit: "0.1",
    durationDays: 30
  }
});

console.log("Smart Account:", result.smartAccountAddress);
```

### 3. Criar Estratégia DCA (Frontend)

```typescript
// Frontend: /app/dca/page.tsx
const result = await createStrategy({
  smartAccountId: "0x...",
  fromToken: "0x0000000000000000000000000000000000000000", // ETH
  toToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",   // USDC
  fromChainId: 1,
  toChainId: 1,
  amount: "0.01",
  interval: "daily"
});

console.log("Next execution:", result.nextExecution);
```

### 4. Enviar ETH para Smart Account

```bash
# A smart account precisa de ETH para:
# - Pagar gas das transações
# - Fazer o swap (amount + gas)

# Exemplo: enviar 1.1 ETH
# - 1.0 ETH para swap
# - 0.1 ETH para gas
```

### 5. Executar Manualmente (Testing)

```bash
# Buscar ID da estratégia
curl http://localhost:3004/dca/debug/all-strategies | jq '.strategies[0].strategyId'

# Executar
curl -X POST http://localhost:3004/dca/debug/execute/{strategyId}
```

### 6. Verificar Histórico

```bash
# Histórico de uma smart account
curl http://localhost:3004/dca/history/{smartAccountAddress}

# Todo o histórico
curl http://localhost:3004/dca/debug/all-history
```

---

## 🔍 Troubleshooting

### Erro: "Session key expired"

**Causa**: Session key passou da data de expiração
**Solução**: Criar nova smart account ou estender permissões

### Erro: "Insufficient funds for gas"

**Causa**: Smart account não tem ETH suficiente
**Solução**: Enviar ETH para a smart account

### Erro: "Strategy not found"

**Causa**: StrategyId inválido ou foi deletado
**Solução**: Verificar ID com `GET /dca/debug/all-strategies`

### Erro: "Target not approved"

**Causa**: Contrato não está na lista de approved targets
**Solução**: Criar smart account com `approvedTargets: ["*"]` ou adicionar endereço específico

### Cron job não está executando

**Causa**: Serviço não iniciou corretamente
**Solução**:
```bash
# Verificar logs
tail -f /tmp/dca-service.log

# Verificar se cron iniciou
grep "DCA Executor" /tmp/dca-service.log
```

### Swap está falhando

**Causa**: Pode ser slippage, liquidez, ou endereço incorreto
**Solução**: Verificar logs detalhados:
```bash
curl -X POST http://localhost:3004/dca/debug/execute/{id} 2>&1 | jq
tail -50 /tmp/dca-service.log
```

---

## 🗺 Roadmap

### ✅ Concluído

- [x] Sistema de smart accounts com session keys
- [x] CRUD de estratégias DCA
- [x] Cron job automático
- [x] Execução de swaps via Uniswap V3
- [x] Suporte para ETH e ERC20
- [x] Histórico de execuções
- [x] API de debug completa
- [x] Execução manual para testing

### 🚧 Em Desenvolvimento

- [ ] Integração com DEX aggregators (melhor preço)
- [ ] Cálculo automático de slippage
- [ ] Suporte para cross-chain swaps
- [ ] Notificações (email/telegram) de execuções
- [ ] Dashboard web para admin

### 📋 Planejado

- [ ] Estratégias mais complexas (buy the dip, stop loss)
- [ ] Gasless transactions (sponsored gas)
- [ ] Multi-token swaps em uma estratégia
- [ ] Analytics e relatórios de performance
- [ ] Integração com Thirdweb Engine
- [ ] Suporte para mais DEXs (Curve, 1inch)

---

## 📞 Suporte

### Logs do Sistema

```bash
# DCA Service logs
tail -f /tmp/dca-service.log

# Grep por erros
grep "ERROR\|❌" /tmp/dca-service.log

# Grep por execuções
grep "executeSwap" /tmp/dca-service.log
```

### Comandos Úteis

```bash
# Status do Redis
docker exec panorama-redis redis-cli -a Zico100x ping

# Verificar chaves no Redis
docker exec panorama-redis redis-cli -a Zico100x keys "dca-*"

# Ver estratégia específica
docker exec panorama-redis redis-cli -a Zico100x hgetall "dca-strategy:{id}"

# Ver fila agendada
docker exec panorama-redis redis-cli -a Zico100x zrange dca-scheduled 0 -1 WITHSCORES

# Limpar todas as estratégias (CUIDADO!)
docker exec panorama-redis redis-cli -a Zico100x --scan --pattern "dca-*" | xargs -L 1 docker exec -i panorama-redis redis-cli -a Zico100x del
```

### Health Checks

```bash
# DCA Service
curl http://localhost:3004/health

# Redis
docker exec panorama-redis redis-cli -a Zico100x ping

# Estatísticas
curl http://localhost:3004/dca/debug/redis-stats | jq
```

---

## 📄 Licença

MIT License - PanoramaBlock 2025

---

**Documentação gerada em**: 2025-11-11
**Versão**: 1.0.0
**Autor**: PanoramaBlock Team
