/**
 * GroqAgentAdapter — routes to Groq's LLM API (ultra-fast inference).
 *
 * Supports: chat, stream, audio transcription (Whisper).
 * Does NOT support: vision (Groq has no vision endpoint as of v1).
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
} from "../../domain/types/agent.types";

const SUPPORTED_CHAINS = [1, 137, 43114, 8453, 42161, 10, 56];

export interface GroqAdapterConfig {
  apiKey: string;
  /** Default model for chat. Defaults to 'llama-3.3-70b-versatile'. */
  chatModel?: string;
  /** Model for audio transcription. Defaults to 'whisper-large-v3'. */
  transcriptionModel?: string;
  /** Model for reasoning mode. Defaults to 'deepseek-r1-distill-llama-70b'. */
  reasoningModel?: string;
}

export class GroqAgentAdapter implements IAgentProvider {
  readonly name = "groq";

  readonly metadata: ProviderMetadata = {
    name: "groq",
    capability: "agent",
    supportedChains: SUPPORTED_CHAINS,
    features: ["streaming", "transcription", "fast-inference"],
    version: "1.0.0",
    enabled: true,
  };

  readonly capabilities: AgentProviderCapabilities = {
    chat: true,
    stream: true,
    vision: false,
    transcription: true,
    taskTypes: ["general", "audio", "coding"],
    models: ["llama-3.3-70b-versatile", "whisper-large-v3", "deepseek-r1-distill-llama-70b"],
  };

  private readonly baseUrl = "https://api.groq.com/openai/v1";
  private readonly chatModel: string;
  private readonly transcriptionModel: string;
  private readonly reasoningModel: string;

  constructor(private readonly config: GroqAdapterConfig) {
    this.chatModel = config.chatModel ?? "llama-3.3-70b-versatile";
    this.transcriptionModel = config.transcriptionModel ?? "whisper-large-v3";
    this.reasoningModel = config.reasoningModel ?? "deepseek-r1-distill-llama-70b";
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return {
        healthy: res.ok,
        latencyMs: Date.now() - start,
        reason: res.ok ? undefined : `HTTP ${res.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: e instanceof Error ? e.message : "unknown error",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async chat(request: ChatRequestPayload): Promise<CapabilityResponse<ChatResponseData>> {
    const start = Date.now();
    const traceId = crypto.randomUUID();
    const model = request.response_mode === "reasoning" ? this.reasoningModel : this.chatModel;

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: request.message.role, content: request.message.content }],
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw CapabilityError.providerFailure({
          capability: "agent",
          provider: this.name,
          message: `Groq chat failed: ${res.status} ${text}`,
        });
      }

      const data = await res.json() as any;
      const message: string = data.choices?.[0]?.message?.content ?? "";

      return buildSuccess({
        data: {
          message,
          requires_action: false,
          agent_name: "groq",
          agent_type: "llm",
          conversation_id: request.conversation_id,
          metadata: { model, usage: data.usage },
        },
        provider: { name: this.name, metadata: { model } },
        traceId,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      if (CapabilityError.is(e)) {
        return buildError({ error: e, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      }
      return buildError({
        error: CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e }),
        traceId,
        latencyMs: Date.now() - start,
        provider: { name: this.name },
      });
    }
  }

  async *stream(request: ChatRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const traceId = crypto.randomUUID();
    const start = Date.now();
    const model = request.response_mode === "reasoning" ? this.reasoningModel : this.chatModel;

    // Metadata chunk first
    yield buildSuccess({
      data: { type: "metadata", conversation_id: request.conversation_id, agent_name: "groq", agent_type: "llm" },
      provider: { name: this.name, metadata: { model } },
      traceId,
      latencyMs: 0,
    });

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: request.message.role, content: request.message.content }],
          stream: true,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw CapabilityError.providerFailure({
          capability: "agent",
          provider: this.name,
          message: `Groq stream failed: ${res.status} ${text}`,
        });
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
          if (raw === "[DONE]") continue;
          try {
            const chunk = JSON.parse(raw) as any;
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              yield buildSuccess({
                data: { type: "delta", delta },
                provider: { name: this.name },
                traceId,
                latencyMs: Date.now() - start,
              });
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (e) {
      const capError = CapabilityError.is(e)
        ? e
        : CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e });
      yield buildError({ error: capError, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      return;
    }

    yield buildSuccess({
      data: { type: "done" },
      provider: { name: this.name },
      traceId,
      latencyMs: Date.now() - start,
    });
  }

  async *streamWithFiles(request: ChatWithFilesRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    // Groq has no vision — fall back to text-only stream ignoring files
    yield* this.stream(request);
  }

  async transcribe(request: TranscriptionRequestPayload): Promise<CapabilityResponse<TranscriptionResult>> {
    const start = Date.now();
    const traceId = crypto.randomUUID();

    try {
      const formData = new FormData();
      formData.append("file", new Blob([request.audio], { type: request.mimeType }), request.filename);
      formData.append("model", this.transcriptionModel);
      formData.append("response_format", "verbose_json");

      const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw CapabilityError.providerFailure({
          capability: "agent",
          provider: this.name,
          message: `Groq transcription failed: ${res.status} ${text}`,
        });
      }

      const data = await res.json() as any;
      return buildSuccess({
        data: {
          text: data.text ?? "",
          language: data.language,
          durationSeconds: data.duration,
        },
        provider: { name: this.name, metadata: { model: this.transcriptionModel } },
        traceId,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      if (CapabilityError.is(e)) {
        return buildError({ error: e, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      }
      return buildError({
        error: CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e }),
        traceId,
        latencyMs: Date.now() - start,
        provider: { name: this.name },
      });
    }
  }
}
