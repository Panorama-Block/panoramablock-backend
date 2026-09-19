import { createHash } from 'crypto';

type PlainObject = Record<string, unknown>;

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export class IdentityPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityPersistenceError';
  }
}

function normalizeAddress(address: string): string {
  const normalized = String(address || '').trim().toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    throw new IdentityPersistenceError('Verified identity did not contain a valid EVM address');
  }

  return normalized;
}

function stableKeyPart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function asObject(value: unknown): PlainObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as PlainObject;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class IdentityPersistenceService {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly tenantId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    baseUrl?: string;
    serviceToken?: string;
    tenantId?: string;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
  }) {
    this.baseUrl = (
      options?.baseUrl ??
      process.env.DB_GATEWAY_URL ??
      ''
    ).replace(/\/+$/, '');

    this.serviceToken =
      options?.serviceToken ??
      process.env.DB_GATEWAY_SERVICE_TOKEN ??
      '';

    this.tenantId =
      options?.tenantId ??
      process.env.DB_GATEWAY_TENANT_ID ??
      '';

    this.timeoutMs =
      options?.timeoutMs ??
      Number(process.env.DB_GATEWAY_TIMEOUT_MS || 2000);

    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  private assertConfigured(): void {
    if (!this.baseUrl) {
      throw new IdentityPersistenceError('DB_GATEWAY_URL is not configured');
    }

    if (!this.serviceToken) {
      throw new IdentityPersistenceError('DB_GATEWAY_SERVICE_TOKEN is not configured');
    }

    if (this.tenantId !== 'panorama') {
      throw new IdentityPersistenceError(
        `DB_GATEWAY_TENANT_ID must be panorama; received ${this.tenantId || '<empty>'}`
      );
    }

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new IdentityPersistenceError('DB_GATEWAY_TIMEOUT_MS is invalid');
    }
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: PlainObject,
    idempotencyKey?: string
  ): Promise<unknown> {
    this.assertConfigured();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.serviceToken}`,
        'x-tenant-id': this.tenantId,
        'Content-Type': 'application/json',
      };

      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }

      const response = await this.fetchImpl(
        `${this.baseUrl}${path}`,
        {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        }
      );

      const text = await response.text();

      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }

      if (!response.ok) {
        throw new IdentityPersistenceError(
          `Database Gateway ${method} ${path} failed with HTTP ${response.status}`
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof IdentityPersistenceError) {
        throw error;
      }

      if ((error as Error)?.name === 'AbortError') {
        throw new IdentityPersistenceError(
          `Database Gateway request timed out after ${this.timeoutMs}ms`
        );
      }

      throw new IdentityPersistenceError(
        `Database Gateway request failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async list(
    entity: string,
    where: PlainObject
  ): Promise<PlainObject[]> {
    const query = encodeURIComponent(JSON.stringify(where));

    const payload = await this.request(
      'GET',
      `/v1/${entity}?where=${query}`
    );

    const envelope = asObject(payload);
    const data = envelope?.data;

    if (!Array.isArray(data)) {
      throw new IdentityPersistenceError(
        `Database Gateway returned an invalid list response for ${entity}`
      );
    }

    return data
      .map(asObject)
      .filter((item): item is PlainObject => item !== null);
  }

  private async create(
    entity: string,
    body: PlainObject,
    idempotencyKey: string
  ): Promise<PlainObject> {
    const payload = await this.request(
      'POST',
      `/v1/${entity}`,
      body,
      idempotencyKey
    );

    const object = asObject(payload);

    if (!object) {
      throw new IdentityPersistenceError(
        `Database Gateway returned an invalid create response for ${entity}`
      );
    }

    return object;
  }

  private async update(
    entity: string,
    id: string,
    body: PlainObject,
    idempotencyKey: string
  ): Promise<void> {
    await this.request(
      'PATCH',
      `/v1/${entity}/${encodeURIComponent(id)}`,
      body,
      idempotencyKey
    );
  }

  private validateTenant(
    entity: string,
    record: PlainObject
  ): void {
    const tenantId = asString(record.tenantId);

    if (tenantId !== this.tenantId) {
      throw new IdentityPersistenceError(
        `${entity} tenant conflict for authenticated identity`
      );
    }
  }

  private async ensureUserProfile(address: string): Promise<void> {
    const records = await this.list('user-profiles', {
      walletAddress: address,
      tenantId: this.tenantId,
    });

    if (records.length > 1) {
      throw new IdentityPersistenceError(
        'Multiple UserProfiles exist for authenticated wallet'
      );
    }

    if (records.length === 1) {
      const profile = records[0];
      this.validateTenant('UserProfile', profile);

      if (asString(profile.walletAddress).toLowerCase() !== address) {
        throw new IdentityPersistenceError(
          'UserProfile walletAddress conflict'
        );
      }

      return;
    }

    await this.create(
      'user-profiles',
      {
        walletAddress: address,
        tenantId: this.tenantId,
      },
      `auth:user-profile:create:${stableKeyPart(address)}`
    );
  }

  private async ensureUser(address: string): Promise<void> {
    const records = await this.list('users', {
      userId: address,
      tenantId: this.tenantId,
    });

    if (records.length > 1) {
      throw new IdentityPersistenceError(
        'Multiple Users exist for authenticated identity'
      );
    }

    if (records.length === 1) {
      const user = records[0];
      this.validateTenant('User', user);

      if (asString(user.userId).toLowerCase() !== address) {
        throw new IdentityPersistenceError('User userId conflict');
      }

      const walletAddress = asString(user.walletAddress);

      if (
        walletAddress &&
        walletAddress.toLowerCase() !== address
      ) {
        throw new IdentityPersistenceError(
          'User walletAddress conflict'
        );
      }

      if (!walletAddress) {
        await this.update(
          'users',
          address,
          {
            walletAddress: address,
          },
          `auth:user:wallet-address:${stableKeyPart(address)}`
        );
      }

      return;
    }

    await this.create(
      'users',
      {
        userId: address,
        walletAddress: address,
        displayName: 'EVM User',
        tenantId: this.tenantId,
      },
      `auth:user:create:${stableKeyPart(address)}`
    );
  }

  private async ensureWallet(address: string): Promise<void> {
    const records = await this.list('wallets', {
      userId: address,
      address,
      tenantId: this.tenantId,
    });

    if (records.length > 0) {
      for (const wallet of records) {
        this.validateTenant('Wallet', wallet);

        if (asString(wallet.userId).toLowerCase() !== address) {
          throw new IdentityPersistenceError(
            'Wallet userId conflict'
          );
        }

        if (asString(wallet.address).toLowerCase() !== address) {
          throw new IdentityPersistenceError(
            'Wallet address conflict'
          );
        }
      }

      return;
    }

    await this.create(
      'wallets',
      {
        userId: address,
        chain: 'EVM',
        address,
        walletType: 'evm',
        isPrimary: true,
        isActive: true,
        metadata: {
          source: 'thirdweb-auth',
          chainResolution: 'generic-evm',
        },
        tenantId: this.tenantId,
      },
      `auth:wallet:create:${stableKeyPart(address)}`
    );
  }

  async ensureAuthenticatedEvmIdentity(
    verifiedAddress: string
  ): Promise<{
    userId: string;
    walletAddress: string;
    tenantId: string;
  }> {
    this.assertConfigured();

    const address = normalizeAddress(verifiedAddress);

    await this.ensureUserProfile(address);
    await this.ensureUser(address);
    await this.ensureWallet(address);

    return {
      userId: address,
      walletAddress: address,
      tenantId: this.tenantId,
    };
  }
}

export const identityPersistenceService =
  new IdentityPersistenceService();
