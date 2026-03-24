# DCA Service - Quick Start Guide

## ⚡ Início Rápido (5 minutos)

### 1. Verificar Serviços

```bash
# Redis está rodando?
docker ps | grep redis

# DCA Service está rodando?
curl http://localhost:3004/health

# Se não estiver, iniciar:
cd /home/inteli/Desktop/Panorama/panorama-block-backend/dca-service
npm run dev
```

### 2. Criar Smart Account (Frontend)

Acesse: `http://localhost:7778/miniapp/account`

Clique em "Create Smart Wallet" e preencha:
- Name: `My DCA Wallet`
- Permissions: Default (já preenchido)

Resultado: `0x...` (endereço da smart account)

### 3. Enviar ETH para Smart Account

```bash
# A smart account precisa de ETH para:
# - Swap amount: 0.01 ETH (exemplo)
# - Gas: ~0.05 ETH
# Total mínimo: ~0.1 ETH para testes
```

Use sua wallet para enviar ETH para o endereço da smart account.

### 4. Criar Estratégia DCA (Frontend)

Acesse: `http://localhost:7778/miniapp/dca`

Clique em "Create Recurring Buy" e configure:
- Smart Wallet: Selecione a que criou
- Sell: `0.01` ETH
- Buy: USDC
- Interval: Daily

Clique em "Create Recurring Buy"

### 5. Executar Manualmente (Testing)

```bash
# 1. Pegar o strategyId
curl -s http://localhost:3004/dca/debug/all-strategies | jq '.strategies[0].strategyId'

# 2. Executar
curl -X POST http://localhost:3004/dca/debug/execute/{strategyId} | jq

# Exemplo de resposta:
# {
#   "success": true,
#   "execution": {
#     "txHash": "0xabc123...",
#     "amount": "0.01"
#   },
#   "nextExecution": {
#     "date": "2025-11-12T05:30:00.000Z"
#   }
# }
```

### 6. Verificar Resultado

```bash
# Ver histórico de execuções
curl -s http://localhost:3004/dca/debug/all-history | jq

# Ver no blockchain explorer
# https://etherscan.io/tx/{txHash}
```

---

## 🔍 Comandos Úteis

### Debug

```bash
# Estatísticas gerais
curl http://localhost:3004/dca/debug/redis-stats | jq

# Todas as estratégias
curl http://localhost:3004/dca/debug/all-strategies | jq

# Fila de execução
curl http://localhost:3004/dca/debug/scheduled | jq

# Histórico completo
curl http://localhost:3004/dca/debug/all-history | jq
```

### Redis Direct

```bash
# Ver todas as chaves DCA
docker exec panorama-redis redis-cli -a Zico100x keys "dca-*"

# Ver estratégia específica
docker exec panorama-redis redis-cli -a Zico100x hgetall "dca-strategy:{id}"

# Ver fila agendada
docker exec panorama-redis redis-cli -a Zico100x zrange dca-scheduled 0 -1 WITHSCORES
```

### Logs

```bash
# Logs em tempo real
tail -f /tmp/dca-service.log

# Buscar erros
grep "❌\|ERROR" /tmp/dca-service.log

# Buscar execuções
grep "executeSwap" /tmp/dca-service.log
```

---

## 📍 URLs Importantes

- **DCA Service**: http://localhost:3004
- **Health Check**: http://localhost:3004/health
- **Frontend DCA**: http://localhost:7778/miniapp/dca
- **Frontend Account**: http://localhost:7778/miniapp/account

---

## 🚨 Troubleshooting Rápido

### "insufficient funds"
→ Enviar mais ETH para a smart account

### "Session key expired"
→ Criar nova smart account (validade: 30 dias)

### "Strategy not found"
→ Verificar strategyId com `/debug/all-strategies`

### Cron não executando
→ Verificar logs: `grep "DCA Executor" /tmp/dca-service.log`

---

## 📚 Documentação Completa

- Backend: `./DCA_DOCUMENTATION.md`
- Frontend: `../../../../telegram/docs/features/dca/README.md`

---

**Pronto para usar!** 🎉
