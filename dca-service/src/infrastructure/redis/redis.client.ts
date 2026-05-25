/**
 * Redis client singleton for idempotency storage.
 * Connection is lazy — the client connects on first use and reconnects automatically.
 * All public methods are safe to call even if Redis is unavailable (they fail open).
 */

import { createClient, type RedisClientType } from 'redis';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 h

class RedisIdempotencyClient {
  private client: RedisClientType | null = null;
  private connected = false;

  private async getClient(): Promise<RedisClientType | null> {
    if (this.connected && this.client) return this.client;

    try {
      const url = buildRedisUrl();
      this.client = createClient({ url }) as RedisClientType;

      this.client.on('error', (err) => {
        console.warn('[RedisIdempotency] client error:', err.message);
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;
      console.log('[RedisIdempotency] Connected');
      return this.client;
    } catch (err: any) {
      console.warn('[RedisIdempotency] Could not connect — idempotency disabled:', err.message);
      this.connected = false;
      this.client = null;
      return null;
    }
  }

  async get(key: string): Promise<unknown | null> {
    try {
      const c = await this.getClient();
      if (!c) return null;
      const raw = await c.get(prefixed(key));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      const c = await this.getClient();
      if (!c) return;
      await c.set(prefixed(key), JSON.stringify(value), { EX: IDEMPOTENCY_TTL_SECONDS });
    } catch (err: any) {
      console.warn('[RedisIdempotency] set failed:', err.message);
    }
  }
}

function prefixed(key: string): string {
  return `idempotency:dca:${key}`;
}

function buildRedisUrl(): string {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  const pass = process.env.REDIS_PASS;
  const tls = process.env.REDIS_TLS === 'true';
  const scheme = tls ? 'rediss' : 'redis';
  if (pass) return `${scheme}://:${pass}@${host}:${port}`;
  return `${scheme}://${host}:${port}`;
}

export const redisIdempotency = new RedisIdempotencyClient();
