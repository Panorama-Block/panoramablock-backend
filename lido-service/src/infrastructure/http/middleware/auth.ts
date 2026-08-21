import { Request, Response, NextFunction } from 'express';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { Logger } from '../../logs/logger';
import { ERROR_CODES, sendError } from '../../../shared/errorCodes';

interface TokenValidationResponse {
  isValid: boolean;
  payload: {
    address: string;
    [key: string]: any;
  };
}

interface ErrorResponse {
  error: string;
  message: string;
}

interface AuthRequest extends Request {
  user?: any;
}

export class AuthMiddleware {
  private static logger = new Logger();

  /**
   * Authenticate middleware - validates JWT via centralized auth-service
   * Same authentication flow as liquid-swap-service
   */
  static async authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // Log authentication request
      AuthMiddleware.logger.info('🔍 [Lido Service] Authenticating request:');
      AuthMiddleware.logger.info(`   Method: ${req.method}`);
      AuthMiddleware.logger.info(`   URL: ${req.url}`);

      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        AuthMiddleware.logger.error('[Lido Service] No Authorization header or invalid format');
        sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'Authorization header required');
        return;
      }

      const token = authHeader.split(' ')[1];
      AuthMiddleware.logger.info('✅ [Lido Service] Bearer token extracted');

      // Validate token with centralized Auth Service
      try {
        const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
        AuthMiddleware.logger.info(`🔗 [Lido Service] Validating token with Auth Service: ${authServiceUrl}`);

        const response: AxiosResponse<TokenValidationResponse> =
          await axios.post(`${authServiceUrl}/auth/validate`, { token }, {
            ...(authServiceUrl.startsWith('https') && {
              httpsAgent: new (require('https').Agent)({
                rejectUnauthorized: process.env.NODE_ENV === 'production'
              })
            })
          });

        if (response.data.isValid) {
          req.user = response.data.payload;
          AuthMiddleware.logger.info(`[Lido Service] Token validated for user: ${req.user.address}`);
          next();
          return;
        } else {
          AuthMiddleware.logger.error('[Lido Service] Invalid token provided');
          sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'Token validation failed');
          return;
        }
      } catch (error) {
        const axiosError = error as AxiosError<ErrorResponse>;
        AuthMiddleware.logger.error('[Lido Service] Error validating token with Auth service:',
          axiosError.response?.data?.message || axiosError.message);

        const status = axiosError.response?.status;
        if (status === 401 || status === 400) {
          sendError(res, 401, ERROR_CODES.TOKEN_EXPIRED,
            axiosError.response?.data?.message || 'Token validation failed');
        } else {
          sendError(res, 503, ERROR_CODES.SERVICE_UNAVAILABLE,
            'Authentication service unavailable');
        }
        return;
      }
    } catch (error) {
      const err = error as Error;
      AuthMiddleware.logger.error(`[Lido Service] Unexpected error in auth middleware: ${err.message}`);
      sendError(res, 500, ERROR_CODES.SERVICE_UNAVAILABLE, 'Internal server error');
      return;
    }
  }

  /**
   * Optional authentication - validates token if present, but doesn't block if missing
   */
  static async optionalAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

          const response: AxiosResponse<TokenValidationResponse> =
            await axios.post(`${authServiceUrl}/auth/validate`, { token }, {
              ...(authServiceUrl.startsWith('https') && {
                httpsAgent: new (require('https').Agent)({
                  rejectUnauthorized: process.env.NODE_ENV === 'production'
                })
              })
            });

          if (response.data.isValid) {
            req.user = response.data.payload;
            AuthMiddleware.logger.debug(`✅ [Lido Service] Optional auth successful: ${req.user.address}`);
          }
        } catch (error) {
          // Token is invalid, but we continue without authentication
          AuthMiddleware.logger.warn(`⚠️ [Lido Service] Invalid token in optional auth: ${(error as Error).message}`);
        }
      }

      next();
    } catch (error) {
      AuthMiddleware.logger.error(`❌ [Lido Service] Optional authentication error: ${(error as Error).message}`);
      next(); // Continue even if there's an error
    }
  }

  /**
   * Require user address - validates that authenticated user matches requested resource
   */
  static requireUserAddress(req: AuthRequest, res: Response, next: NextFunction): void {
    try {
      if (!req.user || !req.user.address) {
        sendError(res, 401, ERROR_CODES.UNAUTHORIZED, 'User authentication required');
        return;
      }

      // Validate that the user address in the token matches the request
      const { userAddress } = req.params;
      if (userAddress && userAddress.toLowerCase() !== req.user.address.toLowerCase()) {
        sendError(res, 403, ERROR_CODES.UNAUTHORIZED, 'Access denied: token user does not match requested user');
        return;
      }

      next();
    } catch (error) {
      AuthMiddleware.logger.error(`❌ [Lido Service] User address validation error: ${(error as Error).message}`);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Require body userAddress to match the authenticated user
   * Useful for POST routes where the resource owner is provided in JSON body.
   */
  static requireBodyUserAddress(fieldName: string = 'userAddress') {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
      try {
        if (!req.user || !req.user.address) {
          res.status(401).json({
            success: false,
            error: 'User authentication required'
          });
          return;
        }

        const bodyAddress = (req.body as any)?.[fieldName];
        if (!bodyAddress || typeof bodyAddress !== 'string') {
          res.status(400).json({
            success: false,
            error: `${fieldName} is required`
          });
          return;
        }

        if (bodyAddress.toLowerCase() !== String(req.user.address).toLowerCase()) {
          res.status(403).json({
            success: false,
            error: 'Access denied: token user does not match requested user'
          });
          return;
        }

        next();
      } catch (error) {
        AuthMiddleware.logger.error(
          `❌ [Lido Service] Body user address validation error: ${(error as Error).message}`
        );
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    };
  }
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}
