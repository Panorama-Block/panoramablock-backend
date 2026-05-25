import type { ProviderHealth, ProviderMetadata } from '@panorama/capability';
import type {
  IAuthProvider,
  LoginChallenge,
  VerifyResult,
  TelegramExchangeResult,
} from '../../domain/ports/auth.provider.port';
import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import type { RedisClientType } from 'redis';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const TELEGRAM_JWT_SECRET = process.env.TELEGRAM_JWT_SECRET ?? process.env.JWT_SECRET ?? '';
const TELEGRAM_JWT_ISSUER = process.env.TELEGRAM_JWT_ISSUER ?? 'panoramablock-telegram';
const TELEGRAM_JWT_AUDIENCE = process.env.TELEGRAM_JWT_AUDIENCE ?? 'panoramablock';
const TELEGRAM_JWT_EXPIRATION = process.env.TELEGRAM_JWT_EXPIRATION ?? '24h';
const LINK_KEY_PREFIX = 'telegram_link:';
const LINK_TTL_SECONDS = (() => {
  const v = Number(process.env.TELEGRAM_LINK_TTL_SECONDS ?? '');
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
})();

export interface TelegramRegisterMeta {
  sessionId?: string;
  address?: string;
  source?: string;
}

export class TelegramAuthAdapter implements IAuthProvider {
  readonly name = 'telegram';
  readonly metadata: ProviderMetadata = {
    name: 'telegram',
    capability: 'auth',
    supportedChains: [1, 137, 8453, 43114],
    features: ['telegram-jwt-exchange', 'identity-register'],
    version: '1.0.0',
  };

  constructor(private readonly redis: RedisClientType) {}

  async login(_address: string): Promise<LoginChallenge> {
    throw new Error('TelegramAuthAdapter does not support EVM login — use exchangeTelegramJWT()');
  }

  async verify(_payload: unknown, _signature: string): Promise<VerifyResult> {
    throw new Error('TelegramAuthAdapter does not support EVM verify — use exchangeTelegramJWT()');
  }

  async exchangeTelegramJWT(initData: string): Promise<TelegramExchangeResult> {
    const telegramUserId = this.validateInitData(initData);
    const token = this.issueToken(telegramUserId);
    return { token, telegramUserId };
  }

  /**
   * Store telegram→zico identity mapping in Redis and issue a JWT for the telegram user.
   * Returns the issued token so the caller can hand it to the client immediately.
   */
  async register(
    telegramUserId: string,
    zicoUserId: string,
    meta?: TelegramRegisterMeta,
  ): Promise<string> {
    const key = `${LINK_KEY_PREFIX}${telegramUserId}`;
    const record = {
      telegram_user_id: telegramUserId,
      zico_user_id: zicoUserId,
      session_id: meta?.sessionId ?? null,
      address: meta?.address ?? null,
      source: meta?.source ?? null,
      linked_at: new Date().toISOString(),
    };
    const opts = LINK_TTL_SECONDS ? { EX: LINK_TTL_SECONDS } : {};
    await this.redis.set(key, JSON.stringify(record), opts);
    return this.issueToken(telegramUserId);
  }

  issueToken(telegramUserId: string): string {
    if (!TELEGRAM_JWT_SECRET) throw new Error('TELEGRAM_JWT_SECRET not configured');
    return jwt.sign(
      { sub: telegramUserId, type: 'telegram' },
      TELEGRAM_JWT_SECRET,
      {
        issuer: TELEGRAM_JWT_ISSUER,
        audience: TELEGRAM_JWT_AUDIENCE,
        expiresIn: TELEGRAM_JWT_EXPIRATION,
      },
    );
  }

  supportsRoute(route: string): boolean {
    return ['telegram/exchange', 'telegram/register'].includes(route);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const healthy = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_JWT_SECRET);
    return {
      healthy,
      checkedAt: new Date().toISOString(),
      ...(healthy ? {} : { reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_JWT_SECRET not set' }),
    };
  }

  /**
   * Validates Telegram WebApp initData using HMAC-SHA256 per the Bot API spec.
   * Returns the telegram user id on success, throws on failure.
   */
  private validateInitData(initData: string): string {
    if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) throw new Error('Missing hash in Telegram initData');

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
    const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (expected !== hash) throw new Error('Telegram initData verification failed');

    const userRaw = params.get('user');
    if (!userRaw) throw new Error('Missing user in Telegram initData');

    const user = JSON.parse(userRaw) as Record<string, unknown>;
    if (!user?.id) throw new Error('Invalid user in Telegram initData');

    return String(user.id);
  }
}
