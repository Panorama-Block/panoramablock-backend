/**
 * ConversationRepository — Redis-backed persistence for conversations and messages.
 *
 * Key schema (all values are JSON strings):
 *   conversations:{userId}              → SET of conversation IDs
 *   conversation:{convId}:meta          → Conversation metadata JSON
 *   conversation:{convId}:messages      → LIST of StoredMessage JSON (RPUSH / LRANGE)
 *
 * TTL: conversations expire after 90 days of inactivity.
 */

import type { Conversation, StoredMessage } from "../../domain/types/agent.types";

export interface ConversationRepository {
  listByUser(userId: string): Promise<Conversation[]>;
  create(userId: string): Promise<string>;
  getMessages(userId: string, conversationId: string): Promise<StoredMessage[]>;
  appendMessage(message: StoredMessage): Promise<void>;
  delete(userId: string, conversationId: string): Promise<void>;
}

// -------------------------------------------------------------------------------------------------
// Redis implementation
// -------------------------------------------------------------------------------------------------

export interface RedisConversationRepositoryDeps {
  redis: RedisClient;
}

interface RedisClient {
  sAdd(key: string, member: string): Promise<unknown>;
  sMembers(key: string): Promise<string[]>;
  sRem(key: string, member: string): Promise<unknown>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  rPush(key: string, ...values: string[]): Promise<unknown>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export class RedisConversationRepository implements ConversationRepository {
  constructor(private readonly redis: RedisClient) {}

  async listByUser(userId: string): Promise<Conversation[]> {
    const ids = await this.redis.sMembers(`conversations:${userId}`);
    const conversations: Conversation[] = [];

    for (const id of ids) {
      const raw = await this.redis.get(`conversation:${id}:meta`);
      if (raw) {
        try {
          conversations.push(JSON.parse(raw) as Conversation);
        } catch {
          // corrupted — skip
        }
      }
    }

    return conversations.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  }

  async create(userId: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = { id, user_id: userId, created_at: now, updated_at: now };

    await this.redis.set(`conversation:${id}:meta`, JSON.stringify(conv), { EX: TTL_SECONDS });
    await this.redis.sAdd(`conversations:${userId}`, id);
    await this.redis.expire(`conversations:${userId}`, TTL_SECONDS);

    return id;
  }

  async getMessages(userId: string, conversationId: string): Promise<StoredMessage[]> {
    const raw = await this.redis.lRange(`conversation:${conversationId}:messages`, 0, -1);
    return raw.map((r) => {
      try { return JSON.parse(r) as StoredMessage; } catch { return null; }
    }).filter(Boolean) as StoredMessage[];
  }

  async appendMessage(message: StoredMessage): Promise<void> {
    const msgKey = `conversation:${message.conversation_id}:messages`;
    await this.redis.rPush(msgKey, JSON.stringify(message));
    await this.redis.expire(msgKey, TTL_SECONDS);

    // Update conversation's updated_at
    const metaKey = `conversation:${message.conversation_id}:meta`;
    const raw = await this.redis.get(metaKey);
    if (raw) {
      try {
        const conv = JSON.parse(raw) as Conversation;
        conv.updated_at = message.timestamp;
        await this.redis.set(metaKey, JSON.stringify(conv), { EX: TTL_SECONDS });
      } catch { /* ignore */ }
    }
  }

  async delete(userId: string, conversationId: string): Promise<void> {
    await this.redis.sRem(`conversations:${userId}`, conversationId);
    await this.redis.del(`conversation:${conversationId}:meta`);
    await this.redis.del(`conversation:${conversationId}:messages`);
  }
}

// -------------------------------------------------------------------------------------------------
// In-memory fallback (for dev / when Redis is unavailable)
// -------------------------------------------------------------------------------------------------

export class InMemoryConversationRepository implements ConversationRepository {
  private convsByUser = new Map<string, Map<string, Conversation>>();
  private messages = new Map<string, StoredMessage[]>();

  async listByUser(userId: string): Promise<Conversation[]> {
    return [...(this.convsByUser.get(userId)?.values() ?? [])].sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  }

  async create(userId: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = { id, user_id: userId, created_at: now, updated_at: now };
    if (!this.convsByUser.has(userId)) this.convsByUser.set(userId, new Map());
    this.convsByUser.get(userId)!.set(id, conv);
    return id;
  }

  async getMessages(_userId: string, conversationId: string): Promise<StoredMessage[]> {
    return this.messages.get(conversationId) ?? [];
  }

  async appendMessage(message: StoredMessage): Promise<void> {
    if (!this.messages.has(message.conversation_id)) this.messages.set(message.conversation_id, []);
    this.messages.get(message.conversation_id)!.push(message);

    for (const userConvs of this.convsByUser.values()) {
      if (userConvs.has(message.conversation_id)) {
        const conv = userConvs.get(message.conversation_id)!;
        conv.updated_at = message.timestamp;
      }
    }
  }

  async delete(userId: string, conversationId: string): Promise<void> {
    this.convsByUser.get(userId)?.delete(conversationId);
    this.messages.delete(conversationId);
  }
}
