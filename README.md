# PanoramaBlock Backend

Polylithic microservices backend for the PanoramaBlock DeFi platform. Each service is fully independent — no shared `node_modules`, no monorepo tooling.

## Services

| Service | Port | Description |
|---------|------|-------------|
| `auth-service` | 3001 | Centralized JWT auth via ThirdWeb SIWE, Redis sessions |
| `liquid-swap-service` | 3002 | Multi-provider DEX swaps (Uniswap, Thirdweb Bridge, Aerodrome) |
| `dca-service` | 3003 | Dollar Cost Averaging automation with ERC-4337 Account Abstraction |
| `lido-service` | 3004 | Ethereum liquid staking via Lido protocol |
| `bridge-service` | 3005 | TAC cross-chain bridge with real-time Socket.io updates |
| `lending-service` | 3007 | Lending protocol integration |
| `database` | 8080 | Generic Fastify REST gateway for Postgres (multi-tenant, outbox pattern) |
| `avax-service` | — | Avalanche / Trader Joe DEX integration |

## Architecture

Services follow a **hexagonal (ports & adapters)** pattern where applicable:

```
src/
  domain/         # Core entities, business rules, port interfaces
  application/    # Use cases, domain services
  infrastructure/ # Adapters: database, blockchain, HTTP clients
  di/             # Dependency injection container
```

Authentication is centralized: `auth-service` issues JWTs; all other services validate tokens by calling `POST /auth/validate`.

The backend is **non-custodial** — it prepares unsigned transaction bundles; the client (wallet) signs and broadcasts.

## Development

Navigate into a service directory and run commands from there:

```bash
cd auth-service
npm install
npm run dev
```

Common scripts available in all services:

```bash
npm run dev        # Start with hot reload
npm run build      # Compile TypeScript
npm run test       # Run all tests
npm run lint       # Lint
```

### Database services (Prisma)

```bash
npm run db:migrate       # Run migrations
npm run prisma:generate  # Regenerate Prisma client
```

## Running with Docker Compose

```bash
# Start all services (development)
docker-compose up -d

# Start for production deployment
docker-compose -f docker-compose-deploy.yml up -d

# Check service status
docker-compose ps

# Stop all services
docker-compose down
```

## Testing

See [docs/testing/TESTING.md](docs/testing/TESTING.md) for the testing guide.

```bash
# Jest-based services
npx jest path/to/test.spec.ts

# Vitest-based services
npx vitest run path/to/test.spec.ts

# Integration / e2e (bridge-service)
npm run test:integration
npm run test:e2e
```

## Documentation

Full backend documentation lives in [`docs/`](docs/README.md):

- Architecture overview and service details
- API references and specs
- Integration guides (Lido, Telegram MiniApp)
- Database contracts and modeling
- Runbooks and testing guides

## Key Technologies

- **TypeScript** — all services
- **ThirdWeb SDK v5** — wallet auth and swap primitives
- **Prisma** — PostgreSQL ORM (bridge-service, dca-service, database gateway)
- **Redis** — sessions and caching
- **Zod** — runtime validation
- **Jest / Vitest** — testing
- **ethers.js v5/v6** — blockchain interaction (version varies per service)
