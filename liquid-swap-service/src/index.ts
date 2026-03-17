// backend/liquid-swap-service/src/index.ts

import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
// Usamos require() para garantir o objeto de runtime do express,
// evitando o erro "This expression is not callable" no seu setup.
const expressLib = require("express") as any;
import * as fs from "fs";
import https from "https";

import type {
  Request,
  Response,
  NextFunction,
} from "express-serve-static-core";
import cors from "cors";
import { swapRouter } from "./infrastructure/http/routes/swap.routes";
import { verifyJwtMiddleware } from "./middleware/authMiddleware";
import { requestContextMiddleware } from "./infrastructure/http/middlewares/request-context.middleware";
import { createErrorResponder } from "./infrastructure/http/middlewares/error.responder";
import { SwapError, SwapErrorCode } from "./domain/entities/errors";
import { DIContainer } from "./infrastructure/di/container";

const PORT = process.env.PORT || process.env.LIQUID_SWAP_PORT || 3002;

try {
  console.log(
    "[Liquid Swap Service] 🚀 Initializing with Hexagonal Architecture..."
  );

  // Debug logging
  if (process.env.DEBUG === "true") {
    console.log("[Liquid Swap Service] Configuration:");
    console.log("- PORT:", PORT);
    console.log("- NODE_ENV:", process.env.NODE_ENV);
    console.log("- AUTH_SERVICE_URL:", process.env.AUTH_SERVICE_URL);
    console.log(
      "- THIRDWEB_CLIENT_ID:",
      process.env.THIRDWEB_CLIENT_ID ? "[CONFIGURED]" : "[NOT SET]"
    );
    console.log(
      "- AUTH_PRIVATE_KEY:",
      process.env.AUTH_PRIVATE_KEY ? "[CONFIGURED]" : "[NOT SET]"
    );
  }

  const app = expressLib();

  // SSL certificate options for HTTPS
  const getSSLOptions = () => {
    try {
      const certPath = process.env.FULLCHAIN || "/etc/letsencrypt/live/api.panoramablock.com/fullchain.pem";
      const keyPath = process.env.PRIVKEY || "/etc/letsencrypt/live/api.panoramablock.com/privkey.pem";
      
      console.log(`[Liquid Swap Service] Verificando certificados SSL em: ${certPath} e ${keyPath}`);
      
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        console.log('[Liquid Swap Service] ✅ Certificados SSL encontrados!');
        return {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
      } else {
        console.warn('[Liquid Swap Service] ⚠️ Certificados SSL não encontrados nos caminhos:');
        console.warn(`- Cert: ${certPath} (${fs.existsSync(certPath) ? 'existe' : 'não existe'})`);
        console.warn(`- Key: ${keyPath} (${fs.existsSync(keyPath) ? 'existe' : 'não existe'})`);
        console.warn('Executando em modo HTTP.');
        return null;
      }
    } catch (error) {
      console.warn('[Liquid Swap Service] ❌ Erro ao carregar certificados SSL:', error);
      return null;
    }
  };

  // Middlewares
  console.log("[Liquid Swap Service] ⚙️  Configuring middlewares...");
  app.use(cors());
  app.use(expressLib.json({ limit: "10mb" }));
  app.use(expressLib.urlencoded({ extended: true, limit: "10mb" }));
  app.use(requestContextMiddleware);

  // Request logging (opcional via DEBUG)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (process.env.DEBUG === "true") {
      console.log(
        `[${new Date().toISOString()}][trace:${req.traceId}] ${req.method} ${req.path}`
      );
    }
    next();
  });

  // Rotas protegidas por JWT
  console.log("[Liquid Swap Service] 🔗 Registering routes...");

  // Debug route without authentication (for development only)
  if (process.env.NODE_ENV === "development") {
    const di = DIContainer.getInstance();
    app.post("/debug/compare-providers", di.swapController.compareProviders);
    console.log("[Liquid Swap Service] 🔍 Debug endpoint enabled: /debug/compare-providers");
  }

  // /swap/quote is a read-only price-fetch — no auth required (smartAccountAddress in body is sufficient)
  // /swap/tx and /swap/status require auth to prevent abuse and tie history to the user
  const di = DIContainer.getInstance();
  app.post("/swap/quote", di.swapController.getQuote);
  app.use("/swap", verifyJwtMiddleware, swapRouter);

  // Back-compat aliases (some older clients call these without the /swap prefix).
  app.post("/quote", di.swapController.getQuote);          // no auth — read-only
  app.post("/tx", verifyJwtMiddleware, di.swapController.getPreparedTx);
  app.post("/prepare", verifyJwtMiddleware, di.swapController.getPreparedTx);

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    try {
      console.log("[Health] Health check requested");
      res.json({
        status: "ok",
        service: "liquid-swap-service",
        version: "1.0.0",
        architecture: "hexagonal",
        environment: process.env.NODE_ENV || "development",
        timestamp: new Date().toISOString(),
        supportedChains: [1, 137, 56, 8453, 10, 42161, 43114],
        integrations: {
          thirdweb: process.env.THIRDWEB_CLIENT_ID
            ? "configured"
            : "not configured",
          authService: process.env.AUTH_SERVICE_URL
            ? "configured"
            : "not configured",
        },
      });
    } catch (error) {
      const err = error as Error;
      console.error("[Health] Error processing health check:", err.message);
      res.status(500).json({
        status: "error",
        message: "Internal error in health check",
      });
    }
  });

  // Root info
  app.get("/", (_req: Request, res: Response) => {
    try {
      res.json({
        name: "PanoramaBlock Liquid Swap Service",
        description:
          "Cross-chain token swaps using ThirdWeb SDK with Hexagonal Architecture",
        version: "1.0.0",
        architecture: {
          pattern: "hexagonal",
          layers: ["domain", "application", "infrastructure"],
          principles: [
            "Domain-Driven Design",
            "Dependency Injection",
            "Clean Architecture",
          ],
        },
        environment: process.env.NODE_ENV || "development",
        endpoints: {
          "/health": "Service health check",
          "/swap/quote": "Get quote (requires JWT auth)",
          "/swap/tx": "Get prepared tx bundle (requires JWT auth)",
          "/swap/execute": process.env.ENGINE_ENABLED === "true"
            ? "Execute via Engine (ERC4337, requires JWT)"
            : "Disabled (set ENGINE_ENABLED=true)",
          "/swap/history": "Get user swap history (requires JWT auth)",
          "/swap/status/:transactionHash?chainId=...": "Get route status for a transaction (requires JWT)",
        },
        supportedChains: {
          "1": "Ethereum Mainnet",
          "137": "Polygon",
          "56": "Binance Smart Chain",
          "8453": "Base",
          "10": "Optimism",
          "42161": "Arbitrum One",
          "43114": "Avalanche C-Chain",
        },
        features: [
          "Cross-chain token swaps",
          "Prepared transactions (non-custodial)",
          "Transaction monitoring",
          "Swap history tracking",
          "JWT Authentication",
          "User wallet integration",
        ],
        integrations: {
          thirdweb: process.env.THIRDWEB_CLIENT_ID
            ? "✅ Configured"
            : "❌ Not configured",
          auth_service: process.env.AUTH_SERVICE_URL || "❌ Not configured",
        },
        security: {
          authentication: "JWT tokens via auth-service",
          wallet_handling: "Non-custodial — client signs and sends",
          transaction_execution: "Server returns prepared bundle only",
        },
      });
    } catch (error) {
      const err = error as Error;
      console.error(
        "[Info] Error processing information request:",
        err.message
      );
      res
        .status(500)
        .json({ error: "Internal error while retrieving information" });
    }
  });

  // CORS for engine signer endpoint (explicit, even though global CORS is enabled)
  const signerCors = cors({
    origin: "*", // reflect request origin
    credentials: false,
    methods: ["GET", "OPTIONS"],
  });
  app.options("/engine/signer", signerCors);

  // expose engine's signer address
  app.get("/engine/signer", signerCors, (_req: Request, res: Response) => {
    const address = process.env.ENGINE_SESSION_SIGNER_ADDRESS || process.env.ADMIN_WALLET_ADDRESS;
    if (!address) {
      return res.status(503).json({ error: "Engine signer not configured" });
    }
    res.json({address});
  });

  // 404 handler forwarding to error responder
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.warn(`[404] Route not found: ${req.method} ${req.originalUrl}`);
    next(
      new SwapError(
        SwapErrorCode.INVALID_REQUEST,
        "Endpoint not found",
        {
          path: req.originalUrl,
          method: req.method,
        },
        404
      )
    );
  });

  // Centralized error handler must be registered last
  app.use(createErrorResponder());

  const sslOptions = getSSLOptions();

  if (sslOptions) {
    const server = https.createServer(sslOptions, app).listen(PORT, () => {
      console.log(`\n🎉 [Liquid Swap Service] HTTPS Server running successfully!`);
      console.log(`📊 Port: ${PORT}`);
      console.log(`🔒 Protocol: HTTPS`);
      console.log(`🏗️  Architecture: Hexagonal (Domain-Driven Design)`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`📋 Health check: https://localhost:${PORT}/health`);
      console.log(`📖 Documentation: https://localhost:${PORT}/`);
      console.log(`🔄 Swap API: https://localhost:${PORT}/swap/`);
      console.log(`✨ Ready to process cross-chain swaps!\n`);
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log(
        "[Liquid Swap Service] SIGTERM received, shutting down gracefully..."
      );
      server.close(() => {
        console.log("[Liquid Swap Service] Server closed");
        process.exit(0);
      });
    });
  } else {
    const server = app.listen(PORT, () => {
      console.log(`\n🎉 [Liquid Swap Service] HTTP Server running successfully!`);
      console.log(`📊 Port: ${PORT}`);
      console.log(`🔓 Protocol: HTTP`);
      console.log(`🏗️  Architecture: Hexagonal (Domain-Driven Design)`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`📋 Health check: http://localhost:${PORT}/health`);
      console.log(`📖 Documentation: http://localhost:${PORT}/`);
      console.log(`🔄 Swap API: http://localhost:${PORT}/swap/`);
      console.log(`✨ Ready to process cross-chain swaps!\n`);
      if (process.env.NODE_ENV === 'production') {
        console.warn('[Liquid Swap Service] WARNING: Running in HTTP mode in production. SSL certificates not found.');
      }
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log(
        "[Liquid Swap Service] SIGTERM received, shutting down gracefully..."
      );
      server.close(() => {
        console.log("[Liquid Swap Service] Server closed");
        process.exit(0);
      });
    });
  }
} catch (error) {
  const err = error as Error;
  console.error(
    "[Liquid Swap Service] 💥 Fatal error initializing service:",
    err.message
  );
  if (process.env.DEBUG === "true") {
    console.error("[Liquid Swap Service] Stack trace:", err.stack);
  }
  process.exit(1);
}
