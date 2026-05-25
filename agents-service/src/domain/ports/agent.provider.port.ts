/**
 * IAgentProvider — port that every LLM adapter must implement.
 *
 * Extends ICapabilityProvider from shared/capability so it participates in the
 * Registry, Policy, HealthTracker, and Discovery machinery without modification.
 *
 * See CONVENTIONS.md §"Port" and ADR 002.
 */

import type { CapabilityResponse } from "@panorama/capability";
import type { ICapabilityProvider } from "@panorama/capability";
import type {
  ChatRequestPayload,
  ChatResponseData,
  ChatChunk,
  ChatWithFilesRequestPayload,
  TranscriptionRequestPayload,
  TranscriptionResult,
  TaskType,
} from "../types/agent.types";

// -------------------------------------------------------------------------------------------------
// Extended provider metadata for LLM adapters
// -------------------------------------------------------------------------------------------------

export interface AgentProviderCapabilities {
  /** True if the provider supports plain text chat. */
  chat: boolean;
  /** True if the provider supports SSE streaming. */
  stream: boolean;
  /** True if the provider supports multi-modal vision input. */
  vision: boolean;
  /** True if the provider can transcribe audio. */
  transcription: boolean;
  /** Task types this provider is optimised for. */
  taskTypes: TaskType[];
  /** LLM model identifier(s) used by this adapter. */
  models: string[];
}

// -------------------------------------------------------------------------------------------------
// Port
// -------------------------------------------------------------------------------------------------

export interface IAgentProvider extends ICapabilityProvider {
  /**
   * Feature flags — queried by the policy and the discovery endpoint.
   * Must be a static property on the adapter class.
   */
  readonly capabilities: AgentProviderCapabilities;

  /**
   * Non-streaming chat. Returns the full response once the LLM finishes.
   */
  chat(
    request: ChatRequestPayload
  ): Promise<CapabilityResponse<ChatResponseData>>;

  /**
   * Streaming chat via SSE.
   *
   * Yields chunks in order:
   *  - First chunk: `type === 'metadata'` with provider/traceId context.
   *  - Subsequent chunks: `type === 'delta'` with incremental text.
   *  - Final chunk: `type === 'done'`.
   *  - On error: `type === 'error'` with a message.
   *
   * The HTTP layer serialises each chunk as `data: <json>\n\n`.
   */
  stream(
    request: ChatRequestPayload
  ): AsyncIterable<CapabilityResponse<ChatChunk>>;

  /**
   * Chat with file attachments (vision / document analysis).
   * Falls back to `chat()` if the provider has `capabilities.vision === false`.
   */
  streamWithFiles(
    request: ChatWithFilesRequestPayload
  ): AsyncIterable<CapabilityResponse<ChatChunk>>;

  /**
   * Audio transcription. Adapters that don't support audio should throw
   * `CapabilityError.unavailable('audio transcription not supported')`.
   */
  transcribe(
    request: TranscriptionRequestPayload
  ): Promise<CapabilityResponse<TranscriptionResult>>;
}
