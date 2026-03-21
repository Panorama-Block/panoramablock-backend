import { z } from 'zod';

// Environment schema validation
const EnvironmentSchema = z.object({
  // Server configuration
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3005'),
  WEBSOCKET_PORT: z.string().transform(Number).default('3006'),

  // Database configuration
  DATABASE_URL: z.string().min(1, 'Database URL is required'),
  REDIS_URL: z.string().optional(),

  // TAC SDK configuration
  TAC_SDK_ENDPOINT: z.string().optional().default(''),
  TAC_API_KEY: z.string().optional().default('dev-key'),
  TAC_WEBHOOK_SECRET: z.string().optional().default(''),
  TAC_NETWORK: z.string().transform(val => val.toUpperCase()).pipe(z.enum(['TESTNET', 'MAINNET'])).default('TESTNET'),
  TAC_SUPPORTED_CHAINS: z.string().default('ethereum,avalanche,base,optimism'),
  TAC_DEFAULT_BRIDGE_TIMEOUT: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().default(300000)
  ), // 5 minutes
  TAC_MAX_RETRY_ATTEMPTS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().default(3)
  ),
  TAC_UNISWAPV2_PROXY: z.string().optional(),

  // JWT configuration
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  JWT_ISSUER: z.string().default('tac-service'),
  JWT_AUDIENCE: z.string().default('panorama-block'),

  // External service URLs
  AUTH_SERVICE_URL: z.string().url().optional(),
  LIQUID_SWAP_SERVICE_URL: z.string().url().optional(),
  LIQUID_SWAP_TIMEOUT_MS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),
  LIQUID_SWAP_RETRY_ATTEMPTS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),
  LIQUID_SWAP_RETRY_BACKOFF_MS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),
  LIDO_SERVICE_URL: z.string().url().optional(),
  LENDING_SERVICE_URL: z.string().url().optional(),
  AVAX_SERVICE_URL: z.string().url().optional(),
  DB_GATEWAY_URL: z.string().url().optional(),
  DB_GATEWAY_SERVICE_TOKEN: z.string().optional(),
  DB_GATEWAY_TENANT_ID: z.string().optional(),
  DB_GATEWAY_SYNC_ENABLED: z.string().transform(v => v === 'true').optional(),
  DB_GATEWAY_TIMEOUT_MS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),

  // Protocol configuration
  LIDO_CONTRACT_ADDRESS: z.string().optional(),
  BENQI_COMPTROLLER_ADDRESS: z.string().optional(),
  UNISWAP_V3_FACTORY: z.string().optional(),

  // Feature flags
  ENABLE_WEBSOCKET: z.string().transform(v => v === 'true').default('true'),
  ENABLE_ANALYTICS: z.string().transform(v => v === 'true').default('true'),
  ENABLE_PUSH_NOTIFICATIONS: z.string().transform(v => v === 'true').default('true'),

  // Security configuration
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_WINDOW: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().default(60000)
  ), // 1 minute
  RATE_LIMIT_MAX_REQUESTS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().default(100)
  ),

  // Monitoring and logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SENTRY_DSN: z.string().optional(),
  DEBUG: z.string().transform(v => v === 'true').default('false'),
  PANORAMA_API_KEY: z.string().optional(),
  WALLET_PROVIDER_DEFAULT: z.enum(['thirdweb', 'wdk']).default('wdk'),
  WDK_SUPPORTED_CHAINS: z.string().default('evm,ton'),
  WDK_EVM_RPC_URL: z.string().url().optional(),
  WDK_TON_RPC_URL: z.string().url().optional(),
  WDK_SEED: z.string().optional(),
  WDK_REQUIRE_SESSION: z.string().transform(v => v !== 'false').default('true'),
  WDK_SIMULATE_EXECUTION: z.string().transform(v => v === 'true').default('false'),
  THIRDWEB_ENGINE_URL: z.string().url().optional(),
  ENGINE_ACCESS_TOKEN: z.string().optional(),
  WEBHOOK_DELIVERY_TIMEOUT_MS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),
  WEBHOOK_DELIVERY_RETRIES: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),
  WEBHOOK_DELIVERY_RETRY_BACKOFF_MS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),
  WALLET_ADAPTER_TIMEOUT_MS: z.preprocess(
    (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
    z.number().optional()
  ),

  // Testing configuration
  TEST_TIMEOUT: z.string().transform(Number).optional(),
  MOCK_EXTERNAL_SERVICES: z.string().transform(v => v === 'true').optional()
});

export type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;

export function validateEnvironment(): EnvironmentConfig {
  try {
    const config = EnvironmentSchema.parse(process.env);

    // Additional validation logic
    validateDatabaseConfig(config);
    validateTacConfig(config);
    validateSecurityConfig(config);

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.issues.forEach(issue => {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      });
    } else {
      console.error('❌ Environment validation error:', error);
    }

    process.exit(1);
  }
}

function validateDatabaseConfig(config: EnvironmentConfig): void {
  // Validate database URL format
  if (!config.DATABASE_URL.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  }

  // Check for required database parameters
  const dbUrl = new URL(config.DATABASE_URL);
  if (!dbUrl.hostname || !dbUrl.pathname || dbUrl.pathname === '/') {
    throw new Error('DATABASE_URL must include hostname and database name');
  }
}

function validateTacConfig(config: EnvironmentConfig): void {
  // Validate supported chains
  const supportedChains = config.TAC_SUPPORTED_CHAINS.split(',').map(chain => chain.trim());
  const validChains = ['ethereum', 'avalanche', 'base', 'optimism', 'polygon', 'bsc'];

  const invalidChains = supportedChains.filter(chain => !validChains.includes(chain));
  if (invalidChains.length > 0) {
    throw new Error(`Invalid chains in TAC_SUPPORTED_CHAINS: ${invalidChains.join(', ')}`);
  }

  // Validate timeout values
  if (config.TAC_DEFAULT_BRIDGE_TIMEOUT < 30000) { // Minimum 30 seconds
    throw new Error('TAC_DEFAULT_BRIDGE_TIMEOUT must be at least 30000ms (30 seconds)');
  }

  if (config.TAC_MAX_RETRY_ATTEMPTS > 10) {
    throw new Error('TAC_MAX_RETRY_ATTEMPTS should not exceed 10');
  }
}

function validateSecurityConfig(config: EnvironmentConfig): void {
  // Validate JWT secret strength
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.length < 64) {
    throw new Error('JWT_SECRET must be at least 64 characters in production');
  }

  // Validate rate limiting
  if (config.RATE_LIMIT_MAX_REQUESTS > 1000) {
    console.warn('⚠️ RATE_LIMIT_MAX_REQUESTS is very high, consider reducing for security');
  }

  // Check for production-specific requirements
  if (config.NODE_ENV === 'production') {
    if (config.CORS_ORIGIN === '*') {
      console.warn('⚠️ CORS_ORIGIN is set to "*" in production, consider restricting');
    }

    if (!config.SENTRY_DSN) {
      console.warn('⚠️ SENTRY_DSN not configured for production monitoring');
    }
  }
}

// Environment-specific configurations
export const getChainConfig = () => {
  const config = validateEnvironment();

  return {
    supportedChains: config.TAC_SUPPORTED_CHAINS.split(',').map(chain => chain.trim()),
    defaultTimeout: config.TAC_DEFAULT_BRIDGE_TIMEOUT,
    maxRetries: config.TAC_MAX_RETRY_ATTEMPTS,
    contracts: {
      lido: config.LIDO_CONTRACT_ADDRESS,
      benqi: config.BENQI_COMPTROLLER_ADDRESS,
      uniswap: config.UNISWAP_V3_FACTORY,
      tacUniswapProxy: config.TAC_UNISWAPV2_PROXY
    }
  };
};

export const getServiceUrls = () => {
  const config = validateEnvironment();

  return {
    auth: config.AUTH_SERVICE_URL,
    liquidSwap: config.LIQUID_SWAP_SERVICE_URL,
    lido: config.LIDO_SERVICE_URL,
    lending: config.LENDING_SERVICE_URL,
    avax: config.AVAX_SERVICE_URL
  };
};

export const getSecurityConfig = () => {
  const config = validateEnvironment();

  return {
    jwt: {
      secret: config.JWT_SECRET,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      expiresIn: '24h'
    },
    rateLimit: {
      windowMs: config.RATE_LIMIT_WINDOW,
      maxRequests: config.RATE_LIMIT_MAX_REQUESTS
    },
    cors: {
      // TEMP: allow '*' to fully open CORS for testing; set CORS_ORIGIN to comma-separated domains to lock down.
      origin: config.CORS_ORIGIN === '*'
        ? true
        : config.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
    }
  };
};

// Export the configuration for use in other modules
export default validateEnvironment;
