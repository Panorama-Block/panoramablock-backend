/**
 * TaskTypePriorityPolicy — ranks LLM providers by task type.
 *
 * Analogous to ChainAssetPriorityPolicy but the discriminator is the AI task type
 * instead of the EVM chain id. Config-driven via TaskTypePriorityConfig.
 *
 * Usage:
 *   const policy = new TaskTypePriorityPolicy({
 *     reasoning: ["anthropic", "openai", "groq"],
 *     coding:    ["openai", "anthropic", "groq"],
 *     vision:    ["openai", "anthropic"],
 *     audio:     ["groq", "openai"],
 *     general:   ["groq", "openai", "anthropic", "zico-hf"],
 *   });
 */

import { CapabilityError, ErrorCategory } from "@panorama/capability";
import type { IPriorityPolicy, PolicyContext } from "@panorama/capability";
import type { ICapabilityProvider } from "@panorama/capability";
import type { TaskType } from "../../domain/types/agent.types";

// -------------------------------------------------------------------------------------------------
// Config
// -------------------------------------------------------------------------------------------------

export type TaskTypePriorityConfig = {
  [K in TaskType]?: string[];
} & {
  /** Default ranking when task_type is absent or unrecognised. */
  default?: string[];
};

// -------------------------------------------------------------------------------------------------
// Extended policy context
// -------------------------------------------------------------------------------------------------

export interface AgentPolicyContext extends PolicyContext {
  task_type?: TaskType;
  response_mode?: "fast" | "reasoning";
}

// -------------------------------------------------------------------------------------------------
// Policy
// -------------------------------------------------------------------------------------------------

export class TaskTypePriorityPolicy implements IPriorityPolicy {
  constructor(private readonly config: TaskTypePriorityConfig) {
    if (!config || typeof config !== "object") {
      throw new CapabilityError({
        code: "CAPABILITY_AGENT_POLICY_INVALID_CONFIG",
        category: ErrorCategory.INTERNAL,
        message: "TaskTypePriorityPolicy requires a config object",
      });
    }
  }

  rank<TProvider extends ICapabilityProvider>(
    providers: readonly TProvider[],
    context: PolicyContext
  ): TProvider[] {
    const agentCtx = context as AgentPolicyContext;
    const order = this.resolveOrder(agentCtx);

    if (order.length === 0) {
      return [...providers];
    }

    const orderIndex = new Map<string, number>();
    for (let i = 0; i < order.length; i++) orderIndex.set(order[i]!, i);

    const withIndex = providers.map((p, original) => ({
      p,
      rank: orderIndex.get(p.name) ?? Number.POSITIVE_INFINITY,
      original,
    }));
    withIndex.sort((a, b) =>
      a.rank !== b.rank ? a.rank - b.rank : a.original - b.original
    );
    return withIndex.map((x) => x.p);
  }

  private resolveOrder(context: AgentPolicyContext): string[] {
    // "reasoning" response mode → bump reasoning-tier providers first
    if (context.response_mode === "reasoning") {
      const reasoningOrder = this.config["reasoning"];
      if (reasoningOrder && reasoningOrder.length > 0) return reasoningOrder;
    }

    const taskType = context.task_type;
    if (taskType && this.config[taskType]) {
      return this.config[taskType]!;
    }

    return this.config.default ?? [];
  }
}

// -------------------------------------------------------------------------------------------------
// Default config — aligned with current infra assumptions
// -------------------------------------------------------------------------------------------------

export const DEFAULT_TASK_TYPE_CONFIG: TaskTypePriorityConfig = {
  reasoning: ["anthropic", "openai", "groq"],
  coding: ["openai", "anthropic", "groq"],
  vision: ["openai", "anthropic"],
  audio: ["groq", "openai"],
  general: ["groq", "openai", "anthropic", "zico-hf"],
  default: ["zico-hf", "groq", "openai", "anthropic"],
};
