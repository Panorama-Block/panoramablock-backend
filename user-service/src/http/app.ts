import express, { Request, Response } from "express";
import {
  AuthenticatedIdentity,
  IdentityResolution,
  isIdentityProvider,
} from "../domain/identity";

export interface IdentityResolutionService {
  resolve(
    tenantId: string,
    identity: AuthenticatedIdentity
  ): Promise<IdentityResolution>;
}

function sendInvalidRequest(
  res: Response,
  message: string
): void {
  res.status(400).json({
    error: "invalid_request",
    message,
  });
}

export function createApp(
  resolver: IdentityResolutionService
) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.use((
    error: unknown,
    _req: Request,
    res: Response,
    next: (error?: unknown) => void
  ) => {
    const parseError = error as {
      status?: unknown;
      type?: unknown;
    };

    if (
      parseError?.status === 400 &&
      parseError?.type === "entity.parse.failed"
    ) {
      sendInvalidRequest(
        res,
        "Request body contains invalid JSON"
      );
      return;
    }

    next(error);
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "user-service",
      version: "0.1.0",
    });
  });

  app.get("/", (_req, res) => {
    res.status(200).json({
      name: "PanoramaBlock User Service",
      version: "0.1.0",
      status: "isolated",
    });
  });

  app.post(
    "/v1/identity/resolve",
    async (req: Request, res: Response) => {
      const tenantHeader = req.header("x-tenant-id");
      const tenantId = tenantHeader?.trim() ?? "";

      if (!tenantId) {
        sendInvalidRequest(
          res,
          "x-tenant-id header is required"
        );
        return;
      }

      const body = req.body;

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        sendInvalidRequest(
          res,
          "Request body must be a JSON object"
        );
        return;
      }

      const provider = (body as Record<string, unknown>)
        .provider;
      const subject = (body as Record<string, unknown>)
        .subject;

      if (
        typeof provider !== "string" ||
        !isIdentityProvider(provider)
      ) {
        sendInvalidRequest(
          res,
          "Unsupported identity provider"
        );
        return;
      }

      if (
        typeof subject !== "string" ||
        !subject.trim()
      ) {
        sendInvalidRequest(
          res,
          "Identity provider subject must not be empty"
        );
        return;
      }

      try {
        const result = await resolver.resolve(
          tenantId,
          {
            provider,
            subject,
          }
        );

        if (result.status === "resolved") {
          res.status(200).json(result);
          return;
        }

        if (result.status === "unresolved") {
          res.status(404).json(result);
          return;
        }

        res.status(409).json(result);
      } catch {
        res.status(503).json({
          error: "identity_resolution_unavailable",
        });
      }
    }
  );

  return app;
}
