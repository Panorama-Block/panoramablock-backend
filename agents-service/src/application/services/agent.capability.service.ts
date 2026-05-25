/**
 * AgentCapabilityService — application-layer facade.
 *
 * Orchestrates: registry + policy → select provider → delegate + fallback.
 * Also manages conversation persistence via Redis.
 */

import {
  ProviderRegistry,
  ProviderHealthTracker,
  CapabilityError,
  buildSuccess,
  buildError,
  fallbackInvoke,
} from "@panorama/capability";
import type { CapabilityResponse } from "@panorama/capability";
import type { IAgentProvider } from "../../domain/ports/agent.provider.port";
import type {
  ChatRequestPayload,
  ChatResponseData,
  ChatChunk,
  ChatWithFilesRequestPayload,
  TranscriptionRequestPayload,
  TranscriptionResult,
  Conversation,
  StoredMessage,
  TaskType,
} from "../../domain/types/agent.types";
import type { TaskTypePriorityPolicy } from "../policies/task-type.priority.policy";
import type { AgentPolicyContext } from "../policies/task-type.priority.policy";
import type { ConversationRepository } from "../../infrastructure/di/conversation.repository";

// -------------------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------------------

export class AgentCapabilityService {
  constructor(
    private readonly registry: ProviderRegistry<IAgentProvider>,
    private readonly policy: TaskTypePriorityPolicy,
    private readonly healthTracker: ProviderHealthTracker,
    private readonly conversations: ConversationRepository
  ) {}

  // -------------------------------------------------------------------------------------------------
  // Chat (non-streaming)
  // -------------------------------------------------------------------------------------------------

  async chat(request: ChatRequestPayload): Promise<CapabilityResponse<ChatResponseData>> {
    const start = Date.now();
    const traceId = crypto.randomUUID();
    const taskType = request.task_type ?? "general";

    const providers = this.registry.listAll({ capability: "agent", healthy: undefined });
    if (providers.length === 0) {
      return buildError({
        error: CapabilityError.unavailable("No agent providers registered."),
        traceId,
        latencyMs: Date.now() - start,
      });
    }

    const ctx: AgentPolicyContext = { chainId: request.chain_id ?? 0, task_type: taskType, response_mode: request.response_mode };
    const ranked = this.policy.rank(providers, ctx);

    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: async (p) => p.capabilities.chat,
      invoke: (p) => p.chat(request),
      capability: "agent",
    });

    if (!outcome.ok) return buildError({ error: outcome.error, traceId, latencyMs: Date.now() - start, attemptedProviders: outcome.attempts.map(a => ({ name: a.provider, reason: a.reason })) });

    const response = outcome.result;

    if (response.status === "success") {
      await this.conversations.appendMessage({
        id: crypto.randomUUID(),
        conversation_id: request.conversation_id ?? traceId,
        role: "assistant",
        content: response.data.message,
        agent_name: response.data.agent_name ?? null,
        agent_type: response.data.agent_type ?? null,
        metadata: response.data.metadata ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    return response;
  }

  // -------------------------------------------------------------------------------------------------
  // Stream (SSE)
  // -------------------------------------------------------------------------------------------------

  async *stream(request: ChatRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const taskType = request.task_type ?? "general";
    const providers = this.registry.listAll({ capability: "agent", healthy: undefined });

    if (providers.length === 0) {
      const traceId = crypto.randomUUID();
      yield buildError({ error: CapabilityError.unavailable("No agent providers registered."), traceId, latencyMs: 0 });
      return;
    }

    const ctx: AgentPolicyContext = { chainId: request.chain_id ?? 0, task_type: taskType, response_mode: request.response_mode };
    const ranked = this.policy.rank(providers, ctx);

    for (const provider of ranked) {
      if (!provider.capabilities.stream) continue;
      try {
        let fullText = "";
        for await (const chunk of provider.stream(request)) {
          yield chunk;
          if (chunk.status === "success" && chunk.data.type === "delta") {
            fullText += chunk.data.delta ?? "";
          }
          if (chunk.status === "success" && chunk.data.type === "done") {
            await this.conversations.appendMessage({
              id: crypto.randomUUID(),
              conversation_id: request.conversation_id ?? crypto.randomUUID(),
              role: "assistant",
              content: fullText,
              agent_name: null,
              agent_type: null,
              metadata: null,
              timestamp: new Date().toISOString(),
            });
          }
        }
        return;
      } catch (e) {
        // Try next provider
        continue;
      }
    }

    const traceId = crypto.randomUUID();
    yield buildError({
      error: CapabilityError.allProvidersFailed({ capability: "agent", attempts: ranked.map((p) => ({ provider: p.name, error: "stream failed" })) }),
      traceId,
      latencyMs: 0,
    });
  }

  // -------------------------------------------------------------------------------------------------
  // Stream with files
  // -------------------------------------------------------------------------------------------------

  async *streamWithFiles(request: ChatWithFilesRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const providers = this.registry.listAll({ capability: "agent", healthy: undefined });
    const ctx: AgentPolicyContext = { chainId: request.chain_id ?? 0, task_type: "vision" };
    const ranked = this.policy.rank(providers, ctx);

    const visionProviders = ranked.filter((p) => p.capabilities.vision);
    const selected = visionProviders.length > 0 ? visionProviders : ranked;

    for (const provider of selected) {
      try {
        yield* provider.streamWithFiles(request);
        return;
      } catch {
        continue;
      }
    }

    yield buildError({
      error: CapabilityError.unavailable("No vision-capable provider available."),
      traceId: crypto.randomUUID(),
      latencyMs: 0,
    });
  }

  // -------------------------------------------------------------------------------------------------
  // Transcription
  // -------------------------------------------------------------------------------------------------

  async transcribe(request: TranscriptionRequestPayload): Promise<CapabilityResponse<TranscriptionResult>> {
    const start = Date.now();
    const traceId = crypto.randomUUID();
    const providers = this.registry.listAll({ capability: "agent", healthy: undefined });
    const audioProviders = providers.filter((p) => p.capabilities.transcription);

    if (audioProviders.length === 0) {
      return buildError({ error: CapabilityError.unavailable("No audio transcription provider available."), traceId, latencyMs: Date.now() - start });
    }

    const ctx: AgentPolicyContext = { chainId: 0, task_type: "audio" };
    const ranked = this.policy.rank(audioProviders, ctx);

    const outcome = await fallbackInvoke({
      ranked,
      supportsRoute: async (p) => p.capabilities.transcription,
      invoke: (p) => p.transcribe(request),
      capability: "agent",
    });

    if (!outcome.ok) return buildError({ error: outcome.error, traceId, latencyMs: Date.now() - start });
    return outcome.result;
  }

  // -------------------------------------------------------------------------------------------------
  // Conversation management
  // -------------------------------------------------------------------------------------------------

  async listConversations(userId: string): Promise<Conversation[]> {
    return this.conversations.listByUser(userId);
  }

  async createConversation(userId: string): Promise<string> {
    return this.conversations.create(userId);
  }

  async getMessages(userId: string, conversationId: string): Promise<StoredMessage[]> {
    return this.conversations.getMessages(userId, conversationId);
  }

  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    return this.conversations.delete(userId, conversationId);
  }

  async generateTitle(userId: string, conversationId: string, firstMessage: string): Promise<string> {
    // Use the fastest provider for title generation
    const providers = this.registry.listAll({ capability: "agent", healthy: undefined });
    const ctx: AgentPolicyContext = { chainId: 0, task_type: "general", response_mode: "fast" };
    const ranked = this.policy.rank(providers, ctx).filter((p) => p.capabilities.chat);

    if (ranked.length === 0) return "New Chat";

    const provider = ranked[0]!;
    const result = await provider.chat({
      message: {
        role: "user",
        content: `Generate a short title (max 6 words) for a conversation that starts with: "${firstMessage.slice(0, 200)}". Reply with just the title, no punctuation.`,
      },
      user_id: userId,
      conversation_id: conversationId,
      response_mode: "fast",
    });

    if (result.status === "success") return result.data.message.trim() || "New Chat";
    return "New Chat";
  }
}
