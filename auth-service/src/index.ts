import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as fs from 'fs';
import https from 'https';
import { createClient, RedisClientType } from 'redis';
import authRoutes from './routes/auth';
import { getAuthInstance, isAuthConfigured } from './utils/thirdwebAuth';
import { requestLogger, errorLogger } from './middleware/loggingMiddleware';
import { AuthCapabilityService } from './application/services/auth.capability.service';
import { capabilityRouter } from './http/capability.router';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || process.env.AUTH_PORT || 3001;

app.set('trust proxy', 1);

// SSL certificate options for HTTPS
const getSSLOptions = () => {
  try {
    const certPath = process.env.FULLCHAIN || "/etc/letsencrypt/live/api.panoramablock.com/fullchain.pem";
    const keyPath = process.env.PRIVKEY || "/etc/letsencrypt/live/api.panoramablock.com/privkey.pem";
    
    console.log(`[Auth Service] Verificando certificados SSL em: ${certPath} e ${keyPath}`);
    
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      console.log('[Auth Service] ✅ Certificados SSL encontrados!');
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
    } else {
      console.warn('[Auth Service] ⚠️ Certificados SSL não encontrados nos caminhos:');
      console.warn(`- Cert: ${certPath} (${fs.existsSync(certPath) ? 'existe' : 'não existe'})`);
      console.warn(`- Key: ${keyPath} (${fs.existsSync(keyPath) ? 'existe' : 'não existe'})`);
      console.warn('Executando em modo HTTP.');
      return null;
    }
  } catch (error) {
    console.warn('[Auth Service] ❌ Erro ao carregar certificados SSL:', error);
    return null;
  }
};

// Configure CORS with credentials support
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[Auth Service] ⛔️ Blocked CORS origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Set up middleware
app.use(express.json());

// Normalize duplicated slashes in request URL to avoid 404 on //auth/login
app.use((req, _res, next) => {
  if (req.url.includes('//')) {
    req.url = req.url.replace(/\/+/g, '/');
  }
  next();
});

// Add logging middleware
app.use(requestLogger);

// Environment logging - always show on startup
console.log('\n🌍 [ENVIRONMENT] Auth Service Environment Variables:');
console.log('='.repeat(60));
console.log('📊 PORT:', PORT);
console.log('🌍 NODE_ENV:', process.env.NODE_ENV || 'development');
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = Number(process.env.REDIS_PORT || 6379);
const redisPassword = process.env.REDIS_PASS || '';
const redisUseTls = (process.env.REDIS_TLS || process.env.REDIS_USE_TLS || '').toLowerCase() === 'true';

console.log('🔗 REDIS_HOST:', redisHost);
console.log('🔗 REDIS_PORT:', redisPort);
console.log('🔗 REDIS_PASS:', redisPassword ? '[SET]' : '[NOT SET]');
console.log('🔐 REDIS_TLS:', redisUseTls);
console.log('🌐 AUTH_DOMAIN:', process.env.AUTH_DOMAIN || '[NOT SET]');
console.log('🔑 AUTH_PRIVATE_KEY:', process.env.AUTH_PRIVATE_KEY ? '[SET]' : '[NOT SET]');
console.log('🐛 DEBUG:', process.env.DEBUG || 'false');
console.log('🍪 AUTH_REFRESH_COOKIE_NAME:', process.env.AUTH_REFRESH_COOKIE_NAME || 'panorama_refresh');
console.log('🍪 AUTH_REFRESH_TTL_SECONDS:', process.env.AUTH_REFRESH_TTL_SECONDS || '1209600 (14 days)');
console.log('🍪 AUTH_COOKIE_DOMAIN:', process.env.AUTH_COOKIE_DOMAIN || '[NOT SET]');
console.log('🍪 AUTH_COOKIE_SECURE:', process.env.AUTH_COOKIE_SECURE || (process.env.NODE_ENV === 'production' ? 'true (default in production)' : 'false'));
console.log('🍪 AUTH_COOKIE_SAMESITE:', process.env.AUTH_COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none (default in production)' : 'lax'));
console.log('🔒 FULLCHAIN:', process.env.FULLCHAIN || '/etc/letsencrypt/live/api.panoramablock.com/fullchain.pem');
console.log('🔒 PRIVKEY:', process.env.PRIVKEY || '/etc/letsencrypt/live/api.panoramablock.com/privkey.pem');
console.log('='.repeat(60));

// Initialize ThirdWeb auth if configured
try {
  if (isAuthConfigured()) {
    getAuthInstance();
    console.log('[Auth Service] ThirdWeb auth initialized successfully');
  } else {
    console.warn('[Auth Service] AUTH_PRIVATE_KEY not set. Auth endpoints will return 503 until configured.');
  }
} catch (error) {
  console.error('[Auth Service] Failed to initialize ThirdWeb auth:', error);
}

// Set up Redis client for session management
const redisSocketOptions: { host: string; port: number; tls?: boolean } = {
  host: redisHost,
  port: redisPort,
};

if (redisUseTls) {
  redisSocketOptions.tls = true;
}

const redisClient: RedisClientType = createClient({
  socket: redisSocketOptions,
  password: redisPassword || undefined,
});

redisClient.connect().then(() => {
  console.log('[Auth Service] Connected to Redis successfully');
}).catch(err => {
  console.error('[Auth Service] Redis connection error:', err);
  process.exit(1);
});

// Handle Redis errors
redisClient.on('error', (err) => {
  console.error('[Auth Service] Redis client error:', err);
});

// Pass Redis client to routes
app.use('/auth', authRoutes(redisClient));

// Capability layer — new versioned endpoints
const authCapabilityService = new AuthCapabilityService(redisClient);
app.use('/v1/capability', capabilityRouter(authCapabilityService));

// Add error logging middleware
app.use(errorLogger);

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🏥 [HEALTH CHECK] Service health check requested');
  res.status(200).json({ 
    status: 'ok', 
    service: 'auth-service',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  console.log('🏠 [ROOT] Service info requested');
  res.json({
    name: 'PanoramaBlock Auth Service',
    description: 'Authentication service using ThirdWeb',
    version: '1.0.0',
    endpoints: {
      '/health': 'Health check',
      '/auth/login': 'Generate login payload',
      '/auth/verify': 'Verify signature and get JWT',
      '/auth/telegram/link': 'Link telegram user id to zico/wallet user id',
      '/auth/telegram/resolve': 'Resolve zico/wallet user id from telegram user id',
      '/auth/validate': 'Validate JWT token',
      '/auth/logout': 'Logout and invalidate session'
    }
  });
});

const sslOptions = getSSLOptions();

if (sslOptions) {
  const server = https.createServer(sslOptions, app).listen(Number(PORT), '0.0.0.0', () => {

    console.log(`\n🎉 [Auth Service] HTTPS Server running successfully!`);
    console.log(`📊 Port: ${PORT}`);
    console.log(`🔒 Protocol: HTTPS`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`📋 Health check: https://localhost:${PORT}/health`);
    console.log(`🔐 Auth API: https://localhost:${PORT}/auth/`);
    console.log(`✨ Ready to handle authentication!\n`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log(
      "[Auth Service] SIGTERM received, shutting down gracefully..."
    );
    server.close(() => {
      console.log("[Auth Service] Server closed");
      process.exit(0);
    });
  });
} else {

  const server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n🎉 [Auth Service] HTTP Server running successfully!`);
    console.log(`📊 Port: ${PORT}`);
    console.log(`🔓 Protocol: HTTP`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 Auth API: http://localhost:${PORT}/auth/`);
    console.log(`✨ Ready to handle authentication!\n`);
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Auth Service] WARNING: Running in HTTP mode in production. SSL certificates not found.');
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log(
      "[Auth Service] SIGTERM received, shutting down gracefully..."
    );
    server.close(() => {
      console.log("[Auth Service] Server closed");
      process.exit(0);
    });
  });
} 
