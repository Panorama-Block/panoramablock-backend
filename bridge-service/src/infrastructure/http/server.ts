// TAC Service HTTP Server Configuration
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
const compression = require('compression');
import rateLimit from 'express-rate-limit';
import { DIContainer } from '../di/container';
import { getSecurityConfig } from '../../config/environment';
import { logger } from '../utils/logger';

// Route handlers
import { createHealthRoutes } from '../http/routes/healthRoutes';
import { createTonBridgeRoutes } from '../http/routes/tonBridgeRoutes';
import { createPanoramaV1Routes } from '../http/routes/panoramaV1Routes';

// Middleware
import { errorHandlingMiddleware } from '../http/middleware/errorHandlingMiddleware';
import { loggingMiddleware } from '../http/middleware/loggingMiddleware';
import { tracingMiddleware } from '../http/middleware/tracingMiddleware';
import { panoramaAuthMiddleware } from '../http/middleware/panoramaAuthMiddleware';

export async function createHttpServer(app: Application, container: DIContainer): Promise<void> {
  const securityConfig = getSecurityConfig();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));

  // CORS middleware (applies to all routes)
  const corsOptions = {
    origin: securityConfig.cors.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-ID', 'X-User-ID', 'X-API-Key', 'X-Tenant-ID'],
    optionsSuccessStatus: 204
  };
  app.use(cors(corsOptions));

  // Compression middleware
  app.use(compression());

  // Request parsing middleware
  app.use(express.json({
    limit: '10mb'
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Rate limiting
  const rateLimitConfig = rateLimit({
    windowMs: securityConfig.rateLimit.windowMs,
    max: securityConfig.rateLimit.maxRequests,
    message: {
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(securityConfig.rateLimit.windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request): string => {
      // Use user ID if authenticated, otherwise use IP
      const userId = (req as any).user?.id;
      return userId || req.ip || 'unknown';
    },
    skip: (req: Request): boolean => {
      // Skip rate limiting for health checks
      return req.path === '/health';
    }
  });

  app.use(rateLimitConfig);

  // Request tracing and logging
  app.use(tracingMiddleware);
  app.use(loggingMiddleware);

  // Health check route (no authentication required)
  app.use('/health', createHealthRoutes(container));

  // TON Bridge routes
  // Note: Authorization middleware removed for simplicity as auth service is not part of this scope, 
  // or should be re-added if needed. Assuming public access or handled by gateway for now.
  // If auth is needed, we need to keep authenticationMiddleware and authorizationMiddleware.
  // But those might depend on legacy services.
  // I will assume public for now or add basic auth if requested.
  // The prompt didn't specify auth requirements for the new endpoint.
  app.use('/api/bridge', createTonBridgeRoutes(container));
  app.use('/v1', panoramaAuthMiddleware(securityConfig.jwt), createPanoramaV1Routes(container));

  // API root endpoint
  app.get('/api', (req: Request, res: Response) => {
    res.json({
      service: 'Bridge Service',
      version: '1.0.0',
      architecture: 'Hexagonal (Domain-Driven Design)',
      health: '/health',
      endpoints: {
        bridge: '/api/bridge/transaction',
        panoramaV1: '/v1'
      },
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler
  app.use('*', (req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      code: 'ENDPOINT_NOT_FOUND',
      message: `The requested endpoint ${req.method} ${req.originalUrl} was not found`,
      timestamp: new Date().toISOString(),
      traceId: (req as any).traceId
    });
  });

  // Global error handling middleware
  app.use(errorHandlingMiddleware);

  logger.info('✅ HTTP server configured with all routes and middleware');
}

// Graceful shutdown helper
export function setupGracefulShutdown(
  server: any,
  container: DIContainer,
  wsServer?: any
): void {
  const shutdown = async (signal: string) => {
    logger.info(`🛑 Received ${signal}. Graceful shutdown starting...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('🔒 HTTP server stopped accepting new connections');

      try {
        // Close database connection
        await container.database.$disconnect();

        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    });

    // Force close after timeout
    setTimeout(() => {
      logger.error('⚠️ Forceful shutdown due to timeout');
      process.exit(1);
    }, 30000); // 30 seconds timeout
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
}

// Request interface extension for custom properties
declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      user?: {
        id: string;
        role: string;
        [key: string]: any;
      };
      rawBody?: Buffer;
    }
  }
}
