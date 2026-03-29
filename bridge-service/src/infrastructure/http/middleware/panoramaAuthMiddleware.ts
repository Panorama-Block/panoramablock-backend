import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { JwtSecurityConfig } from './authenticationMiddleware';

export function panoramaAuthMiddleware(config: JwtSecurityConfig): RequestHandler {
  return (req, res, next) => {
    const expectedTenantId = process.env.DB_GATEWAY_TENANT_ID;
    const requestedTenantId = typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'] : undefined;
    if (expectedTenantId && requestedTenantId && requestedTenantId !== expectedTenantId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_FORBIDDEN',
          message: 'Tenant header does not match configured tenant',
          traceId: req.traceId,
        },
      });
    }

    const apiKeyHeader = req.headers['x-api-key'];
    const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined;
    const expectedApiKey = process.env.PANORAMA_API_KEY;

    if (apiKey && expectedApiKey && apiKey === expectedApiKey) {
      req.user = {
        id: req.headers['x-user-id']?.toString() || 'api-key-user',
        role: 'service',
      } as any;
      return next();
    }

    const authHeader = req.headers.authorization || req.headers.Authorization;
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required (Bearer token or x-api-key)',
          traceId: req.traceId,
        },
      });
    }

    try {
      const decoded = jwt.verify(token, config.secret, {
        algorithms: ['HS256', 'HS512'],
        issuer: config.issuer,
        audience: config.audience,
      }) as any;

      const userId = decoded?.sub || decoded?.userId || decoded?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Token payload missing subject',
            traceId: req.traceId,
          },
        });
      }

      req.user = {
        id: userId,
        role: decoded?.role || 'user',
        ...decoded,
      } as any;

      next();
    } catch {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired authentication token',
          traceId: req.traceId,
        },
      });
    }
  };
}
