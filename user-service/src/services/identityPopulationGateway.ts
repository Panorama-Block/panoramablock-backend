import { createHash } from "node:crypto";
import {
  PersistedIdentity,
  ProposedIdentity,
  reconcileIdentityPopulation,
} from "./identityPopulationReconciliation";
import {
  createIdentityPopulationPlan,
} from "./identityPopulationPlan";

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

type PlainObject = Record<string, unknown>;

export interface PopulationIdentity extends ProposedIdentity {
  verifiedAt: string;
  provenance?: Record<string, unknown>;
}

export interface IdentityPopulationExecutionReport {
  before: {
    proposed: number;
    missing: number;
    identical: number;
    conflict: number;
  };
  batchesExecuted: number;
  writesExecuted: number;
  after: {
    proposed: number;
    missing: number;
    identical: number;
    conflict: number;
  };
}

export class IdentityPopulationGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityPopulationGatewayError";
  }
}

function asObject(value: unknown): PlainObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as PlainObject;
}

function requiredString(
  value: unknown,
  name: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new IdentityPopulationGatewayError(
      `${name} must be a non-empty string`
    );
  }

  return value;
}

export class IdentityPopulationGateway {
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
      throw new IdentityPopulationGatewayError(
        "DB_GATEWAY_URL is not configured"
      );
    }

    if (!this.serviceToken) {
      throw new IdentityPopulationGatewayError(
        "DB_GATEWAY_SERVICE_TOKEN is not configured"
      );
    }

    if (!tenantId.trim()) {
      throw new IdentityPopulationGatewayError(
        "Tenant ID must not be empty"
      );
    }

    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new IdentityPopulationGatewayError(
        "DB_GATEWAY_TIMEOUT_MS is invalid"
      );
    }
  }

  private async request(
    path: string,
    tenantId: string,
    init: RequestInit
  ): Promise<{
    response: Response;
    payload: unknown;
  }> {
    this.assertConfigured(tenantId);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.timeoutMs
    );

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}${path}`,
        {
          ...init,
          headers: {
            Authorization: `Bearer ${this.serviceToken}`,
            "x-tenant-id": tenantId,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
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
          throw new IdentityPopulationGatewayError(
            "Database Gateway returned invalid JSON"
          );
        }
      }

      if (!response.ok) {
        throw new IdentityPopulationGatewayError(
          `Database Gateway ${init.method ?? "GET"} ${path} failed with HTTP ${response.status}`
        );
      }

      return { response, payload };
    } catch (error) {
      if (error instanceof IdentityPopulationGatewayError) {
        throw error;
      }

      if ((error as Error)?.name === "AbortError") {
        throw new IdentityPopulationGatewayError(
          `Database Gateway request timed out after ${this.timeoutMs}ms`
        );
      }

      throw new IdentityPopulationGatewayError(
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

  async listProviderIdentities(
    tenantId: string,
    provider: string
  ): Promise<PersistedIdentity[]> {
    const normalizedTenant = tenantId.trim();
    const normalizedProvider = provider.trim();

    requiredString(normalizedTenant, "tenantId");
    requiredString(normalizedProvider, "provider");

    const identities: PersistedIdentity[] = [];
    const pageSize = 1000;

    for (let skip = 0; ; skip += pageSize) {
      const where = encodeURIComponent(
        JSON.stringify({ provider: normalizedProvider })
      );

      const orderBy = encodeURIComponent(
        JSON.stringify({ id: "asc" })
      );

      const path =
        `/v1/user-identities?where=${where}` +
        `&orderBy=${orderBy}` +
        `&take=${pageSize}` +
        `&skip=${skip}`;

      const { payload } = await this.request(
        path,
        normalizedTenant,
        { method: "GET" }
      );

      const envelope = asObject(payload);
      const data = envelope?.data;

      if (!Array.isArray(data)) {
        throw new IdentityPopulationGatewayError(
          "Database Gateway returned an invalid user-identities list response"
        );
      }

      const page = data.map((value, index): PersistedIdentity => {
        const record = asObject(value);

        if (!record) {
          throw new IdentityPopulationGatewayError(
            `Invalid user-identities record at page index ${index}`
          );
        }

        const identity: PersistedIdentity = {
          userId: requiredString(
            record.userId,
            "userIdentity.userId"
          ),
          provider: requiredString(
            record.provider,
            "userIdentity.provider"
          ),
          providerSubject: requiredString(
            record.providerSubject,
            "userIdentity.providerSubject"
          ),
          tenantId: requiredString(
            record.tenantId,
            "userIdentity.tenantId"
          ),
        };

        if (identity.tenantId !== normalizedTenant) {
          throw new IdentityPopulationGatewayError(
            "Database Gateway returned an identity outside the requested tenant"
          );
        }

        if (identity.provider !== normalizedProvider) {
          throw new IdentityPopulationGatewayError(
            "Database Gateway returned an identity for a different provider"
          );
        }

        return identity;
      });

      identities.push(...page);

      if (page.length < pageSize) {
        break;
      }
    }

    return identities;
  }

  private idempotencyKey(
    tenantId: string,
    batch: PopulationIdentity[]
  ): string {
    const canonical = JSON.stringify({
      operation: "a8-thirdweb-identity-population",
      tenantId,
      identities: batch,
    });

    return `a8-thirdweb-identity-population-${createHash("sha256")
      .update(canonical)
      .digest("hex")}`;
  }

  private async writeBatch(
    tenantId: string,
    batch: PopulationIdentity[]
  ): Promise<void> {
    const ops = batch.map((identity) => ({
      op: "create",
      entity: "user-identities",
      args: {
        data: {
          userId: identity.userId,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          provenance: identity.provenance,
          verifiedAt: identity.verifiedAt,
          tenantId: identity.tenantId,
        },
      },
    }));

    const path = "/v1/_transact";

    const { payload } = await this.request(
      path,
      tenantId,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": this.idempotencyKey(
            tenantId,
            batch
          ),
        },
        body: JSON.stringify({ ops }),
      }
    );

    const envelope = asObject(payload);

    if (!envelope || !Array.isArray(envelope.data)) {
      throw new IdentityPopulationGatewayError(
        "Database Gateway returned an invalid transaction response"
      );
    }

    if (envelope.data.length !== batch.length) {
      throw new IdentityPopulationGatewayError(
        "Database Gateway transaction response count does not match batch"
      );
    }
  }

  async populate(
    proposals: PopulationIdentity[],
    batchSize = 50
  ): Promise<IdentityPopulationExecutionReport> {
    if (proposals.length === 0) {
      throw new IdentityPopulationGatewayError(
        "Identity population requires at least one proposal"
      );
    }

    const tenantIds = new Set(
      proposals.map((identity) => identity.tenantId)
    );
    const providers = new Set(
      proposals.map((identity) => identity.provider)
    );

    if (tenantIds.size !== 1) {
      throw new IdentityPopulationGatewayError(
        "Identity population requires exactly one tenant"
      );
    }

    if (providers.size !== 1) {
      throw new IdentityPopulationGatewayError(
        "Identity population requires exactly one provider"
      );
    }

    const tenantId = proposals[0].tenantId;
    const provider = proposals[0].provider;

    const beforePersisted =
      await this.listProviderIdentities(
        tenantId,
        provider
      );

    const before = reconcileIdentityPopulation(
      proposals,
      beforePersisted
    );

    const plan = createIdentityPopulationPlan(
      before,
      batchSize
    );

    const byKey = new Map(
      proposals.map((identity) => [
        JSON.stringify([
          identity.tenantId,
          identity.provider,
          identity.providerSubject,
        ]),
        identity,
      ])
    );

    let batchesExecuted = 0;
    let writesExecuted = 0;

    for (const batch of plan.batches) {
      let pending = batch.identities.map(
        (identity) => {
          const full = byKey.get(
            JSON.stringify([
              identity.tenantId,
              identity.provider,
              identity.providerSubject,
            ])
          );

          if (!full) {
            throw new IdentityPopulationGatewayError(
              "Population plan contains an unknown identity"
            );
          }

          return full;
        }
      );

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await this.writeBatch(
            tenantId,
            pending
          );

          batchesExecuted += 1;
          writesExecuted += pending.length;
          pending = [];
          break;
        } catch (writeError) {
          const persisted =
            await this.listProviderIdentities(
              tenantId,
              provider
            );

          const convergence =
            reconcileIdentityPopulation(
              pending,
              persisted
            );

          if (convergence.summary.conflict > 0) {
            throw new IdentityPopulationGatewayError(
              `Identity population write failed and reconciliation found ${convergence.summary.conflict} conflict`
            );
          }

          if (
            convergence.summary.identical === pending.length &&
            convergence.summary.missing === 0
          ) {
            pending = [];
            break;
          }

          if (attempt === 2) {
            throw writeError;
          }

          pending = convergence.results
            .filter(
              (result) =>
                result.classification === "MISSING"
            )
            .map((result) => {
              const full = byKey.get(
                JSON.stringify([
                  result.proposal.tenantId,
                  result.proposal.provider,
                  result.proposal.providerSubject,
                ])
              );

              if (!full) {
                throw new IdentityPopulationGatewayError(
                  "Population reconciliation contains an unknown identity"
                );
              }

              return full;
            });

          if (pending.length === 0) {
            break;
          }
        }
      }
    }

    const afterPersisted =
      await this.listProviderIdentities(
        tenantId,
        provider
      );

    const after = reconcileIdentityPopulation(
      proposals,
      afterPersisted
    );

    if (
      after.summary.missing !== 0 ||
      after.summary.conflict !== 0 ||
      after.summary.identical !== proposals.length
    ) {
      throw new IdentityPopulationGatewayError(
        "Identity population post-write reconciliation failed"
      );
    }

    return {
      before: before.summary,
      batchesExecuted,
      writesExecuted,
      after: after.summary,
    };
  }
}
