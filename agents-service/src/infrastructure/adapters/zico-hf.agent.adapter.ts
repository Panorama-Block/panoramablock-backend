/**
 * ZicoHFAgentAdapter — backward-compatibility adapter that proxies to the
 * Hugging Face Space backend (https://colettogs-zico-agent.hf.space).
 *
 * This adapter preserves the existing behavior of the zico_agents Python backend
 * while the new direct-LLM adapters (openai, anthropic, groq) are rolled out.
 * It participates in the registry/policy machinery so it can be ranked last
 * via TaskTypePriorityPolicy (default fallback).
 *
 * When all direct adapters are stable, this adapter can be disabled via
 * `metadata.enabled: false` and eventually removed.
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

export interface ZicoHFAdapterConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export class ZicoHFAgentAdapter implements IAgentProvider {
  readonly name = "zico-hf";

  readonly metadata: ProviderMetadata = {
    name: "zico-hf",
    capability: "agent",
    supportedChains: SUPPORTED_CHAINS,
    features: ["streaming", "transcription", "defi-orchestration", "legacy"],
    version: "1.0.0",
    enabled: true,
  };

  readonly capabilities: AgentProviderCapabilities = {
    chat: true,
    stream: true,
    vision: true,
    transcription: true,
    taskTypes: ["general"],
    models: ["zico-agent-v1"],
  };

  private readonly timeoutMs: number;

  constructor(private readonly config: ZicoHFAdapterConfig) {
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return {
        healthy: res.ok,
        latencyMs: Date.now() - start,
        reason: res.ok ? undefined : `HTTP ${res.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { healthy: false, latencyMs: Date.now() - start, reason: e instanceof Error ? e.message : "unreachable", checkedAt: new Date().toISOString() };
    }
  }

  async chat(request: ChatRequestPayload): Promise<CapabilityResponse<ChatResponseData>> {
    const start = Date.now();
    const traceId = crypto.randomUUID();

    try {
      const body: Record<string, unknown> = {
        message: { role: request.message.role, content: request.message.content },
      };
      if (request.user_id) body.user_id = request.user_id;
      if (request.conversation_id) body.conversation_id = request.conversation_id;
      if (request.wallet_address) body.wallet_address = request.wallet_address;
      if (request.chain_id) body.chain_id = request.chain_id;
      if (request.response_mode) body.response_mode = request.response_mode;
      if (request.metadata) body.metadata = request.metadata;

      const res = await fetch(`${this.config.baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `ZicoHF chat failed: ${res.status} ${text}` });
      }

      const data = await res.json() as any;

      return buildSuccess({
        data: {
          message: data.message ?? data.response ?? "",
          requires_action: Boolean(data.requires_action),
          actions: Array.isArray(data.actions) ? data.actions : undefined,
          agent_name: data.agent_name ?? data.agentName ?? "zico",
          agent_type: data.agent_type ?? data.agentType ?? "orchestrator",
          conversation_id: request.conversation_id,
          metadata: data.metadata ?? null,
        },
        provider: { name: this.name },
        traceId,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      if (CapabilityError.is(e)) return buildError({ error: e, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      return buildError({ error: CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e }), traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
    }
  }

  async *stream(request: ChatRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const traceId = crypto.randomUUID();
    const start = Date.now();

    yield buildSuccess({
      data: { type: "metadata", conversation_id: request.conversation_id, agent_name: "zico", agent_type: "orchestrator" },
      provider: { name: this.name },
      traceId,
      latencyMs: 0,
    });

    try {
      const body: Record<string, unknown> = {
        message: { role: request.message.role, content: request.message.content },
      };
      if (request.user_id) body.user_id = request.user_id;
      if (request.conversation_id) body.conversation_id = request.conversation_id;
      if (request.wallet_address) body.wallet_address = request.wallet_address;
      if (request.chain_id) body.chain_id = request.chain_id;
      if (request.response_mode) body.response_mode = request.response_mode;

      const res = await fetch(`${this.config.baseUrl}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `ZicoHF stream failed: ${res.status} ${text}` });
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
            const event = JSON.parse(raw) as any;
            const delta = event.delta ?? event.text ?? event.content ?? event.message;
            if (delta && typeof delta === "string") {
              yield buildSuccess({ data: { type: "delta", delta }, provider: { name: this.name }, traceId, latencyMs: Date.now() - start });
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      const capError = CapabilityError.is(e) ? e : CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e });
      yield buildError({ error: capError, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      return;
    }

    yield buildSuccess({ data: { type: "done" }, provider: { name: this.name }, traceId, latencyMs: Date.now() - start });
  }

  async *streamWithFiles(request: ChatWithFilesRequestPayload): AsyncIterable<CapabilityResponse<ChatChunk>> {
    const traceId = crypto.randomUUID();
    const start = Date.now();

    yield buildSuccess({
      data: { type: "metadata", conversation_id: request.conversation_id, agent_name: "zico", agent_type: "orchestrator" },
      provider: { name: this.name },
      traceId,
      latencyMs: 0,
    });

    try {
      const formData = new FormData();
      formData.append("message", request.message.content);
      if (request.user_id) formData.append("user_id", request.user_id);
      if (request.conversation_id) formData.append("conversation_id", request.conversation_id);
      if (request.wallet_address) formData.append("wallet_address", request.wallet_address);
      if (request.response_mode) formData.append("response_mode", request.response_mode);

      for (const f of request.files) {
        formData.append("files", new Blob([f.buffer], { type: f.mimeType }), f.filename);
      }

      const res = await fetch(`${this.config.baseUrl}/chat/stream-with-files`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `ZicoHF stream-with-files failed: ${res.status} ${text}` });
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
            const event = JSON.parse(raw) as any;
            const delta = event.delta ?? event.text ?? event.content;
            if (delta && typeof delta === "string") {
              yield buildSuccess({ data: { type: "delta", delta }, provider: { name: this.name }, traceId, latencyMs: Date.now() - start });
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

  async transcribe(request: TranscriptionRequestPayload): Promise<CapabilityResponse<TranscriptionResult>> {
    const start = Date.now();
    const traceId = crypto.randomUUID();

    try {
      const formData = new FormData();
      formData.append("audio", new Blob([request.audio], { type: request.mimeType }), request.filename);

      const res = await fetch(`${this.config.baseUrl}/transcribe`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        const text = await res.text();
        throw CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: `ZicoHF transcribe failed: ${res.status} ${text}` });
      }

      const data = await res.json() as any;
      return buildSuccess({
        data: { text: data.text ?? "" },
        provider: { name: this.name },
        traceId,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      if (CapabilityError.is(e)) return buildError({ error: e, traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
      return buildError({ error: CapabilityError.providerFailure({ capability: "agent", provider: this.name, message: String(e), cause: e }), traceId, latencyMs: Date.now() - start, provider: { name: this.name } });
    }
  }
}
