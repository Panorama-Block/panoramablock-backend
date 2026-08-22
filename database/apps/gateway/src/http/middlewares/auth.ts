import { timingSafeEqual } from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import jwt, { JwtPayload } from 'jsonwebtoken';

const isHealthRoute = (request: FastifyRequest): boolean => {
  return (request.routeOptions?.url ?? request.url) === '/health';
};

const bearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const stringClaim = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const rolesClaim = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is string => typeof role === 'string');
};

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const authMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  if (isHealthRoute(request)) {
    return;
  }

  const token = bearerToken(request.headers.authorization);

  if (!token) {
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Bearer token required'
    });
    return;
  }

  const headerTenant = request.headers['x-tenant-id'];

  const legacyServiceToken = process.env.DB_GATEWAY_SERVICE_TOKEN;
  const legacyTenant =
    process.env.DB_GATEWAY_TENANT_ID || 'panorama-default';

  if (
    legacyServiceToken &&
    safeEqual(token, legacyServiceToken)
  ) {
    if (
      typeof headerTenant === 'string' &&
      headerTenant !== legacyTenant
    ) {
      reply.status(403).send({
        error: 'tenant_mismatch',
        message: 'Service token tenant does not match x-tenant-id'
      });
      return;
    }

    request.ctx = {
      ...(request.ctx ?? {
        requestId: request.id,
        headers: request.headers as Record<
          string,
          string | string[] | undefined
        >
      }),
      tenantId: legacyTenant,
      actor: {
        id: 'db-gateway-service-token',
        service: 'legacy-db-gateway-client',
        roles: ['service']
      }
    };

    return;
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    request.log.error('JWT_SECRET is not configured');
    reply.status(500).send({
      error: 'auth_configuration_error',
      message: 'Gateway authentication is not configured'
    });
    return;
  }

  let decoded: JwtPayload;

  try {
    const verified = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      ...(process.env.JWT_AUDIENCE
        ? { audience: process.env.JWT_AUDIENCE }
        : {}),
      ...(process.env.JWT_ISSUER
        ? { issuer: process.env.JWT_ISSUER }
        : {})
    });

    if (typeof verified === 'string') {
      throw new Error('JWT payload must be an object');
    }

    decoded = verified;
  } catch (error) {
    request.log.warn(
      { err: error, requestId: request.id },
      'JWT verification failed'
    );

    reply.status(401).send({
      error: 'unauthorized',
      message: 'Invalid or expired bearer token'
    });
    return;
  }

  const tokenTenant = stringClaim(decoded.tenant);

  if (!tokenTenant) {
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Token tenant claim required'
    });
    return;
  }

  if (
    typeof headerTenant === 'string' &&
    headerTenant !== tokenTenant
  ) {
    reply.status(403).send({
      error: 'tenant_mismatch',
      message: 'Token tenant does not match x-tenant-id'
    });
    return;
  }

  request.ctx = {
    ...(request.ctx ?? {
      requestId: request.id,
      headers: request.headers as Record<
        string,
        string | string[] | undefined
      >
    }),
    tenantId: tokenTenant,
    actor: {
      id: stringClaim(decoded.sub),
      service: stringClaim(decoded.service),
      roles: rolesClaim(decoded.roles)
    }
  };
};
