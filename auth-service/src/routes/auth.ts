import { Router, Request, Response, CookieOptions } from 'express';
import { RedisClientType } from 'redis';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  verifySignature,
  generateToken,
  validateToken,
  generateLoginPayload,
  isAuthConfigured,
} from '../utils/thirdwebAuth';
import { verifyTonSignature, type SignDataPayloadVariant } from '../ton/signData';
import { verifyTonProofSignature, type TonProofInput } from '../ton/tonProof';

const TON_PROOF_TTL_SECONDS = Number(process.env.TON_PROOF_TTL_SECONDS ?? 5 * 60);
const TON_JWT_SECRET = process.env.TON_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_PRIVATE_KEY || '';
const TON_JWT_ISSUER = process.env.TON_JWT_ISSUER || process.env.JWT_ISSUER || 'panoramablock-ton';
const TON_JWT_AUDIENCE = process.env.TON_JWT_AUDIENCE || process.env.JWT_AUDIENCE || 'panoramablock';
const TON_JWT_EXPIRATION = process.env.TON_JWT_EXPIRATION || '24h';
const TON_PROOF_KEY_PREFIX = 'tonproof:';

// Debug log for JWT configuration (hashed secret to avoid leaking)
(() => {
  const hashSecret = (value: string) => createHash('sha256').update(value || '').digest('hex').slice(0, 8);
  console.log('[AUTH] TON JWT config', {
    issuer: TON_JWT_ISSUER,
    audience: TON_JWT_AUDIENCE,
    expiration: TON_JWT_EXPIRATION,
    secretHash: hashSecret(TON_JWT_SECRET)
  });
})();

function tonProofKey(payload: string) {
  return `${TON_PROOF_KEY_PREFIX}${payload}`;
}

async function storeTonProof(redisClient: RedisClientType, payload: string, address?: string) {
  const expiresAt = new Date(Date.now() + TON_PROOF_TTL_SECONDS * 1000).toISOString();
  const key = tonProofKey(payload);
  await redisClient.set(
    key,
    JSON.stringify({ address, expiresAt }),
    { EX: TON_PROOF_TTL_SECONDS, NX: true }
  );
  return { payload, expiresAt };
}

async function consumeTonProof(redisClient: RedisClientType, payload: string) {
  const key = tonProofKey(payload);
  const raw = await redisClient.get(key);
  if (!raw) return null;
  await redisClient.del(key);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildTonJwt(address: string) {
  if (!TON_JWT_SECRET) {
    throw new Error('TON_JWT_SECRET must be configured');
  }
  return jwt.sign(
    { sub: address, type: 'ton' },
    TON_JWT_SECRET,
    {
      issuer: TON_JWT_ISSUER,
      audience: TON_JWT_AUDIENCE,
      expiresIn: TON_JWT_EXPIRATION,
    }
  );
}

function decodeTonJwt(token: string) {
  if (!TON_JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, TON_JWT_SECRET, {
      issuer: TON_JWT_ISSUER,
      audience: TON_JWT_AUDIENCE,
    }) as Record<string, any>;
    if (!decoded?.sub) {
      return null;
    }
    return {
      address: decoded.sub,
      type: decoded.type || 'ton',
      issuedAt: decoded.iat,
      expiresAt: decoded.exp,
    };
  } catch {
    return null;
  }
}

const REFRESH_COOKIE_NAME = process.env.AUTH_REFRESH_COOKIE_NAME || 'panorama_refresh';
const REFRESH_TTL_SECONDS = Number(process.env.AUTH_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 14); // default 14 days
const TELEGRAM_LINK_KEY_PREFIX = 'telegram_link:';
const TELEGRAM_LINK_TTL_SECONDS_RAW = Number(process.env.TELEGRAM_LINK_TTL_SECONDS ?? '');
const TELEGRAM_LINK_TTL_SECONDS =
  Number.isFinite(TELEGRAM_LINK_TTL_SECONDS_RAW) && TELEGRAM_LINK_TTL_SECONDS_RAW > 0
    ? Math.floor(TELEGRAM_LINK_TTL_SECONDS_RAW)
    : null;

const shouldForceSecureCookie =
  (process.env.AUTH_COOKIE_SECURE || '').toLowerCase() === 'true' ||
  (process.env.NODE_ENV || '').toLowerCase() === 'production';

const configuredSameSite = (process.env.AUTH_COOKIE_SAMESITE || '').toLowerCase() as
  | 'lax'
  | 'strict'
  | 'none'
  | '';

const resolveSameSite = (): 'lax' | 'strict' | 'none' => {
  if (configuredSameSite === 'lax' || configuredSameSite === 'strict') {
    return configuredSameSite;
  }
  if (configuredSameSite === 'none') {
    return shouldForceSecureCookie ? 'none' : 'lax';
  }
  return shouldForceSecureCookie ? 'none' : 'lax';
};

const buildCookieOptions = (overrides?: Partial<CookieOptions>): CookieOptions => {
  const base: CookieOptions = {
    httpOnly: true,
    secure: shouldForceSecureCookie,
    sameSite: resolveSameSite(),
    path: '/',
    maxAge: REFRESH_TTL_SECONDS * 1000,
  };

  const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (cookieDomain) {
    base.domain = cookieDomain;
  }

  return { ...base, ...overrides };
};

const setRefreshCookie = (res: Response, sessionId: string) => {
  res.cookie(REFRESH_COOKIE_NAME, sessionId, buildCookieOptions());
};

const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, buildCookieOptions({ maxAge: 0 }));
};

const parseRefreshCookie = (req: Request): string | null => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const needle = `${REFRESH_COOKIE_NAME}=`;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(needle)) {
      return decodeURIComponent(trimmed.substring(needle.length));
    }
  }
  return null;
};

const createSessionId = () => randomBytes(32).toString('base64url');

function telegramLinkKey(telegramUserId: string) {
  return `${TELEGRAM_LINK_KEY_PREFIX}${telegramUserId}`;
}

const SUNSET_DATE = process.env.AUTH_LEGACY_SUNSET_DATE ?? 'Sat, 30 Aug 2025 00:00:00 GMT';

export default function authRoutes(redisClient: RedisClientType) {
  const router = Router();

  // Mark all /auth/* routes as deprecated — successor routes are under /v1/capability/auth/*
  router.use((_req, res, next) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', SUNSET_DATE);
    res.setHeader('Link', '</v1/capability/auth>; rel="successor-version"');
    next();
  });

  router.post('/telegram/link', async (req: Request, res: Response) => {
    try {
      const telegramUserId = String(req.body?.telegram_user_id || '').trim();
      const zicoUserId = String(req.body?.zico_user_id || '').trim();
      const sessionId = String(req.body?.session_id || '').trim() || null;
      const address = String(req.body?.address || '').trim() || null;
      const source = String(req.body?.source || '').trim() || null;

      if (!telegramUserId || !zicoUserId) {
        return res.status(400).json({
          error: "Both 'telegram_user_id' and 'zico_user_id' are required.",
        });
      }

      const key = telegramLinkKey(telegramUserId);
      const linkedAt = new Date().toISOString();
      const payload = {
        telegram_user_id: telegramUserId,
        zico_user_id: zicoUserId,
        session_id: sessionId,
        address,
        source,
        linked_at: linkedAt,
      };

      if (TELEGRAM_LINK_TTL_SECONDS) {
        await redisClient.set(key, JSON.stringify(payload), {
          EX: TELEGRAM_LINK_TTL_SECONDS,
        });
      } else {
        await redisClient.set(key, JSON.stringify(payload));
      }

      console.log('[AUTH TELEGRAM LINK] mapping stored', {
        telegram_user_id: telegramUserId,
        zico_user_id: zicoUserId,
        ttl_seconds: TELEGRAM_LINK_TTL_SECONDS,
      });

      return res.json({
        success: true,
        telegram_user_id: telegramUserId,
        zico_user_id: zicoUserId,
        linked_at: linkedAt,
      });
    } catch (error: any) {
      console.error('[AUTH TELEGRAM LINK] failed', error);
      return res.status(500).json({ error: error?.message || 'Failed to link telegram identity' });
    }
  });

  router.get('/telegram/resolve', async (req: Request, res: Response) => {
    try {
      const telegramUserId = String(req.query?.telegram_user_id || '').trim();
      if (!telegramUserId) {
        return res.status(400).json({ error: "'telegram_user_id' query parameter is required." });
      }

      const key = telegramLinkKey(telegramUserId);
      const raw = await redisClient.get(key);
      if (!raw) {
        return res.json({
          success: true,
          telegram_user_id: telegramUserId,
          found: false,
        });
      }

      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }

      const zicoUserId = parsed?.zico_user_id;
      if (!zicoUserId || typeof zicoUserId !== 'string') {
        return res.json({
          success: true,
          telegram_user_id: telegramUserId,
          found: false,
        });
      }

      return res.json({
        success: true,
        telegram_user_id: telegramUserId,
        zico_user_id: zicoUserId,
        linked_at: parsed?.linked_at ?? null,
        found: true,
      });
    } catch (error: any) {
      console.error('[AUTH TELEGRAM RESOLVE] failed', error);
      return res.status(500).json({ error: error?.message || 'Failed to resolve telegram identity' });
    }
  });

  // Login route - generates payload for wallet to sign
  router.post('/login', async (req: Request, res: Response) => {
    try {
      console.log('🔐 [AUTH LOGIN] Login request received');

      if (!isAuthConfigured()) {
        console.log('❌ [AUTH LOGIN] Auth service not configured');
        return res
          .status(503)
          .json({ error: 'Auth service not configured: missing AUTH_PRIVATE_KEY' });
      }

      const { address } = req.body;
      console.log('📝 [AUTH LOGIN] Address received:', address);

      if (!address) {
        console.log('❌ [AUTH LOGIN] Address not provided');
        return res.status(400).json({ error: 'Address not provided' });
      }

      // Generate a payload using ThirdWeb SDK
      console.log('⚙️ [AUTH LOGIN] Generating login payload for address:', address);
      const payload = await generateLoginPayload(address);
      console.log('✅ [AUTH LOGIN] Login payload generated successfully');

      res.status(200).json({ payload });
    } catch (error: any) {
      console.error('❌ [AUTH LOGIN] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Verify route - verifies signature and generates JWT
  router.post('/verify', async (req: Request, res: Response) => {
    try {
      console.log('🔍 [AUTH VERIFY] Verify request received');

      if (!isAuthConfigured()) {
        console.log('❌ [AUTH VERIFY] Auth service not configured');
        return res
          .status(503)
          .json({ error: 'Auth service not configured: missing AUTH_PRIVATE_KEY' });
      }

      const { payload, signature } = req.body;
      console.log('📝 [AUTH VERIFY] Payload and signature received');

      if (!payload || !signature) {
        console.log('❌ [AUTH VERIFY] Payload or signature not provided');
        return res.status(400).json({ error: 'Payload or signature not provided' });
      }

      // Verify the signature and obtain the user address
      console.log('🔐 [AUTH VERIFY] Verifying signature...');
      const address = await verifySignature(payload, signature);
      console.log('✅ [AUTH VERIFY] Signature verified for address:', address);

      // Generate a JWT token using the full login payload (payload + signature)
      console.log('🎫 [AUTH VERIFY] Generating JWT token...');
      const token = await generateToken({ payload, signature });
      console.log('✅ [AUTH VERIFY] JWT token generated successfully');

      // Create a session in Redis
      const sessionId = createSessionId();
      const sessionData = {
        userId: address,
        address,
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isValid: true,
        payload,
        signature,
      };

      console.log('💾 [AUTH VERIFY] Creating session in Redis:', sessionId);
      await redisClient.set(`session:${sessionId}`, JSON.stringify(sessionData), {
        EX: REFRESH_TTL_SECONDS,
      });
      console.log('✅ [AUTH VERIFY] Session created successfully');

      setRefreshCookie(res, sessionId);

      const response = {
        token,
        address,
        sessionId,
      };

      console.log('📤 [AUTH VERIFY] Sending response:', {
        tokenLength: token.length,
        address: address,
        sessionId: sessionId,
        tokenPreview: token.substring(0, 50) + '...',
      });

      return res.json(response);
    } catch (error: any) {
      console.error('❌ [AUTH VERIFY] Error:', error);
      clearRefreshCookie(res);
      return res.status(401).json({ error: error.message });
    }
  });

  router.post('/ton/payload', async (req: Request, res: Response) => {
    try {
      const { address } = req.body;

      const payload = randomBytes(32).toString('hex');
      const stored = await storeTonProof(redisClient, payload, address);
      return res.json({
        payload: stored.payload,
        expiresAt: stored.expiresAt,
      });
    } catch (error: any) {
      console.error('[AUTH TON] Failed to create proof payload', error);
      return res.status(500).json({ error: 'Could not generate proof payload' });
    }
  });

  router.post('/ton/verify', async (req: Request, res: Response) => {
    try {
      const {
        address,
        payload,
        signature,
        publicKey,
        timestamp,
        domain,
        payloadMeta,
        proof,
        public_key,
      } = req.body;

      // New flow: TonConnect proof verification
      if (proof) {
        const typedProof = proof as TonProofInput;
        if (!address || !public_key || !typedProof?.payload || !typedProof?.signature || !typedProof?.domain?.value || !typedProof?.timestamp) {
          return res.status(400).json({ error: 'Missing ton_proof verification arguments' });
        }

        const stored = await consumeTonProof(redisClient, typedProof.payload);
        if (!stored || (stored.address && stored.address !== address)) {
          return res.status(400).json({ error: 'Proof expired or mismatched' });
        }

        const timestampNumber = Number(typedProof.timestamp);
        if (!Number.isFinite(timestampNumber) || timestampNumber <= 0) {
          return res.status(400).json({ error: 'Invalid timestamp' });
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const skew = Math.abs(nowSeconds - timestampNumber);
        if (skew > TON_PROOF_TTL_SECONDS) {
          return res.status(400).json({ error: 'Proof timestamp expired' });
        }

        const domainValue = typedProof.domain.value;
        const expectedDomain = process.env.TON_PROOF_DOMAIN;
        if (expectedDomain && domainValue !== expectedDomain) {
          return res.status(400).json({ error: 'Domain mismatch' });
        }
        if (typedProof.domain.lengthBytes !== Buffer.from(domainValue, 'utf8').length) {
          return res.status(400).json({ error: 'Invalid domain length' });
        }

        if (!verifyTonProofSignature({
          payload: typedProof.payload,
          signature: typedProof.signature,
          publicKey: public_key,
          address,
          domain: domainValue,
          timestamp: timestampNumber,
        })) {
          return res.status(401).json({ error: 'Signature validation failed' });
        }

        const token = buildTonJwt(address);
        return res.json({ token, address });
      }

      // Legacy flow: signData verification
      if (!address || !payload || !signature || !publicKey || !timestamp || !domain) {
        return res.status(400).json({ error: 'Missing verification arguments' });
      }

      const stored = await consumeTonProof(redisClient, payload);
      if (!stored || (stored.address && stored.address !== address)) {
        return res.status(400).json({ error: 'Proof expired or mismatched' });
      }

      const timestampNumber = Number(timestamp);
      if (!Number.isFinite(timestampNumber) || timestampNumber <= 0) {
        return res.status(400).json({ error: 'Invalid timestamp' });
      }

      if (!verifyTonSignature({ payload, signature, publicKey, address, domain, timestamp: timestampNumber, payloadMeta })) {
        return res.status(401).json({ error: 'Signature validation failed' });
      }

      const token = buildTonJwt(address);
      return res.json({ token, address });
    } catch (error: any) {
      console.error('[AUTH TON] Verification failed', error);
      return res.status(500).json({ error: error.message || 'Ton verification failed' });
    }
  });

  // Validate token route - for internal services
  router.post('/validate', async (req: Request, res: Response) => {
    const { token, sessionId } = req.body;
    console.log('🔍 [AUTH VALIDATE] Token validation request received');
    console.log('📝 [AUTH VALIDATE] Token and sessionId received:', {
      tokenPresent: !!token,
      sessionIdPresent: !!sessionId,
    });

    if (!token) {
      console.log('❌ [AUTH VALIDATE] Token not provided');
      return res.status(400).json({ error: 'Token not provided' });
    }

    const tonPayload = decodeTonJwt(token);
    if (tonPayload) {
      console.log('✅ [AUTH VALIDATE] TON JWT token validated');
      return res.json({
        isValid: true,
        payload: tonPayload,
      });
    }

    try {
      if (!isAuthConfigured()) {
        console.log('❌ [AUTH VALIDATE] Auth service not configured');
        return res
          .status(503)
          .json({ error: 'Auth service not configured: missing AUTH_PRIVATE_KEY' });
      }

      console.log('🔐 [AUTH VALIDATE] Validating JWT token...');
      const authData = await validateToken(token);
      console.log('✅ [AUTH VALIDATE] JWT token validated successfully');

      if (sessionId) {
        console.log('💾 [AUTH VALIDATE] Checking session validity:', sessionId);
        const sessionData = await redisClient.get(`session:${sessionId}`);

        if (!sessionData) {
          console.log('❌ [AUTH VALIDATE] Session not found:', sessionId);
          return res.status(401).json({ error: 'Session not found' });
        }

        const session = JSON.parse(sessionData);

        if (!session.isValid) {
          console.log('❌ [AUTH VALIDATE] Session is invalid:', sessionId);
          return res.status(401).json({ error: 'Session is invalid' });
        }

        console.log('✅ [AUTH VALIDATE] Session is valid:', sessionId);
      }

      console.log('✅ [AUTH VALIDATE] Token validation successful');
      return res.json({
        isValid: true,
        payload: authData,
      });
    } catch (error: any) {
      console.error('❌ [AUTH VALIDATE] Error:', error);
      return res.status(401).json({ error: error.message });
    }
  });

  // Logout route
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      console.log('🚪 [AUTH LOGOUT] Logout request received');

      if (!isAuthConfigured()) {
        console.log('❌ [AUTH LOGOUT] Auth service not configured');
        return res
          .status(503)
          .json({ error: 'Auth service not configured: missing AUTH_PRIVATE_KEY' });
      }

      const { sessionId } = req.body;
      console.log('📝 [AUTH LOGOUT] SessionId received:', sessionId);

      const refreshSessionId = sessionId || parseRefreshCookie(req);
      if (!refreshSessionId) {
        console.log('❌ [AUTH LOGOUT] Session ID not provided');
        clearRefreshCookie(res);
        return res.status(400).json({ error: 'Session ID not provided' });
      }

      console.log('💾 [AUTH LOGOUT] Checking session in Redis:', refreshSessionId);
      const sessionData = await redisClient.get(`session:${refreshSessionId}`);

      if (!sessionData) {
        console.log('❌ [AUTH LOGOUT] Session not found:', refreshSessionId);
        clearRefreshCookie(res);
        return res.status(404).json({ error: 'Session not found' });
      }

  const session = JSON.parse(sessionData);
  session.isValid = false;
  session.updatedAt = new Date().toISOString();

  console.log('🔄 [AUTH LOGOUT] Invalidating session:', refreshSessionId);
      await redisClient.set(`session:${refreshSessionId}`, JSON.stringify(session), {
        KEEPTTL: true, // Keep the original TTL
      });

      clearRefreshCookie(res);

      console.log('✅ [AUTH LOGOUT] Session invalidated successfully');
      return res.json({ success: true });
    } catch (error: any) {
      console.error('❌ [AUTH LOGOUT] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/session/refresh', async (req: Request, res: Response) => {
    try {
      console.log('🔄 [AUTH REFRESH] Refresh request received');

      if (!isAuthConfigured()) {
        console.log('❌ [AUTH REFRESH] Auth service not configured');
        return res
          .status(503)
          .json({ error: 'Auth service not configured: missing AUTH_PRIVATE_KEY' });
      }

      const existingSessionId = parseRefreshCookie(req);
      if (!existingSessionId) {
        console.log('❌ [AUTH REFRESH] Refresh cookie not present');
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Refresh session not found' });
      }

      console.log('💾 [AUTH REFRESH] Loading session from Redis:', existingSessionId);
      const sessionData = await redisClient.get(`session:${existingSessionId}`);
      if (!sessionData) {
        console.log('❌ [AUTH REFRESH] Session not found:', existingSessionId);
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Session not found' });
      }

      const session = JSON.parse(sessionData);
      if (!session.isValid) {
        console.log('❌ [AUTH REFRESH] Session invalid:', existingSessionId);
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Session invalidated' });
      }

      if (!session.payload || !session.signature) {
        console.log('❌ [AUTH REFRESH] Session missing payload/signature:', existingSessionId);
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Session missing refresh data' });
      }

      console.log('🎫 [AUTH REFRESH] Generating new JWT token...');
      const token = await generateToken({
        payload: session.payload,
        signature: session.signature,
      });
      console.log('✅ [AUTH REFRESH] Token refreshed successfully');

      const newSessionId = createSessionId();
      session.sessionId = newSessionId;
      session.updatedAt = new Date().toISOString();

      const pipeline = redisClient.multi();
      pipeline.set(`session:${newSessionId}`, JSON.stringify(session), { EX: REFRESH_TTL_SECONDS });
      pipeline.del(`session:${existingSessionId}`);
      await pipeline.exec();

      setRefreshCookie(res, newSessionId);

      return res.json({
        token,
        address: session.address,
        sessionId: newSessionId,
      });
    } catch (error: any) {
      console.error('❌ [AUTH REFRESH] Error:', error);
      clearRefreshCookie(res);
      return res.status(500).json({ error: error.message || 'Failed to refresh session' });
    }
  });

  return router;
}
