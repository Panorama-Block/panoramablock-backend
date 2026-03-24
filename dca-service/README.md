# PanoramaBlock DCA Service

Sistema de Dollar Cost Averaging (DCA) automatizado com Account Abstraction (ERC-4337).

## 📚 Documentação

### Quick Start
- **[QUICKSTART.md](../docs/services/dca/QUICKSTART.md)** - Guia rápido de 5 minutos para começar

### Documentação Completa
- **[DCA_DOCUMENTATION.md](../docs/services/dca/DCA_DOCUMENTATION.md)** - Documentação técnica completa do sistema
- **[ARCHITECTURE.md](../docs/services/dca/ARCHITECTURE.md)** - Diagramas e fluxos da arquitetura

### Frontend
- **[Frontend README](../../telegram/docs/features/dca/README.md)** - Guia de integração frontend

## ⚡ Início Rápido

```bash
# 1. Verificar Redis
docker ps | grep redis

# 2. Iniciar DCA Service
npm run dev

# 3. Verificar saúde
curl http://localhost:3004/health
```

## 🎯 Funcionalidades

- ✅ Compras recorrentes automatizadas (daily/weekly/monthly)
- ✅ Account Abstraction com session keys
- ✅ Swaps reais via Uniswap V3
- ✅ Cron job automático
- ✅ Histórico completo de execuções
- ✅ API de debug para visualização

## 📡 Principais Endpoints

```bash
# Criar smart account
POST /dca/create-account

# Criar estratégia DCA
POST /dca/create-strategy

# Listar estratégias
GET /dca/strategies/:smartAccountId

# Executar manualmente (testing)
POST /dca/debug/execute/:strategyId

# Visualizar banco de dados
GET /dca/debug/all-strategies
GET /dca/debug/scheduled
GET /dca/debug/all-history
```

## 🔧 Tecnologias

- **Backend**: Node.js + TypeScript + Express
- **Database**: Redis (port 6380)
- **Blockchain**: Thirdweb SDK v5
- **DEX**: Uniswap V3
- **Scheduler**: node-cron

## 🏗 Arquitetura

```
Frontend (Next.js) → DCA Service (Express) → Redis
                           ↓
                  Thirdweb SDK → Ethereum
                           ↓
                    Uniswap V3 Router
```

## 🔒 Segurança

- Session keys criptografadas (AES-256)
- Nunca expostas ao frontend
- Permissões limitadas
- Validação em cada transação

## 📞 Links Úteis

- **Health**: http://localhost:3004/health
- **Root**: http://localhost:3004/
- **Stats**: http://localhost:3004/dca/debug/redis-stats

## 📄 Licença

MIT License - PanoramaBlock 2025
