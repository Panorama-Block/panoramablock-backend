# Local Docker Workflow (No Production Impact)

Este fluxo padroniza ambiente local sem alterar deploy/prod.

## Escopo seguro
- Usa somente arquivos locais:
  - `docker-compose.yml`
  - `docker-compose.local.yml`
  - `.env` (ou `.env.local` copiado de `.env.local.example`)
- Não usa:
  - `docker-compose-deploy.yml`
  - `infra/container-apps/*.yaml`

## Setup
1. Copie variáveis locais:
```bash
cp .env.local.example .env.local
```
2. Para usar `.env.local` no compose:
```bash
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml config >/dev/null
```

## Perfis disponíveis
- `infra`: redis, postgres, engine
- `core`: auth_service
- `swap`: liquid_swap_service
- `staking`: lido_service
- `lending`: lending_service
- `dca`: dca_service
- `bridge`: bridge_service

## Comandos padrão
### Subir base mínima (infra + auth + staking + lending)
```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml \
  --profile infra --profile core --profile staking --profile lending up --build -d
```

### Subir stack completo local
```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml \
  --profile infra --profile core --profile swap --profile staking --profile lending --profile dca --profile bridge \
  up --build -d
```

### Ver logs
```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml logs -f lending_service lido_service liquid_swap_service auth_service
```

### Derrubar ambiente
```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml down
```

## Nota sobre Database Gateway
Se `lending_service` usar sync com gateway (`DB_GATEWAY_SYNC_ENABLED=true`), garanta que `DB_GATEWAY_URL` esteja acessível do container:
- Gateway rodando no host: `http://host.docker.internal:8080`
- Gateway em container na mesma rede: `http://<service-name>:8080`
