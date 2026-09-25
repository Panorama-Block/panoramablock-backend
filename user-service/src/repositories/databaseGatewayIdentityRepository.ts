import {
  IdentityMapping,
  IdentityProvider,
} from "../domain/identity";
import { IdentityRepository } from "./identityRepository";

type PlainObject = Record<string, unknown>;

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export class DatabaseGatewayIdentityRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseGatewayIdentityRepositoryError";
  }
}

function asObject(value: unknown): PlainObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as PlainObject;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export class DatabaseGatewayIdentityRepository
  implements IdentityRepository
{
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    baseUrl?: string;
    serviceToken?: string;
    timeoutMs?: number;
    fetchImpl?: FetchLike;
  }) {
    this.baseUrl = (
      options?.baseUrl ??
      process.env.DB_GATEWAY_URL ??
      ""
    ).replace(/\/+$/, "");

    this.serviceToken =
      options?.serviceToken ??
      process.env.DB_GATEWAY_SERVICE_TOKEN ??
      "";

    this.timeoutMs =
      options?.timeoutMs ??
      Number(process.env.DB_GATEWAY_TIMEOUT_MS || 2000);

    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  private assertConfigured(tenantId: string): void {
    if (!this.baseUrl) {
      throw new DatabaseGatewayIdentityRepositoryError(
        "DB_GATEWAY_URL is not configured"
      );
    }

    if (!this.serviceToken) {
      throw new DatabaseGatewayIdentityRepositoryError(
        "DB_GATEWAY_SERVICE_TOKEN is not configured"
      );
    }

    if (!tenantId.trim()) {
      throw new DatabaseGatewayIdentityRepositoryError(
        "Tenant ID must not be empty"
      );
    }

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new DatabaseGatewayIdentityRepositoryError(
        "DB_GATEWAY_TIMEOUT_MS is invalid"
      );
    }
  }

  async findByProviderSubject(
    tenantId: string,
    provider: IdentityProvider,
    providerSubject: string
  ): Promise<IdentityMapping[]> {
    const normalizedTenantId = tenantId.trim();
    this.assertConfigured(normalizedTenantId);

    const where = encodeURIComponent(
      JSON.stringify({
        provider,
        providerSubject,
      })
    );

    const path =
      `/v1/user-identities?where=${where}&take=2`;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.timeoutMs
    );

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}${path}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.serviceToken}`,
            "x-tenant-id": normalizedTenantId,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        }
      );

      const text = await response.text();
      let payload: unknown = null;

      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new DatabaseGatewayIdentityRepositoryError(
            "Database Gateway returned invalid JSON"
          );
        }
      }

      if (!response.ok) {
        throw new DatabaseGatewayIdentityRepositoryError(
          `Database Gateway GET ${path} failed with HTTP ${response.status}`
        );
      }

      const envelope = asObject(payload);
      const data = envelope?.data;

      if (!Array.isArray(data)) {
        throw new DatabaseGatewayIdentityRepositoryError(
          "Database Gateway returned an invalid user-identities list response"
        );
      }

      return data.map((value, index) => {
        const record = asObject(value);

        if (!record) {
          throw new DatabaseGatewayIdentityRepositoryError(
            `Invalid user-identities record at index ${index}`
          );
        }

        const mapping: IdentityMapping = {
          provider: asString(
            record.provider
          ) as IdentityProvider,
          providerSubject: asString(
            record.providerSubject
          ),
          userId: asString(record.userId),
          tenantId: asString(record.tenantId),
        };

        if (mapping.tenantId !== normalizedTenantId) {
          throw new DatabaseGatewayIdentityRepositoryError(
            "Database Gateway returned an identity outside the requested tenant"
          );
        }

        if (mapping.provider !== provider) {
          throw new DatabaseGatewayIdentityRepositoryError(
            "Database Gateway returned an identity for a different provider"
          );
        }

        if (mapping.providerSubject !== providerSubject) {
          throw new DatabaseGatewayIdentityRepositoryError(
            "Database Gateway returned an identity for a different provider subject"
          );
        }

        if (!mapping.userId.trim()) {
          throw new DatabaseGatewayIdentityRepositoryError(
            "Database Gateway returned an identity without a PB user ID"
          );
        }

        return mapping;
      });
    } catch (error) {
      if (
        error instanceof
        DatabaseGatewayIdentityRepositoryError
      ) {
        throw error;
      }

      if ((error as Error)?.name === "AbortError") {
        throw new DatabaseGatewayIdentityRepositoryError(
          `Database Gateway request timed out after ${this.timeoutMs}ms`
        );
      }

      throw new DatabaseGatewayIdentityRepositoryError(
        `Database Gateway request failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
