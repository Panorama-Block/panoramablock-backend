# PanoramaBlock Microservices

Este repositório contém a implementação dos microsserviços do PanoramaBlock, uma aplicação blockchain para monitoramento de carteiras e swap de tokens.

## Arquitetura

A aplicação é dividida em três microsserviços principais:

1. **Auth Service**: Serviço centralizado de autenticação baseado em JWT que utiliza o ThirdWeb para login com carteira (Sign In With Ethereum - SIWE)
2. **Wallet Tracker Service**: Serviço para rastreamento e monitoramento de carteiras em múltiplas redes blockchain
3. **Liquid Swap Service**: Serviço para realizar swaps cross-chain entre diferentes tokens e blockchains

## Tecnologias Utilizadas

- **Auth Service e Liquid Swap Service**: Node.js, Express, ThirdWeb SDK
- **Wallet Tracker Service**: Go, Padrão Hexagonal
- **Banco de Dados**: MongoDB
- **Cache**: Redis
- **Containerização**: Docker, Docker Compose

## Requisitos

- Docker e Docker Compose
- Node.js 18+ (para desenvolvimento local)
- Go 1.20+ (para desenvolvimento local)

## Configuração

1. Clone o repositório:
   ```bash
   git clone https://github.com/seu-usuario/panoramablock.git
   cd panoramablock
   ```

2. Crie um arquivo `.env` baseado no `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Edite o arquivo `.env` e preencha as variáveis de ambiente necessárias.

## Execução

### Usando Docker Compose (recomendado)

```bash
# Construir e iniciar todos os serviços
docker-compose up -d

# Verificar status dos serviços
docker-compose ps

# Parar os serviços
docker-compose down
```

### Desenvolvimento Local

Para o Auth Service e Liquid Swap Service:

```bash
cd auth-service # ou liquid-swap-service
npm install
npm run dev
```

Para o Wallet Tracker Service:

```bash
cd wallet-tracker-service
go run cmd/main.go
```

## Testes

Consulte o arquivo [TESTING.md](docs/testing/TESTING.md) para instruções detalhadas sobre como testar os serviços.

## Estrutura de Diretórios

```
panoramablock/
├── auth-service/           # Serviço de autenticação (Node.js)
│   ├── src/
│   │   ├── middleware/     # Middlewares para autenticação
│   │   ├── routes/         # Rotas para login e verificação
│   │   ├── utils/          # Utilitários, incluindo integração com ThirdWeb
│   │   └── index.ts        # Ponto de entrada
│   ├── Dockerfile          # Configuração Docker
│   └── package.json        # Dependências
│
├── wallet-tracker-service/ # Serviço de rastreamento de carteiras (Go)
│   ├── cmd/                # Ponto de entrada
│   ├── internal/
│   │   ├── application/    # Casos de uso
│   │   ├── domain/         # Entidades e interfaces de repositório
│   │   └── infrastructure/ # Adaptadores e implementações
│   ├── Dockerfile          # Configuração Docker
│   └── go.mod              # Dependências
│
├── liquid-swap-service/    # Serviço de swap cross-chain (Node.js)
│   ├── src/
│   │   ├── controllers/    # Controladores para operações de swap
│   │   ├── middleware/     # Middleware para autenticação JWT
│   │   ├── routes/         # Rotas para operações de swap
│   │   ├── utils/          # Utilitários para ThirdWeb
│   │   └── index.ts        # Ponto de entrada
│   ├── Dockerfile          # Configuração Docker
│   └── package.json        # Dependências
│
├── docker-compose.yml      # Configuração dos serviços Docker
└── .env.example            # Exemplo de variáveis de ambiente
```

## Endpoints

### Auth Service (porta 3001)
- `GET /health`: Verificação de saúde do serviço
- `POST /auth/login`: Gerar payload para assinatura SIWE
- `POST /auth/verify`: Verificar assinatura e gerar token JWT
- `POST /auth/validate`: Validar token JWT (uso interno)
- `POST /auth/logout`: Invalidar sessão

### Wallet Tracker Service (porta 3002)
- `GET /health`: Verificação de saúde do serviço
- `POST /wallets/track`: Iniciar rastreamento de carteira
- `GET /wallets/{address}`: Obter informações da carteira
- `GET /wallets/{address}/history`: Obter histórico de transações

### Liquid Swap Service (porta 3003)
- `GET /health`: Verificação de saúde do serviço
- `POST /swap/manual`: Executar swap cross-chain entre tokens

## Contribuindo

1. Faça um fork do repositório
2. Crie uma branch para sua feature: `git checkout -b feature/nova-feature`
3. Commit suas mudanças: `git commit -m 'Adiciona nova feature'`
4. Envie para a branch: `git push origin feature/nova-feature`
5. Abra um Pull Request

## Licença

[MIT License](LICENSE) 
