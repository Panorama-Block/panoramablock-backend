/**
 * Express router for all agent capability endpoints.
 *
 * Legacy routes (/chat, /chat/stream, etc.) are preserved for backward compatibility.
 * New capability routes live under /v1/capability/agent/*.
 * Discovery endpoint: GET /v1/capability/_discovery
 */

import { Router, Request, Response } from "express";
import type { AgentCapabilityService } from "../application/services/agent.capability.service";
import type { ProviderRegistry } from "@panorama/capability";
import type { ProviderHealthTracker } from "@panorama/capability";
import { createDiscoveryHandler } from "@panorama/capability";
import type { IAgentProvider } from "../domain/ports/agent.provider.port";
import type { ChatRequestPayload, AttachedFile } from "../domain/types/agent.types";

export function createAgentRouter(
  service: AgentCapabilityService,
  registry: ProviderRegistry<IAgentProvider>,
  healthTracker: ProviderHealthTracker
): Router {
  const router = Router();

  // -------------------------------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------------------------------

  const discoveryHandler = createDiscoveryHandler({
    listProviders: () => registry.listAll({ includeDisabled: false }),
    snapshotHealth: () => healthTracker.snapshot(),
    cacheTtlSeconds: 30,
  });

  router.get("/v1/capability/_discovery", (req: Request, res: Response) => {
    const traceId = (req.headers["x-trace-id"] as string) ?? crypto.randomUUID();
    const result = discoveryHandler({ traceId, force: req.query.force === "true" });
    res.status(200).json(result);
  });

  // -------------------------------------------------------------------------------------------------
  // Capability routes: /v1/capability/agent/*
  // -------------------------------------------------------------------------------------------------

  router.post("/v1/capability/agent/chat", async (req: Request, res: Response) => {
    try {
      const payload = req.body as ChatRequestPayload;
      const result = await service.chat(payload);
      const status = result.status === "success" ? 200 : (result as any).error?.httpStatus ?? 500;
      res.status(status).json(result);
    } catch (e) {
      res.status(500).json({ status: "error", error: { code: "CAPABILITY_INTERNAL_ERROR", message: String(e) } });
    }
  });

  router.post("/v1/capability/agent/stream", async (req: Request, res: Response) => {
    setupSSE(res);
    try {
      const payload = req.body as ChatRequestPayload;
      for await (const chunk of service.stream(payload)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if (chunk.status === "success" && (chunk.data as any).type === "done") break;
        if (chunk.status === "error") break;
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ status: "error", error: { code: "CAPABILITY_INTERNAL_ERROR", message: String(e) } })}\n\n`);
    } finally {
      res.end();
    }
  });

  router.post("/v1/capability/agent/transcribe", async (req: Request, res: Response) => {
    if (!req.file && !(req as any).files?.audio) {
      return res.status(400).json({ status: "error", error: { code: "CAPABILITY_AGENT_VALIDATION_FAILED", message: "audio file required" } });
    }
    try {
      const file = (req.file ?? (req as any).files?.audio) as Express.Multer.File;
      const result = await service.transcribe({
        audio: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      });
      const status = result.status === "success" ? 200 : (result as any).error?.httpStatus ?? 500;
      res.status(status).json(result);
    } catch (e) {
      res.status(500).json({ status: "error", error: { code: "CAPABILITY_INTERNAL_ERROR", message: String(e) } });
    }
  });

  // -------------------------------------------------------------------------------------------------
  // Legacy routes (backward-compat, kept for miniapp/gateway consumers)
  // Maps to the same service layer — Deprecation header added.
  // -------------------------------------------------------------------------------------------------

  const deprecationHeader = { Deprecation: "true", Sunset: "2026-09-01", Link: '</v1/capability/agent/chat>; rel="successor-version"' };

  router.post("/chat", async (req: Request, res: Response) => {
    res.set(deprecationHeader);
    try {
      const result = await service.chat(req.body as ChatRequestPayload);
      if (result.status === "success") return res.json(result.data);
      res.status((result as any).error?.httpStatus ?? 500).json({ error: (result as any).error?.message ?? "internal error" });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post("/chat/stream", async (req: Request, res: Response) => {
    res.set({ ...deprecationHeader, ...sseHeaders() });
    try {
      for await (const chunk of service.stream(req.body as ChatRequestPayload)) {
        if (chunk.status === "success") {
          const d = chunk.data as any;
          if (d.type === "metadata") {
            res.write(`data: ${JSON.stringify({ type: "metadata", provider: chunk.provider.name, traceId: chunk.traceId })}\n\n`);
          } else if (d.type === "delta") {
            res.write(`data: ${JSON.stringify({ delta: d.delta })}\n\n`);
          } else if (d.type === "done") {
            res.write("data: [DONE]\n\n");
            break;
          }
        } else {
          res.write(`data: ${JSON.stringify({ error: (chunk as any).error?.message })}\n\n`);
          break;
        }
      }
    } finally {
      res.end();
    }
  });

  router.post("/chat/stream-with-files", async (req: Request, res: Response) => {
    res.set({ ...deprecationHeader, ...sseHeaders() });
    try {
      const files: AttachedFile[] = ((req as any).files ?? []).map((f: Express.Multer.File) => ({
        buffer: f.buffer,
        filename: f.originalname,
        mimeType: f.mimetype,
      }));

      const payload = {
        message: { role: "user" as const, content: req.body.message as string },
        user_id: req.body.user_id,
        conversation_id: req.body.conversation_id,
        wallet_address: req.body.wallet_address,
        response_mode: req.body.response_mode,
        files,
      };

      for await (const chunk of service.streamWithFiles(payload)) {
        if (chunk.status === "success") {
          const d = chunk.data as any;
          if (d.type === "delta") res.write(`data: ${JSON.stringify({ delta: d.delta })}\n\n`);
          else if (d.type === "done") { res.write("data: [DONE]\n\n"); break; }
        }
      }
    } finally {
      res.end();
    }
  });

  router.post("/chat/audio", async (req: Request, res: Response) => {
    res.set(deprecationHeader);
    try {
      const file = req.file ?? (req as any).files?.audio;
      if (!file) return res.status(400).json({ error: "audio file required" });

      const transcribeResult = await service.transcribe({
        audio: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      });

      let transcription = "";
      if (transcribeResult.status === "success") {
        transcription = transcribeResult.data.text;
      }

      // Now send the transcription as a chat message
      const chatResult = await service.chat({
        message: { role: "user", content: transcription },
        user_id: req.body.user_id,
        conversation_id: req.body.conversation_id,
        wallet_address: req.body.wallet_address,
      });

      if (chatResult.status === "success") {
        return res.json({ ...chatResult.data, transcription });
      }
      res.status(500).json({ error: "chat failed after transcription" });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post("/transcribe", async (req: Request, res: Response) => {
    res.set(deprecationHeader);
    try {
      const file = req.file ?? (req as any).files?.audio;
      if (!file) return res.status(400).json({ error: "audio file required" });

      const result = await service.transcribe({ audio: file.buffer, filename: file.originalname, mimeType: file.mimetype });
      if (result.status === "success") return res.json({ text: result.data.text });
      res.status(500).json({ error: "transcription failed" });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // -------------------------------------------------------------------------------------------------
  // Conversation management
  // -------------------------------------------------------------------------------------------------

  router.get("/chat/conversations", async (req: Request, res: Response) => {
    const userId = req.query.user_id as string;
    if (!userId) return res.status(400).json({ error: "user_id required" });
    const conversations = await service.listConversations(userId);
    res.json({ conversations });
  });

  router.post("/chat/conversations", async (req: Request, res: Response) => {
    const userId = (req.body.user_id ?? req.query.user_id) as string;
    if (!userId) return res.status(400).json({ error: "user_id required" });
    const conversationId = await service.createConversation(userId);
    res.json({ conversation_id: conversationId });
  });

  router.get("/chat/messages", async (req: Request, res: Response) => {
    const userId = req.query.user_id as string;
    const conversationId = req.query.conversation_id as string;
    if (!userId || !conversationId) return res.status(400).json({ error: "user_id and conversation_id required" });
    const messages = await service.getMessages(userId, conversationId);
    res.json({ messages });
  });

  router.delete("/chat/conversations/:id", async (req: Request, res: Response) => {
    const userId = req.query.user_id as string;
    const conversationId = req.params.id;
    if (!userId) return res.status(400).json({ error: "user_id required" });
    await service.deleteConversation(userId, conversationId);
    res.status(204).send();
  });

  router.post("/chat/generate-title", async (req: Request, res: Response) => {
    const { user_id, conversation_id, message } = req.body as { user_id: string; conversation_id: string; message: string };
    if (!user_id || !conversation_id || !message) return res.status(400).json({ error: "user_id, conversation_id, and message required" });
    const title = await service.generateTitle(user_id, conversation_id, message);
    res.json({ title });
  });

  return router;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function setupSSE(res: Response) {
  res.set(sseHeaders());
  res.flushHeaders();
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
