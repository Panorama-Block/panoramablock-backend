require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// Importa rotas
const traderJoeRoutes = require('./routes/traderJoeRoutes');
const validationRoutes = require('./routes/validationRoutes');
const validationSwapRoutes = require('./routes/validationSwapRoutes');
const benqiRoutes = require('./routes/benqiRoutes');
const benqiValidationRoutes = require('./routes/benqiValidationRoutes');
// Execution layer proxy — routes AVAX operations to the execution layer service
const executionLayerRoutes = require('./routes/executionLayerRoutes');

// Importa configurações
const { NETWORKS, RATE_LIMIT, SECURITY, VALIDATION } = require('./config/constants');
const { ERROR_CODES, sendError } = require('./lib/errorCodes');
const { getAllBreakerStatuses } = require('./lib/circuitBreaker');

const app = express();
const port = process.env.PORT || 3007;
app.set('trust proxy', 1);

// Middleware de segurança
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Middleware de CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true)
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Middleware de compressão
app.use(compression());

// Middleware de logging
app.use(morgan('combined'));

// Middleware de parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting global
const globalRateLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.MAX_REQUESTS,
  keyGenerator: (req) => {
    // Per-account rate limiting: prefer wallet address, fall back to IP
    return req.verifiedAddress || req.body?.address?.toLowerCase() || req.ip;
  },
  skip: (req) => {
    if (req.method !== 'GET') return false;
    const path = req.path || '';
    return (
      path === '/health' ||
      path === '/info' ||
      path === '/config' ||
      path === '/network/status' ||
      path === '/benqi/markets'
    );
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    sendError(res, 429, ERROR_CODES.RATE_LIMITED,
      `Rate limit exceeded. Max ${RATE_LIMIT.MAX_REQUESTS} requests per ${RATE_LIMIT.WINDOW_MS / 1000}s`,
      { retryAfter: Math.ceil(RATE_LIMIT.WINDOW_MS / 1000) }
    );
  }
});

app.use(globalRateLimiter);

// Middleware de validação de rede
app.use((req, res, next) => {
  // Adiciona informações da rede ao request
  req.network = NETWORKS.AVALANCHE;
  next();
});

// Rota de health check
app.get('/health', (req, res) => {
  const cbStatuses = getAllBreakerStatuses();
  const anyOpen = Object.values(cbStatuses).some((s) => s.state === 'open');
  const dbGateway = process.env.DB_GATEWAY_SYNC_ENABLED === 'true' && !!process.env.DB_GATEWAY_URL;

  res.json({
    status: anyOpen ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'lending-service',
    version: '1.0.0',
    network: {
      name: NETWORKS.AVALANCHE.name,
      chainId: NETWORKS.AVALANCHE.chainId,
    },
    circuitBreakers: cbStatuses,
    database: {
      gateway: dbGateway ? 'enabled' : 'disabled',
    },
  });
});

// Rota de informações da API
app.get('/info', (req, res) => {
  res.json({
    name: 'Zico Swap API',
    description: 'API de Swap para Avalanche usando Trader Joe',
    version: '1.0.0',
    network: NETWORKS.AVALANCHE.name,
    chainId: NETWORKS.AVALANCHE.chainId,
    supportedProtocols: ['Trader Joe', 'Validation Contract', 'Validation + Swap', 'Benqi Lending', 'Benqi + Validation'],
    features: [
      'Swap de tokens',
      'Comparação de preços',
      'Execução de swaps',
      'Preços em tempo real',
      'Histórico de preços',
      'Tendências de mercado',
      'Cache inteligente',
      'Rate limiting',
      'Autenticação por assinatura',
      'Contrato de validação e taxas',
      'Pagamentos com validação',
      'Gestão de taxas',
      'Validação + Swap integrado',
      'Lending e borrowing',
      'Supply de ativos',
      'Redeem de qTokens',
      'Borrow de ativos',
      'Repay de empréstimos',
      'Gestão de liquidez',
      'Enter/Exit markets'
    ],
    endpoints: {
      swap: '/dex/swap',
      price: '/dex/getprice',
      validation: '/validation/*',
      validationSwap: '/validation-swap/*',
      benqi: '/benqi/*',
      benqiValidation: '/benqi-validation/*',
      health: '/health',
      info: '/info'
    },
    documentation: 'https://github.com/your-repo/docs',
    support: 'support@yourdomain.com'
  });
});

// Rota de status da rede
app.get('/network/status', async (req, res) => {
  try {
    const { ethers } = require('ethers');
    const provider = new ethers.JsonRpcProvider(NETWORKS.AVALANCHE.rpcUrl);
    
    const [blockNumber, gasPrice, network] = await Promise.all([
      provider.getBlockNumber(),
      provider.getFeeData(),
      provider.getNetwork()
    ]);

    res.json({
      success: true,
      network: {
        name: NETWORKS.AVALANCHE.name,
        chainId: NETWORKS.AVALANCHE.chainId,
        rpcUrl: NETWORKS.AVALANCHE.rpcUrl,
        explorer: NETWORKS.AVALANCHE.explorer
      },
      status: {
        connected: true,
        blockNumber: blockNumber.toString(),
        gasPrice: gasPrice.gasPrice?.toString() || 'N/A',
        lastBlock: new Date().toISOString()
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Erro ao verificar status da rede:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar status da rede',
      details: error.message
    });
  }
});

// Rota de configurações
app.get('/config', (req, res) => {
  res.json({
    success: true,
    network: NETWORKS.AVALANCHE,
    rateLimit: RATE_LIMIT,
    security: {
      signatureExpiry: SECURITY.SIGNATURE_EXPIRY,
      maxAmount: SECURITY.MAX_AMOUNT,
      minAmount: SECURITY.MIN_AMOUNT
    },
    timestamp: Date.now()
  });
});

// Registra as rotas
// Execution layer proxy takes priority over legacy routes
// (benqi/markets, benqi/account, benqi-validation/*, liquid-staking/*)
app.use('/', executionLayerRoutes);

app.use('/dex', traderJoeRoutes);
app.use('/validation', validationRoutes);
app.use('/validation-swap', validationSwapRoutes);
// Legacy benqi routes remain as fallback if execution layer is down
app.use('/benqi', benqiRoutes);
app.use('/benqi-validation', benqiValidationRoutes);

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  const code = err.errorCode || (status === 429 ? ERROR_CODES.RATE_LIMITED : ERROR_CODES.SERVICE_UNAVAILABLE);
  const message = process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong';
  sendError(res, status, code, message);
});

// Middleware para rotas não encontradas (deve ser o último)
app.use((req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    message: `A rota ${req.originalUrl} não existe`,
    availableRoutes: [
      'GET /health',
      'GET /info',
      'GET /network/status',
      'GET /config',
      'GET/POST /dex/*',
      'GET/POST /validation/*',
      'POST /validation-swap/*',
      'GET/POST /benqi/*',
      'POST /benqi-validation/*'
    ]
  });
});

// Função para inicializar a API
async function initializeAPI() {
  try {
    // Verifica se as variáveis de ambiente necessárias estão configuradas
    // Accept both legacy and new env var names (compose uses AVALANCHE_RPC_URL).
    const hasAvalancheRpc =
      !!process.env.AVALANCHE_RPC_URL ||
      !!process.env.RPC_URL_AVALANCHE ||
      !!process.env.RPC_URL; // last-resort shared RPC (not ideal, but better than hard fail)

    const missingVars = hasAvalancheRpc ? [] : ['AVALANCHE_RPC_URL (or RPC_URL_AVALANCHE)'];
    
    if (missingVars.length > 0) {
      console.warn('⚠️  Variáveis de ambiente ausentes:', missingVars.join(', '));
      console.warn('📝 Verifique o arquivo .env.example para configuração');
    }

    const validationConfigured =
      typeof VALIDATION.CONTRACT_ADDRESS === 'string' &&
      /^0x[a-fA-F0-9]{40}$/.test(VALIDATION.CONTRACT_ADDRESS) &&
      !/^0x0{40}$/i.test(VALIDATION.CONTRACT_ADDRESS);
    if (!validationConfigured) {
      console.warn('⚠️  VALIDATION_CONTRACT_ADDRESS não configurado. Rotas /benqi-validation vão operar em fallback para smart wallets.');
    }

    // Inicia o servidor
    const server = app.listen(port, () => {
      console.log('🚀 Zico Swap API iniciada com sucesso!');
      console.log(`📍 Servidor rodando em http://localhost:${port}`);
      console.log(`🌐 Rede: ${NETWORKS.AVALANCHE.name} (Chain ID: ${NETWORKS.AVALANCHE.chainId})`);
      console.log(`🔗 RPC: ${NETWORKS.AVALANCHE.rpcUrl}`);
      console.log(`📊 Rate Limit: ${RATE_LIMIT.MAX_REQUESTS} requests/${RATE_LIMIT.WINDOW_MS / 1000}s`);
      console.log(`🔐 Modo: ${process.env.NODE_ENV || 'development'}`);
      console.log('');
      console.log('📋 Endpoints disponíveis:');
      console.log(`   Health Check: GET /health`);
      console.log(`   API Info: GET /info`);
      console.log(`   Network Status: GET /network/status`);
      console.log(`   Configuration: GET /config`);
      console.log(`   Trader Joe API: GET/POST /dex/*`);
      console.log(`   Validation API: GET/POST /validation/*`);
      console.log('');
      console.log('💡 Para testar a API, use:');
      console.log(`   curl http://localhost:${port}/health`);
      console.log(`   curl http://localhost:${port}/info`);
      console.log('');
      console.log('✅ Servidor aguardando requisições...');
    });

    server.on('error', (error) => {
      console.error('❌ Erro no servidor:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`⚠️  Porta ${port} já está em uso!`);
      }
    });

    // Manter referência ao servidor
    global.server = server;

  } catch (error) {
    console.error('❌ Erro ao inicializar a API:', error);
    process.exit(1);
  }
}

// Função para graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n🛑 Recebido sinal ${signal}. Encerrando a API...`);
  
  process.exit(0);
}

// Listeners para graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
  console.error('Stack:', error.stack);
  // NÃO sair imediatamente para debug
  // process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
  console.error('Promise:', promise);
  // NÃO sair imediatamente para debug
  // process.exit(1);
});

process.on('exit', (code) => {
  console.log('⚠️ Processo encerrando com código:', code);
  console.trace('Stack trace do exit:');
});

// Inicializa a API
if (require.main === module) {
  initializeAPI();
}

module.exports = app;
