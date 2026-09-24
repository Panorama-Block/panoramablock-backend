/**
 * Security Middleware
 * Enforces HTTPS and adds security headers
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Add security headers
 * Implements OWASP recommended security headers
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Strict-Transport-Security: Force HTTPS for 1 year
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // X-Content-Type-Options: Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // X-Frame-Options: Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // X-XSS-Protection: Enable XSS filter (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer-Policy: Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content-Security-Policy: Prevent XSS and injection attacks
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"
  );

  // Permissions-Policy: Restrict browser features
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  next();
}

/**
 * Remove sensitive headers
 * Hides server implementation details
 */
export function removeSensitiveHeaders(req: Request, res: Response, next: NextFunction) {
  // Remove X-Powered-By header (Express default)
  res.removeHeader('X-Powered-By');

  // Remove Server header if present
  res.removeHeader('Server');

  next();
}

/**
 * Request logging with security context
 */
export function securityLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();

  // Log after response is sent
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
    };

    // Log suspicious activity
    if (res.statusCode === 401 || res.statusCode === 403) {
      console.warn('[Security] Unauthorized access attempt:', logEntry);
    } else if (res.statusCode >= 500) {
      console.error('[Security] Server error:', logEntry);
    } else if (process.env.LOG_ALL_REQUESTS === 'true') {
      console.log('[Security] Request:', logEntry);
    }
  });

  next();
}

/**
 * Rate limit info header
 * Adds rate limit information to response
 */
export function rateLimitInfo(req: Request, res: Response, next: NextFunction) {
  // This will be populated by rate limit middleware
  const remaining = (req as any).rateLimit?.remaining;
  const limit = (req as any).rateLimit?.limit;
  const reset = (req as any).rateLimit?.resetTime;

  if (remaining !== undefined && limit !== undefined) {
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    if (reset) {
      res.setHeader('X-RateLimit-Reset', reset);
    }
  }

  next();
}

/**
 * Validate request size
 * Prevent large payload attacks
 */
export function validateRequestSize(maxSizeBytes: number = 1024 * 1024) { // 1MB default
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');

    if (contentLength > maxSizeBytes) {
      console.warn(`[Security] Request too large: ${contentLength} bytes (max: ${maxSizeBytes})`);
      return res.status(413).json({
        error: 'Payload Too Large',
        message: `Request size exceeds maximum of ${maxSizeBytes} bytes`
      });
    }

    next();
  };
}
