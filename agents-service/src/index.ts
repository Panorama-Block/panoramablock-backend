import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { buildContainer } from "./infrastructure/di/container";
import { createAgentRouter } from "./http/agent.router";

dotenv.config();

const app = express();
const PORT = process.env.AGENTS_PORT ?? process.env.PORT ?? 3020;

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// -------------------------------------------------------------------------------------------------
// Compose service graph
// -------------------------------------------------------------------------------------------------

const { registry, healthTracker, service } = buildContainer({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  AGENTS_API_BASE: process.env.AGENTS_API_BASE,
  REDIS_URL: process.env.REDIS_URL,
  AGENTS_REQUEST_TIMEOUT_MS: process.env.AGENTS_REQUEST_TIMEOUT_MS,
});

// Start health polling
healthTracker.start();

// -------------------------------------------------------------------------------------------------
// Multer middleware for file/audio routes
// -------------------------------------------------------------------------------------------------

app.post("/chat/stream-with-files", upload.array("files"), (_req, _res, next) => next());
app.post("/chat/audio", upload.single("audio"), (_req, _res, next) => next());
app.post("/transcribe", upload.single("audio"), (_req, _res, next) => next());
app.post("/v1/capability/agent/transcribe", upload.single("audio"), (_req, _res, next) => next());

// -------------------------------------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------------------------------------

app.use(createAgentRouter(service, registry, healthTracker));

// -------------------------------------------------------------------------------------------------
// Health endpoint
// -------------------------------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  const report = healthTracker.report();
  const allHealthy = report.every((r) => r.healthy);
  res.status(allHealthy ? 200 : 207).json({ status: allHealthy ? "ok" : "degraded", providers: report });
});

// -------------------------------------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------------------------------------

app.listen(PORT, () => {
  const registered = registry.listAll({ includeDisabled: true }).map((p) => p.name);
  console.log(`[agents-service] Listening on port ${PORT}`);
  console.log(`[agents-service] Registered providers: ${registered.join(", ") || "(none)"}`);
});
