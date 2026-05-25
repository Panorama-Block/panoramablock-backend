/**
 * OpenAIAgentAdapter — routes to OpenAI API (GPT-4o, Whisper, vision).
 *
 * Supports: chat, stream, vision (multimodal), audio transcription.
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

export interface OpenAIAdapterConfig {
  apiKey: string;
  chatModel?: string;
  reasoningModel?: string;
  transcriptionModel?: string;
}

export class OpenAIAgentAdapter implements IAgentProvider {
  readonly name = "openai";

  readonly metadata: ProviderMetadata = {
    name: "openai",
    capability: "agent",
    supportedChains: SUPPORTED_CHAINS,
    features: ["streaming", "vision", "transcription", "function-calling"],
    version: "1.0.0",
    enabled: true,
  };

  readonly capabilities: AgentProviderCapabilities = {
    chat: true,
    stream: true,
    vision: true,
    transcription: true,
    taskTypes: ["general", "coding", "vision", "reasoning"],
    models: ["gpt-4o", "gpt-4o-mini", "o1", "whisper-1"],
  };

  private readonly baseUrl = "https://api.openai.com/v1";
  private readonly chatModel: string;
  private readonly reasoningModel: string;
  private readonly transcriptionModel: string;

  constructor(private readonly config: OpenAIAdapterConfig) {
    this.chatModel = config.chatModel ?? "gpt-4o";
    this.reasoningModel = config.reasoningModel ?? "o1";
    this.transcriptionModel = config.transcriptionModel ?? "whisper-1";
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
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `OpenAI chat failed: ${res.status} ${text}` });
      }

      const data = await res.json() as any;
      const message: string = data.choices?.[0]?.message?.content ?? "";

      return buildSuccess({
        data: { message, requires_action: false, agent_name: "openai", agent_type: "llm", conversation_id: request.conversation_id, metadata: { model, usage: data.usage } },
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
    yield* this._streamMessages([{ role: request.message.role, content: request.message.content }], request);
  }

  async *streamWithFiles(request: ChatWithFilesRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const imageContent = await buildVisionContent(request.message.content, request.files);
    yield* this._streamMessages([{ role: request.message.role, content: imageContent }], request);
  }

  private async *_streamMessages(
    messages: Array<{ role: string; content: unknown }>,
    request: ChatRequestPayload
  ): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const traceId = crypto.randomUUID();
    const start = Date.now();
    const model = request.response_mode === "reasoning" ? this.reasoningModel : this.chatModel;

    yield buildSuccess({
      data: { type: "metadata", conversation_id: request.conversation_id, agent_name: "openai", agent_type: "llm" },
      provider: { name: this.name, metadata: { model } },
      traceId,
      latencyMs: 0,
    });

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model, messages, stream: true }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `OpenAI stream failed: ${res.status} ${text}` });
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
            if (delta) yield buildSuccess({ data: { type: "delta", delta }, provider: { name: this.name }, traceId, latencyMs: Date.now() - start });
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
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `OpenAI transcription failed: ${res.status} ${text}` });
      }

      const data = await res.json() as any;
      return buildSuccess({
        data: { text: data.text ?? "", language: data.language, durationSeconds: data.duration },
        provider: { name: this.name, metadata: { model: this.transcriptionModel } },
        traceId,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      if (CapabilityError.is(e)) return buildError({ error: e, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      return buildError({ error: CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e }), traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

async function buildVisionContent(
  text: string,
  files: AttachedFile[]
): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const content: Array<{ type: string; [k: string]: unknown }> = [{ type: "text", text }];

  for (const f of files) {
    if (f.mimeType.startsWith("image/")) {
      const b64 = f.buffer.toString("base64");
      content.push({
        type: "image_url",
        image_url: { url: `data:${f.mimeType};base64,${b64}` },
      });
    }
  }

  return content;
}
