import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import type { RedisClientType } from 'redis';
import { ProviderRegistry, createDiscoveryHandler } from '@panorama/capability';
import type { IAuthProvider } from '../../domain/ports/auth.provider.port';
import { ThirdwebAuthAdapter } from '../../infrastructure/adapters/thirdweb.auth.adapter';
import {
  TelegramAuthAdapter,
  type TelegramRegisterMeta,
} from '../../infrastructure/adapters/telegram.auth.adapter';

const REFRESH_TTL_SECONDS =
  Number(process.env.AUTH_REFRESH_TTL_SECONDS ?? '') || 60 * 60 * 24 * 14;

const TON_JWT_SECRET =
  process.env.TON_JWT_SECRET ??
  process.env.JWT_SECRET ??
  process.env.AUTH_PRIVATE_KEY ??
  '';
const TON_JWT_ISSUER =
  process.env.TON_JWT_ISSUER ?? process.env.JWT_ISSUER ?? 'panoramablock-ton';
const TON_JWT_AUDIENCE =
  process.env.TON_JWT_AUDIENCE ?? process.env.JWT_AUDIENCE ?? 'panoramablock';

export class AuthCapabilityService {
  readonly registry: ProviderRegistry<IAuthProvider>;
  readonly thirdweb: ThirdwebAuthAdapter;
  readonly telegram: TelegramAuthAdapter;
  readonly discoveryHandler: ReturnType<typeof createDiscoveryHandler>;

  constructor(private readonly redis: RedisClientType) {
    this.thirdweb = new ThirdwebAuthAdapter();
    this.telegram = new TelegramAuthAdapter(redis);

    this.registry = new ProviderRegistry<IAuthProvider>();
    this.registry.register(this.thirdweb);
    this.registry.register(this.telegram);

    this.discoveryHandler = createDiscoveryHandler({
      listProviders: () => this.registry.listAll(),
      cacheTtlSeconds: 30,
    });
  }

  async login(address: string) {
    return this.thirdweb.login(address);
  }

  async verify(payload: unknown, signature: string) {
    const { token, address } = await this.thirdweb.verify(payload, signature);
    const sessionId = randomBytes(32).toString('base64url');
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify({
        userId: address,
        address,
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isValid: true,
        payload,
        signature,
      }),
      { EX: REFRESH_TTL_SECONDS },
    );
    return { token, address, sessionId };
  }

  async exchangeTelegramJWT(initData: string) {
    return this.telegram.exchangeTelegramJWT(initData);
  }

  async registerTelegram(
    telegramUserId: string,
    zicoUserId: string,
    meta?: TelegramRegisterMeta,
  ) {
    const token = await this.telegram.register(telegramUserId, zicoUserId, meta);
    return { token, telegramUserId, zicoUserId };
  }

  /**
   * Validates any Panorama JWT — tries TON first (backward compat), then ThirdWeb.
   * This is the single dispatch point for the /auth/validate route and the middleware.
   */
  async validateToken(token: string): Promise<{ isValid: boolean; payload: unknown }> {
    const ton = this.decodeTonJwt(token);
    if (ton) return { isValid: true, payload: ton };
    const authData = await this.thirdweb.validateToken(token);
    return { isValid: true, payload: authData };
  }

  private decodeTonJwt(token: string): unknown | null {
    if (!TON_JWT_SECRET) return null;
    try {
      const decoded = jwt.verify(token, TON_JWT_SECRET, {
        issuer: TON_JWT_ISSUER,
        audience: TON_JWT_AUDIENCE,
      }) as Record<string, unknown>;
      if (!decoded?.sub) return null;
      return {
        address: decoded.sub,
        type: decoded.type ?? 'ton',
        issuedAt: decoded.iat,
        expiresAt: decoded.exp,
      };
    } catch {
      return null;
    }
  }
}
