/**
 * AnthropicAgentAdapter — routes to Anthropic API (Claude models).
 *
 * Optimised for reasoning and coding task types.
 * Supports: chat, stream, vision (claude-3.5-sonnet+).
 * Does NOT support: audio transcription (Anthropic has no ASR endpoint).
 */

import {
  CapabilityError,
  buildSuccess,
  buildError,
} from "@panorama/capability";
import type {
  CapabilityResponse,
  ProviderMetadata,
  ProviderHealth,
} from "@panorama/capability";
import type { IAgentProvider, AgentProviderCapabilities } from "../../domain/ports/agent.provider.port";
import type {
  ChatRequestPayload,
  ChatResponseData,
  ChatChunk,
  ChatWithFilesRequestPayload,
  TranscriptionRequestPayload,
  TranscriptionResult,
  AttachedFile,
} from "../../domain/types/agent.types";

const SUPPORTED_CHAINS = [1, 137, 43114, 8453, 42161, 10, 56];
const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicAdapterConfig {
  apiKey: string;
  chatModel?: string;
  reasoningModel?: string;
}

export class AnthropicAgentAdapter implements IAgentProvider {
  readonly name = "anthropic";

  readonly metadata: ProviderMetadata = {
    name: "anthropic",
    capability: "agent",
    supportedChains: SUPPORTED_CHAINS,
    features: ["streaming", "vision", "extended-thinking", "tool-use"],
    version: "1.0.0",
    enabled: true,
  };

  readonly capabilities: AgentProviderCapabilities = {
    chat: true,
    stream: true,
    vision: true,
    transcription: false,
    taskTypes: ["reasoning", "coding", "vision", "general"],
    models: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
  };

  private readonly baseUrl = "https://api.anthropic.com/v1";
  private readonly chatModel: string;
  private readonly reasoningModel: string;

  constructor(private readonly config: AnthropicAdapterConfig) {
    this.chatModel = config.chatModel ?? "claude-sonnet-4-6";
    this.reasoningModel = config.reasoningModel ?? "claude-opus-4-7";
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Anthropic has no /models endpoint — use a minimal test message
      const res = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({ model: this.chatModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        signal: AbortSignal.timeout(5000),
      });
      return {
        healthy: res.ok,
        latencyMs: Date.now() - start,
        reason: res.ok ? undefined : `HTTP ${res.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { healthy: false, latencyMs: Date.now() - start, reason: e instanceof Error ? e.message : "unknown", checkedAt: new Date().toISOString() };
    }
  }

  async chat(request: ChatRequestPayload): Promise<CapabilityResponse<ChatResponseData>> {
    const start = Date.now();
    const traceId = crypto.randomUUID();
    const model = request.response_mode === "reasoning" ? this.reasoningModel : this.chatModel;

    try {
      const body: Record<string, unknown> = {
        model,
        max_tokens: 8096,
        messages: [{ role: "user", content: request.message.content }],
      };

      if (request.response_mode === "reasoning") {
        (body as any).thinking = { type: "enabled", budget_tokens: 5000 };
      }

      const res = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": this.config.apiKey, "anthropic-version": ANTHROPIC_API_VERSION },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `Anthropic chat failed: ${res.status} ${text}` });
      }

      const data = await res.json() as any;
      const textBlock = data.content?.find((b: any) => b.type === "text");
      const message: string = textBlock?.text ?? "";

      return buildSuccess({
        data: { message, requires_action: false, agent_name: "claude", agent_type: "llm", conversation_id: request.conversation_id, metadata: { model, usage: data.usage } },
        provider: { name: this.name, metadata: { model } },
        traceId,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      if (CapabilityError.is(e)) return buildError({ error: e, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      return buildError({ error: CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e }), traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
    }
  }

  async *stream(request: ChatRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    yield* this._streamMessages([{ role: "user", content: request.message.content }], request);
  }

  async *streamWithFiles(request: ChatWithFilesRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const content = buildAnthropicVisionContent(request.message.content, request.files);
    yield* this._streamMessages([{ role: "user", content }], request);
  }

  private async *_streamMessages(
    messages: Array<{ role: string; content: unknown }>,
    request: ChatRequestPayload
  ): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const traceId = crypto.randomUUID();
    const start = Date.now();
    const model = request.response_mode === "reasoning" ? this.reasoningModel : this.chatModel;

    yield buildSuccess({
      data: { type: "metadata", conversation_id: request.conversation_id, agent_name: "claude", agent_type: "llm" },
      provider: { name: this.name, metadata: { model } },
      traceId,
      latencyMs: 0,
    });

    try {
      const body: Record<string, unknown> = { model, max_tokens: 8096, messages, stream: true };
      if (request.response_mode === "reasoning") {
        (body as any).thinking = { type: "enabled", budget_tokens: 5000 };
      }

      const res = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": this.config.apiKey, "anthropic-version": ANTHROPIC_API_VERSION },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `Anthropic stream failed: ${res.status} ${text}` });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          try {
            const event = JSON.parse(raw) as any;
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              yield buildSuccess({ data: { type: "delta", delta: event.delta.text }, provider: { name: this.name }, traceId, latencyMs: Date.now() - start });
            }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      const capError = CapabilityError.is(e) ? e : CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e });
      yield buildError({ error: capError, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      return;
    }

    yield buildSuccess({ data: { type: "done" }, provider: { name: this.name }, traceId, latencyMs: Date.now() - start });
  }

  async transcribe(_request: TranscriptionRequestPayload): Promise<CapabilityResponse<TranscriptionResult>> {
    const traceId = crypto.randomUUID();
    return buildError({
      error: CapabilityError.unavailable("Anthropic does not support audio transcription. Use groq or openai provider."),
      traceId,
      latencyMs: 0,
      provider: { name: this.name },
    });
  }
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function buildAnthropicVisionContent(
  text: string,
  files: AttachedFile[]
): Array<{ type: string; [k: string]: unknown }> {
  const content: Array<{ type: string; [k: string]: unknown }> = [];

  for (const f of files) {
    if (f.mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: f.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: f.buffer.toString("base64"),
        },
      });
    }
  }

  content.push({ type: "text", text });
  return content;
}
