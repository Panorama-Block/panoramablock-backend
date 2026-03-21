import axios, { AxiosInstance } from 'axios';

export type PlainObject = Record<string, unknown>;

export class DatabaseGatewayClient {
  private readonly enabled: boolean;
  private readonly tenantId: string;
  private readonly client: AxiosInstance | null;

  private readonly memory = {
    wallets: new Map<string, PlainObject>(),
    policies: new Map<string, PlainObject>(),
    intents: new Map<string, PlainObject>(),
    events: new Map<string, PlainObject>(),
    webhooks: new Map<string, PlainObject>(),
    ownershipChallenges: new Map<string, PlainObject>(),
    intentIdempotency: new Map<string, string>(),
  };

  constructor() {
    const baseURL = (process.env.DB_GATEWAY_URL || '').replace(/\/+$/, '');
    const serviceToken = process.env.DB_GATEWAY_SERVICE_TOKEN || '';
    this.tenantId = process.env.DB_GATEWAY_TENANT_ID || 'panorama-default';
    const timeoutMs = Number(process.env.DB_GATEWAY_TIMEOUT_MS || 2000);

    this.enabled =
      process.env.DB_GATEWAY_SYNC_ENABLED === 'true' &&
      baseURL.length > 0 &&
      serviceToken.length > 0;

    this.client = this.enabled
      ? axios.create({
          baseURL,
          timeout: timeoutMs,
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            'x-tenant-id': this.tenantId,
            'Content-Type': 'application/json',
          },
        })
      : null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getTenantId(): string {
    return this.tenantId;
  }

  private async create(entity: string, payload: PlainObject, idempotencyKey: string): Promise<PlainObject> {
    if (!this.client) {
      return payload;
    }
    const response = await this.client.post(`/v1/${entity}`, payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return response.data as PlainObject;
  }

  private async update(entity: string, id: string, payload: PlainObject, idempotencyKey: string): Promise<PlainObject> {
    if (!this.client) {
      return payload;
    }
    const response = await this.client.patch(`/v1/${entity}/${encodeURIComponent(id)}`, payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return response.data as PlainObject;
  }

  private async get(entity: string, id: string): Promise<PlainObject | null> {
    if (!this.client) {
      return null;
    }
    try {
      const response = await this.client.get(`/v1/${entity}/${encodeURIComponent(id)}`);
      return response.data as PlainObject;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async list(entity: string, where: PlainObject): Promise<PlainObject[]> {
    if (!this.client) {
      return [];
    }
    const response = await this.client.get(`/v1/${entity}`, {
      params: {
        where: JSON.stringify(where),
      },
    });
    return Array.isArray(response.data?.data) ? (response.data.data as PlainObject[]) : [];
  }

  async upsertUser(userId: string, walletAddress?: string): Promise<void> {
    const nowIso = new Date().toISOString();

    if (!this.client) {
      this.memory.events.set(`user:${userId}`, { userId, walletAddress, updatedAt: nowIso });
      return;
    }

    try {
      await this.update(
        'users',
        userId,
        {
          walletAddress: walletAddress?.toLowerCase(),
          lastSeenAt: nowIso,
        },
        `panorama:user:update:${userId}`
      );
    } catch (error: any) {
      if (error?.response?.status !== 404) {
        throw error;
      }
      await this.create(
        'users',
        {
          userId,
          walletAddress: walletAddress?.toLowerCase(),
          displayName: 'Panorama User',
          tenantId: this.tenantId,
        },
        `panorama:user:create:${userId}`
      );
    }
  }

  async createWallet(payload: {
    walletId: string;
    userId: string;
    chain: string;
    address: string;
    walletType: 'ton' | 'evm' | 'smart_wallet' | 'panorama_wallet';
    metadata?: PlainObject;
  }): Promise<PlainObject> {
    await this.upsertUser(payload.userId, payload.address);

    const record = {
      id: payload.walletId,
      userId: payload.userId,
      chain: payload.chain,
      address: payload.address.toLowerCase(),
      walletType: payload.walletType,
      metadata: payload.metadata,
      tenantId: this.tenantId,
    };

    if (!this.client) {
      this.memory.wallets.set(payload.walletId, record);
      return record;
    }

    return await this.create('wallets', record, `panorama:wallet:create:${payload.walletId}`);
  }

  async getWallet(walletId: string): Promise<PlainObject | null> {
    if (!this.client) {
      return this.memory.wallets.get(walletId) || null;
    }
    return await this.get('wallets', walletId);
  }

  async findWalletByUserAndAddress(
    userId: string,
    address: string,
    chain?: string
  ): Promise<PlainObject | null> {
    const normalizedAddress = address.toLowerCase();

    if (!this.client) {
      for (const wallet of this.memory.wallets.values()) {
        if (
          String(wallet.userId) === userId &&
          String(wallet.address).toLowerCase() === normalizedAddress &&
          (!chain || String(wallet.chain).toLowerCase() === chain.toLowerCase())
        ) {
          return wallet;
        }
      }
      return null;
    }

    const results = await this.list('wallets', {
      userId,
      address: normalizedAddress,
      ...(chain ? { chain } : {}),
      tenantId: this.tenantId,
    });

    return results[0] || null;
  }

  async updateWallet(walletId: string, payload: PlainObject): Promise<PlainObject> {
    if (!this.client) {
      const current = this.memory.wallets.get(walletId) || {};
      const merged = {
        ...current,
        ...payload,
        updatedAt: new Date().toISOString(),
      };
      this.memory.wallets.set(walletId, merged);
      return merged;
    }

    return await this.update('wallets', walletId, payload, `panorama:wallet:update:${walletId}`);
  }

  async createPolicy(payload: {
    policyId: string;
    userId: string;
    walletId: string;
    policy: PlainObject;
  }): Promise<PlainObject> {
    const record = {
      memoryId: payload.policyId,
      userId: payload.userId,
      conversationId: payload.walletId,
      scope: 'wallet_policy',
      memoryType: 'policy_envelope',
      label: payload.policyId,
      payload: payload.policy,
      tenantId: this.tenantId,
    };

    if (!this.client) {
      this.memory.policies.set(payload.policyId, record);
      return record;
    }

    return await this.create('conversation-memories', record, `panorama:policy:create:${payload.policyId}`);
  }

  async updatePolicy(policyId: string, policy: PlainObject): Promise<PlainObject> {
    if (!this.client) {
      const current = this.memory.policies.get(policyId) || {};
      const merged = {
        ...current,
        payload: policy,
        updatedAt: new Date().toISOString(),
      };
      this.memory.policies.set(policyId, merged);
      return merged;
    }

    return await this.update(
      'conversation-memories',
      policyId,
      {
        payload: policy,
        updatedAt: new Date().toISOString(),
      },
      `panorama:policy:update:${policyId}`
    );
  }

  async getPolicy(policyId: string): Promise<PlainObject | null> {
    if (!this.client) {
      return this.memory.policies.get(policyId) || null;
    }
    return await this.get('conversation-memories', policyId);
  }

  async createIntentTransaction(payload: PlainObject): Promise<PlainObject> {
    const id = String(payload.id);
    const metadata = (payload.metadata || {}) as PlainObject;
    const userId = String(payload.userId || '');
    const idempotencyKey = typeof metadata.idempotencyKey === 'string' ? metadata.idempotencyKey : '';
    if (!this.client) {
      this.memory.intents.set(id, payload);
      if (userId && idempotencyKey) {
        this.memory.intentIdempotency.set(`${userId}:${idempotencyKey}`, id);
      }
      return payload;
    }
    return await this.create('transactions', payload, `panorama:intent:create:${id}`);
  }

  async updateIntentTransaction(id: string, payload: PlainObject): Promise<PlainObject> {
    if (!this.client) {
      const current = this.memory.intents.get(id) || {};
      const merged = {
        ...current,
        ...payload,
        updatedAt: new Date().toISOString(),
      };
      this.memory.intents.set(id, merged);
      return merged;
    }

    return await this.update('transactions', id, payload, `panorama:intent:update:${id}`);
  }

  async getIntentTransaction(id: string): Promise<PlainObject | null> {
    if (!this.client) {
      return this.memory.intents.get(id) || null;
    }
    return await this.get('transactions', id);
  }

  async getIntentByIdempotencyKey(userId: string, idempotencyKey: string): Promise<PlainObject | null> {
    if (!idempotencyKey) return null;

    if (!this.client) {
      const intentId = this.memory.intentIdempotency.get(`${userId}:${idempotencyKey}`);
      return intentId ? this.memory.intents.get(intentId) || null : null;
    }

    const list = await this.list('transactions', {
      userId,
      tenantId: this.tenantId,
      metadata: {
        idempotencyKey,
      },
    });

    return list[0] || null;
  }

  async createLifecycleEvent(payload: {
    eventId: string;
    userId: string;
    intentId?: string;
    event: string;
    data?: PlainObject;
  }): Promise<void> {
    const record = {
      messageId: payload.eventId,
      userId: payload.userId,
      conversationId: payload.intentId || payload.userId,
      role: 'system',
      content: payload.event,
      metadata: {
        ...payload.data,
        event: payload.event,
      },
      tenantId: this.tenantId,
    };

    if (!this.client) {
      this.memory.events.set(payload.eventId, record);
      return;
    }

    await this.create('messages', record, `panorama:event:create:${payload.eventId}`);
  }

  async createWebhookSubscription(payload: {
    webhookId: string;
    userId: string;
    url: string;
    events: string[];
    secret?: string;
  }): Promise<PlainObject> {
    const record = {
      memoryId: payload.webhookId,
      userId: payload.userId,
      conversationId: payload.userId,
      scope: 'webhook',
      memoryType: 'event_subscription',
      label: payload.webhookId,
      payload: {
        url: payload.url,
        events: payload.events,
        secret: payload.secret,
        active: true,
      },
      tenantId: this.tenantId,
    };

    if (!this.client) {
      this.memory.webhooks.set(payload.webhookId, record);
      return record;
    }

    return await this.create('conversation-memories', record, `panorama:webhook:create:${payload.webhookId}`);
  }

  async listWebhookSubscriptions(userId: string): Promise<PlainObject[]> {
    if (!this.client) {
      return Array.from(this.memory.webhooks.values()).filter((item) => String(item.userId) === userId);
    }

    return await this.list('conversation-memories', {
      userId,
      scope: 'webhook',
      memoryType: 'event_subscription',
    });
  }

  async createOwnershipChallenge(payload: {
    challengeId: string;
    walletId: string;
    userId: string;
    challenge: PlainObject;
  }): Promise<PlainObject> {
    const record = {
      memoryId: payload.challengeId,
      userId: payload.userId,
      conversationId: payload.walletId,
      scope: 'ownership_challenge',
      memoryType: 'wallet_ownership_challenge',
      label: payload.challengeId,
      payload: payload.challenge,
      tenantId: this.tenantId,
    };

    if (!this.client) {
      this.memory.ownershipChallenges.set(payload.challengeId, record);
      return record;
    }

    return await this.create('conversation-memories', record, `panorama:ownership:create:${payload.challengeId}`);
  }

  async getOwnershipChallenge(challengeId: string): Promise<PlainObject | null> {
    if (!this.client) {
      return this.memory.ownershipChallenges.get(challengeId) || null;
    }

    return await this.get('conversation-memories', challengeId);
  }

  async updateOwnershipChallenge(challengeId: string, challenge: PlainObject): Promise<PlainObject> {
    if (!this.client) {
      const current = this.memory.ownershipChallenges.get(challengeId) || {};
      const merged = {
        ...current,
        payload: challenge,
        updatedAt: new Date().toISOString(),
      };
      this.memory.ownershipChallenges.set(challengeId, merged);
      return merged;
    }

    return await this.update(
      'conversation-memories',
      challengeId,
      {
        payload: challenge,
        updatedAt: new Date().toISOString(),
      },
      `panorama:ownership:update:${challengeId}`
    );
  }
}
