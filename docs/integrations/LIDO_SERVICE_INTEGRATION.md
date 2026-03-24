# Lido Service - Integração com Auth Centralizado

## 📋 Resumo

O **Lido Service** foi integrado ao ecossistema Docker do panorama-block-backend e agora usa o **mesmo fluxo de autenticação centralizado** do `liquid-swap-service`, através do `auth-service`.

> English version: `panorama-block-backend/LIDO_SERVICE_INTEGRATION_EN.md`

## 🎯 O que mudou?

### Antes ❌
- Lido Service tinha seu próprio JWT Service interno
- Rotas de autenticação próprias em `/api/lido/auth/*`
- JWT tokens gerados e validados localmente
- Não estava no docker-compose.yml

### Agora ✅
- **Autenticação centralizada** via `auth-service`
- **Mesma validação JWT** que o `liquid-swap-service`
- **JWT tokens compartilhados** entre todos os serviços
- **Totalmente integrado** ao Docker Compose
- **Sobe automaticamente** com `docker-compose up`

---

## 🚀 Como usar

### 1. Subir todos os serviços

```bash
docker-compose up --build
```

Todos os serviços subirão automaticamente:
- ✅ Redis (Port 6380)
- ✅ PostgreSQL Engine (Port 5433)
- ✅ ThirdWeb Engine (Port 3005)
- ✅ Auth Service (Port 3001)
- ✅ Liquid Swap Service (Port 3002)
- ✅ **Lido Service (Port 3004)** ← NOVO!

### 2. Autenticar (SIWE - Sign-In With Ethereum)

O fluxo de autenticação é **exatamente igual** para todos os serviços:

#### Passo 1: Obter payload para assinatura
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0xYourWalletAddress"
  }'
```

**Resposta:**
```json
{
  "payload": {
    "domain": "panoramablock.com",
    "address": "0xYourWalletAddress",
    "statement": "Sign in to PanoramaBlock",
    "uri": "...",
    "version": "1",
    "chainId": "1",
    "nonce": "...",
    "issuedAt": "...",
    "expirationTime": "..."
  }
}
```

#### Passo 2: Assinar payload com wallet
```javascript
// No frontend (usando ethers.js, web3.js, etc)
const signature = await signer.signMessage(payloadString);
```

#### Passo 3: Verificar assinatura e obter JWT
```bash
curl -X POST http://localhost:3001/auth/verify \
  -H "Content-Type: application/json" \
  -d '{
    "payload": { ... },
    "signature": "0x..."
  }'
```

**Resposta:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "address": "0xYourWalletAddress",
  "sessionId": "base64..."
}
```

**Importante:** Também recebe um **refresh cookie** (`panorama_refresh`) com validade de 14 dias.

### 3. Usar Lido Service com JWT

Agora use o JWT obtido no **Authorization header**:

#### Exemplo: Stake ETH
```bash
curl -X POST http://localhost:3004/api/lido/stake \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "userAddress": "0xYourWalletAddress",
    "amount": "1.0"
  }'
```

> Nota sobre unidades:
> - **Inputs** (`stake/unstake`): `amount` é uma string em **ETH/stETH** (ex.: `"0.01"`, `"1.5"`).
> - **Outputs** (`position/protocol/history`): valores monetários são retornados como **wei strings** para padronização.

#### Exemplo: Obter posição de staking
```bash
curl -X GET http://localhost:3004/api/lido/position/0xYourWalletAddress \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

#### Exemplo: Withdrawals (Withdrawal Queue)
Listar requests:
```bash
curl -X GET http://localhost:3004/api/lido/withdrawals/0xYourWalletAddress \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Claim (quando `isFinalized=true` e `isClaimed=false`):
```bash
curl -X POST http://localhost:3004/api/lido/withdrawals/claim \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "userAddress": "0xYourWalletAddress",
    "requestIds": ["123456"]
  }'
```

#### Exemplo: Tracking de tx (non-custodial)
Depois que o frontend envia a transação, informe o hash para o backend persistir e permitir histórico/status:
```bash
curl -X POST http://localhost:3004/api/lido/transaction/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "id": "tx_...",
    "userAddress": "0xYourWalletAddress",
    "transactionHash": "0x..."
  }'
```

---

## 🔐 Fluxo de Autenticação Detalhado

```
┌──────────────┐
│   Cliente    │
│  (Frontend)  │
└──────┬───────┘
       │
       │ 1. POST /auth/login
       │    { address: "0x..." }
       ▼
┌──────────────────────────┐
│   Auth Service (3001)    │
│                          │
│  - Gera payload SIWE     │
│  - ThirdWeb Auth SDK     │
└──────────┬───────────────┘
           │
           │ 2. Retorna payload
           ▼
┌──────────────┐
│   Cliente    │
│              │
│  - Assina    │
│    payload   │
│    com       │
│    wallet    │
└──────┬───────┘
       │
       │ 3. POST /auth/verify
       │    { payload, signature }
       ▼
┌──────────────────────────┐
│   Auth Service (3001)    │
│                          │
│  - Valida assinatura     │
│  - Gera JWT              │
│  - Salva no Redis        │
│  - Set refresh cookie    │
└──────────┬───────────────┘
           │
           │ 4. Retorna JWT + sessionId
           ▼
┌──────────────┐
│   Cliente    │
│              │
│  JWT token   │
│  armazenado  │
└──────┬───────┘
       │
       ├─────────────────────────────────┬──────────────────────────┐
       │                                 │                          │
       │ 5. Request c/ JWT               │ 5. Request c/ JWT        │
       ▼                                 ▼                          ▼
┌─────────────────┐            ┌─────────────────┐      ┌─────────────────┐
│  Liquid Swap    │            │  Lido Service   │      │  Outros         │
│  Service (3002) │            │  (3004)         │      │  Services       │
│                 │            │                 │      │                 │
│  - Recebe JWT   │            │  - Recebe JWT   │      │  - Recebe JWT   │
│  - Valida via   │            │  - Valida via   │      │  - Valida via   │
│    auth-service │            │    auth-service │      │    auth-service │
└─────────┬───────┘            └─────────┬───────┘      └─────────┬───────┘
          │                              │                        │
          │ 6. POST /auth/validate       │ 6. POST /auth/validate │
          │    { token: "..." }          │    { token: "..." }    │
          └──────────────┬───────────────┴────────────────────────┘
                         ▼
                  ┌──────────────────────────┐
                  │   Auth Service (3001)    │
                  │                          │
                  │  - Verifica JWT          │
                  │  - Checa Redis           │
                  │  - Retorna payload       │
                  └──────────┬───────────────┘
                             │
                             │ 7. { isValid: true, payload: {...} }
                             ▼
                  ┌──────────────────────────┐
                  │   Serviços (3002, 3004)  │
                  │                          │
                  │  - req.user = payload    │
                  │  - Executa ação          │
                  │  - Retorna resposta      │
                  └──────────────────────────┘
```

---

## 🔧 Arquitetura Técnica

### AuthMiddleware (Lido Service)

**Localização:** `lido-service/src/infrastructure/http/middleware/auth.ts`

```typescript
export class AuthMiddleware {
  static async authenticate(req: Request, res: Response, next: NextFunction) {
    // 1. Extrai JWT do header Authorization
    const token = req.headers.authorization?.split(' ')[1];

    // 2. Valida com auth-service centralizado
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    const response = await axios.post(`${authServiceUrl}/auth/validate`, { token });

    // 3. Se válido, adiciona user ao request
    if (response.data.isValid) {
      req.user = response.data.payload;
      next();
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}
```

**Fluxo:**
1. ✅ Recebe token do cliente
2. ✅ Faz POST para `auth-service/auth/validate`
3. ✅ Auth service verifica JWT e checa Redis
4. ✅ Retorna `{ isValid: true, payload: {...} }`
5. ✅ Middleware adiciona `req.user` e continua
6. ✅ Controller acessa `req.user.address`

### Rotas Protegidas

**Localização:** `lido-service/src/infrastructure/http/routes/lidoRoutes.ts`

```typescript
// Requer autenticação
router.post('/stake',
  AuthMiddleware.authenticate,  // ← Valida JWT com auth-service
  (req, res) => controller.stake(req, res)
);

// Autenticação opcional
router.get('/position/:userAddress',
  AuthMiddleware.optionalAuth,  // ← JWT opcional
  (req, res) => controller.getPosition(req, res)
);

// Public
router.get('/protocol/info',
  (req, res) => controller.getProtocolInfo(req, res)
);
```

---

## 🐳 Docker Configuration

### docker-compose.yml (Desenvolvimento)

```yaml
lido_service:
  build:
    context: ./lido-service
    dockerfile: Dockerfile
  container_name: panorama-lido-service
  ports:
    - "${LIDO_PORT:-3004}:3004"
  environment:
    - PORT=3004
    - AUTH_SERVICE_URL=http://auth_service:3001  # ← Comunicação interna
    - ETHEREUM_RPC_URL=${ETHEREUM_RPC_URL}
    - ENGINE_URL=http://engine:3005
    - ENGINE_ENABLED=${ENGINE_ENABLED}
  depends_on:
    auth_service:
      condition: service_started
    engine:
      condition: service_started
  restart: always
```

### docker-compose-deploy.yml (Produção)

```yaml
lido_service:
  build:
    context: ./lido-service
    dockerfile: Dockerfile
  container_name: panorama-lido-service
  ports:
    - "${LIDO_PORT:-3004}:3004"
  environment:
    - AUTH_SERVICE_URL=https://auth_service:3001  # ← HTTPS em produção
    - FULLCHAIN=${FULLCHAIN}
    - PRIVKEY=${PRIVKEY}
    - FORCE_HTTPS=${FORCE_HTTPS}
  volumes:
    - /etc/letsencrypt:/etc/letsencrypt:ro  # ← SSL certs
  depends_on:
    auth_service:
      condition: service_started
    engine:
      condition: service_started
  restart: always
```

---

## 📊 Endpoints do Lido Service

### Públicos (Sem autenticação)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/health` | Health check |
| `GET` | `/` | Informações do serviço |
| `GET` | `/api/lido/protocol/info` | Dados do protocolo Lido (APY, total staked, etc) |
| `GET` | `/api/lido/transaction/:txHash` | Status de transação |

### Protegidos (Requer JWT)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/lido/stake` | Fazer stake de ETH |
| `POST` | `/api/lido/unstake` | Unstake de stETH |
| `POST` | `/api/lido/claim-rewards` | Legacy/no-op (stETH é rebasing; não existe “claim” clássico) |
| `POST` | `/api/lido/withdrawals/claim` | Claim de withdrawals finalizados |
| `POST` | `/api/lido/transaction/submit` | Registrar `txHash` para histórico/status |

### Opcionais (JWT opcional)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/lido/position/:userAddress` | Posição de staking do usuário |
| `GET` | `/api/lido/history/:userAddress` | Histórico de transações |
| `GET` | `/api/lido/portfolio/:userAddress` | Snapshot (assets + métricas diárias), `?days=30` |
| `GET` | `/api/lido/withdrawals/:userAddress` | Withdrawal Queue requests + status |

---

## ⚙️ Variáveis de Ambiente

### .env

```bash
# Portas
LIDO_PORT=3004

# Auth Service (usado para validação JWT)
AUTH_SERVICE_URL=http://auth_service:3001  # Dev
# AUTH_SERVICE_URL=https://auth_service:3001  # Prod

# Ethereum RPC
ETHEREUM_RPC_URL=https://rpc.ankr.com/eth/f7bf95c709760fc...
RPC_URL=https://rpc.ankr.com/eth/f7bf95c709760fc...

# Postgres (opcional; habilita persistência + portfolio)
# DATABASE_URL=postgresql://user:pass@engine_postgres:5432/engine
LIDO_DB_SCHEMA=lido

# ThirdWeb Engine (ERC-4337)
ENGINE_URL=http://engine:3005
ENGINE_ENABLED=true
ENGINE_ACCESS_TOKEN=...
ADMIN_WALLET_ADDRESS=0x47e6EF14c703af11654D629624D27d349A4ab964
```

---

## 🧪 Testando a Integração

### 1. Testar Health Check

```bash
curl http://localhost:3004/health
```

**Resposta esperada:**
```json
{
  "status": "healthy",
  "service": "lido-service",
  "timestamp": "2024-11-07T12:00:00.000Z",
  "version": "1.0.0",
  "authServiceUrl": "http://auth_service:3001",
  "features": {
    "authentication": "centralized (auth-service)",
    "staking": true,
    "protocolInfo": true
  }
}
```

### 2. Testar Autenticação Completa

```bash
# 1. Login (obter payload)
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"address":"0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"}'

# 2. [Assinar payload com wallet]

# 3. Verify (obter JWT)
curl -X POST http://localhost:3001/auth/verify \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {...},
    "signature": "0x..."
  }'

# 4. Usar JWT no Lido Service
export JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3004/api/lido/position/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb \
  -H "Authorization: Bearer $JWT"
```

### 3. Verificar Logs

```bash
# Logs do Lido Service
docker-compose logs -f lido_service

# Logs do Auth Service
docker-compose logs -f auth_service
```

**Logs esperados no Lido Service:**
```
🚀 Lido Service running on port 3004
🌍 Environment: development
🔐 Authentication: Centralized (auth-service at http://auth_service:3001)
📋 Available endpoints:
  - POST /api/lido/stake (requires JWT)
  - GET  /api/lido/position/:userAddress (optional JWT)
  ...
🔑 To authenticate:
  1. POST to auth-service/auth/login to get SIWE payload
  2. Sign payload with wallet
  3. POST to auth-service/auth/verify with signature to get JWT
  4. Use JWT in Authorization header: Bearer <token>
```

---

## ✅ Benefícios da Integração

### 1. **Autenticação Unificada**
- ✅ Um único JWT válido para **todos** os serviços
- ✅ Usuário faz login uma vez, usa em todo o ecossistema
- ✅ Mesma experiência de auth em liquid-swap, lido, e futuros serviços

### 2. **Segurança Centralizada**
- ✅ JWT gerenciado pelo auth-service
- ✅ Session management em Redis
- ✅ Refresh tokens com 14 dias de validade
- ✅ Revogação centralizada de tokens

### 3. **Desenvolvimento Simplificado**
- ✅ Não precisa reimplementar auth em cada serviço
- ✅ Código reutilizável (authMiddleware)
- ✅ Manutenção centralizada

### 4. **Orquestração Docker**
- ✅ Sobe automaticamente com `docker-compose up`
- ✅ Dependências corretas (espera auth-service e engine)
- ✅ Configuração consistente dev/prod

---

## 🔄 Comparação: Antes vs Depois

### Antes (JWT Interno)

```typescript
// lido-service tinha seu próprio JWTService
import { JWTService } from '../../auth/jwt.service';

static authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  const jwtService = new JWTService();
  const decoded = jwtService.verifyAccessToken(token);  // ← Local
  req.user = decoded;
  next();
}
```

**Problemas:**
- ❌ JWT diferente do liquid-swap-service
- ❌ Usuário precisa autenticar em cada serviço
- ❌ Não compartilha sessão
- ❌ Cada serviço tem seus próprios secrets

### Depois (Auth Centralizado)

```typescript
// lido-service usa auth-service centralizado
import axios from 'axios';

static async authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  const authServiceUrl = process.env.AUTH_SERVICE_URL;

  const response = await axios.post(
    `${authServiceUrl}/auth/validate`,
    { token }
  );  // ← Centralizado!

  if (response.data.isValid) {
    req.user = response.data.payload;
    next();
  }
}
```

**Benefícios:**
- ✅ JWT compartilhado entre todos os serviços
- ✅ Single Sign-On (SSO)
- ✅ Sessão unificada no Redis
- ✅ Secrets centralizados no auth-service

---

## 🚨 Troubleshooting

### Erro: "Could not validate authentication with auth service"

**Causa:** Lido service não consegue se comunicar com auth-service

**Solução:**
```bash
# Verificar se auth-service está rodando
docker-compose ps auth_service

# Verificar logs do auth-service
docker-compose logs auth_service

# Verificar variável AUTH_SERVICE_URL no lido-service
docker-compose exec lido_service env | grep AUTH_SERVICE_URL
```

### Erro: "Invalid or expired token"

**Causa:** JWT expirado ou inválido

**Solução:**
```bash
# Gerar novo JWT
curl -X POST http://localhost:3001/auth/login ...
# [Assinar e verificar novamente]
```

### Erro: "Authorization header required"

**Causa:** Header Authorization não enviado ou formato incorreto

**Solução:**
```bash
# Formato correto:
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# ❌ Errado: sem Bearer
curl -H "Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# ❌ Errado: header errado
curl -H "Auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 🎓 Conclusão

O **Lido Service** agora está **totalmente integrado** ao ecossistema panorama-block-backend:

✅ **Autenticação centralizada** (mesmo fluxo do liquid-swap)
✅ **JWT compartilhado** entre todos os serviços
✅ **Docker orchestration** completa
✅ **Sobe automaticamente** com `docker-compose up`
✅ **Mesma experiência** de autenticação em todo o sistema

**Resultado:** Sistema coeso, seguro e fácil de manter! 🚀

---

**Documentação criada em:** 2025-11-07
**Autor:** Claude (Anthropic)
**Versão:** 1.0.0
