/**
 * DI container — wires all providers, policy, and services together.
 * Called once at boot from index.ts.
 */

import { ProviderRegistry, ProviderHealthTracker } from "@panorama/capability";
import type { IAgentProvider } from "../../domain/ports/agent.provider.port";
import { GroqAgentAdapter } from "../adapters/groq.agent.adapter";
import { OpenAIAgentAdapter } from "../adapters/openai.agent.adapter";
import { AnthropicAgentAdapter } from "../adapters/anthropic.agent.adapter";
import { ZicoHFAgentAdapter } from "../adapters/zico-hf.agent.adapter";
import {
  TaskTypePriorityPolicy,
  DEFAULT_TASK_TYPE_CONFIG,
} from "../../application/policies/task-type.priority.policy";
import { AgentCapabilityService } from "../../application/services/agent.capability.service";
import {
  RedisConversationRepository,
  InMemoryConversationRepository,
} from "./conversation.repository";

export interface EnvConfig {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GROQ_API_KEY?: string;
  AGENTS_API_BASE?: string;
  REDIS_URL?: string;
  AGENTS_REQUEST_TIMEOUT_MS?: string;
}

export function buildContainer(env: EnvConfig) {
  // -------------------------------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------------------------------

  const registry = new ProviderRegistry<IAgentProvider>();

  // Register in preference order — policy will re-rank per request
  if (env.GROQ_API_KEY) {
    registry.register(new GroqAgentAdapter({ apiKey: env.GROQ_API_KEY }));
  }

  if (env.OPENAI_API_KEY) {
    registry.register(new OpenAIAgentAdapter({ apiKey: env.OPENAI_API_KEY }));
  }

  if (env.ANTHROPIC_API_KEY) {
    registry.register(new AnthropicAgentAdapter({ apiKey: env.ANTHROPIC_API_KEY }));
  }

  if (env.AGENTS_API_BASE) {
    registry.register(new ZicoHFAgentAdapter({
      baseUrl: env.AGENTS_API_BASE,
      timeoutMs: env.AGENTS_REQUEST_TIMEOUT_MS ? parseInt(env.AGENTS_REQUEST_TIMEOUT_MS, 10) : 60_000,
    }));
  }

  if (registry.size() === 0) {
    console.warn("[agents-service] WARNING: No LLM providers configured. Set GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or AGENTS_API_BASE.");
  }

  // -------------------------------------------------------------------------------------------------
  // Health tracker
  // -------------------------------------------------------------------------------------------------

  const healthTracker = new ProviderHealthTracker({ intervalMs: 60_000, unhealthyAfter: 2 });
  for (const provider of registry.listAll({ includeDisabled: true })) {
    healthTracker.track(provider);
  }
  registry.attachHealthOracle(healthTracker);

  // -------------------------------------------------------------------------------------------------
  // Policy
  // -------------------------------------------------------------------------------------------------

  const policy = new TaskTypePriorityPolicy(DEFAULT_TASK_TYPE_CONFIG);

  // -------------------------------------------------------------------------------------------------
  // Conversation repository
  // -------------------------------------------------------------------------------------------------

  let conversations: RedisConversationRepository | InMemoryConversationRepository;
  if (env.REDIS_URL) {
    try {
      const { createClient } = require("redis");
      const redisClient = createClient({ url: env.REDIS_URL });
      redisClient.on("error", (e: Error) => console.error("[agents-service] Redis error:", e));
      redisClient.connect().catch((e: Error) => console.error("[agents-service] Redis connect failed:", e));
      conversations = new RedisConversationRepository(redisClient);
    } catch {
      console.warn("[agents-service] Redis unavailable, falling back to in-memory conversation store.");
      conversations = new InMemoryConversationRepository();
    }
  } else {
    conversations = new InMemoryConversationRepository();
  }

  // -------------------------------------------------------------------------------------------------
  // Service
  // -------------------------------------------------------------------------------------------------

  const service = new AgentCapabilityService(registry, policy, healthTracker, conversations);

  return { registry, healthTracker, policy, service };
}
