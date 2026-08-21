import { Request, Response, NextFunction } from 'express';

interface LogData {
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  query?: any;
  params?: any;
  ip: string;
  userAgent: string;
  responseStatus?: number;
  responseTime?: number;
  responseBody?: any;
}

const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set_cookie',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'sessionid',
  'session_id',
  'signature',
  'password',
  'passphrase',
  'secret',
  'secretkey',
  'secret_key',
  'privatekey',
  'private_key',
  'auth_private_key',
  'jwt_secret',
  'ton_jwt_secret',
  'redis_pass',
  'engine_access_token',
  'thirdweb_secret_key',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-\s]/g, '_');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  if (SENSITIVE_KEYS.has(normalized)) {
    return true;
  }

  return (
    normalized.endsWith('_token') ||
    normalized.endsWith('_secret') ||
    normalized.endsWith('_password') ||
    normalized.endsWith('_private_key') ||
    normalized.endsWith('_signature') ||
    normalized.endsWith('_session_id')
  );
}

export function sanitizeForLogging(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[CIRCULAR]';
  }

  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogging(item, seen));
  }

  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : sanitizeForLogging(item, seen);
  }

  return output;
}

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const logData: LogData = {
    timestamp,
    method: req.method,
    url: req.originalUrl || req.url,
    headers: req.headers as Record<string, string>,
    body: req.body,
    query: req.query,
    params: req.params,
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
  };

  console.log('\n🚀 [REQUEST INCOMING]', {
    timestamp: logData.timestamp,
    method: logData.method,
    url: logData.url,
    ip: logData.ip,
    userAgent: logData.userAgent,
    headers: {
      'content-type': logData.headers['content-type'],
      authorization: logData.headers['authorization']
        ? '[PRESENT]'
        : '[NOT PRESENT]',
      cookie: logData.headers['cookie']
        ? '[PRESENT]'
        : '[NOT PRESENT]',
      'user-agent': logData.userAgent,
    },
    body: sanitizeForLogging(logData.body),
    query: sanitizeForLogging(logData.query),
    params: sanitizeForLogging(logData.params),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT || process.env.AUTH_PORT,
      REDIS_HOST: process.env.REDIS_HOST,
      REDIS_PORT: process.env.REDIS_PORT,
      AUTH_DOMAIN: process.env.AUTH_DOMAIN,
      AUTH_PRIVATE_KEY: process.env.AUTH_PRIVATE_KEY ? '[SET]' : '[NOT SET]',
      DEBUG: process.env.DEBUG,
    },
  });

  const originalJson = res.json;

  res.json = function(body: any) {
    const responseTime = Date.now() - startTime;

    console.log('\n📤 [RESPONSE OUTGOING]', {
      timestamp: new Date().toISOString(),
      method: logData.method,
      url: logData.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      responseBody: sanitizeForLogging(body),
      ip: logData.ip,
    });

    console.log('='.repeat(80));

    return originalJson.call(this, body);
  };

  const originalStatus = res.status;

  res.status = function(code: number) {
    const responseTime = Date.now() - startTime;

    console.log(
      `\n📊 [STATUS CHANGE] ${logData.method} ${logData.url} -> ${code} (${responseTime}ms)`
    );

    return originalStatus.call(this, code);
  };

  next();
};

export const errorLogger = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const timestamp = new Date().toISOString();

  console.error('\n❌ [ERROR]', {
    timestamp,
    method: req.method,
    url: req.originalUrl || req.url,
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name,
    },
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
  });

  console.log('='.repeat(80));

  next(err);
};
