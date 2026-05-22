/**
 * Capability envelope — the request/response shape every capability speaks.
 *
 * Every `/v1/capability/<slug>/<action>` endpoint receives a `CapabilityRequest<T>`
 * (where `T` is the action-specific payload) and returns a `CapabilityResponse<U>`
 * (where `U` is the action-specific data on success).
 *
 * See ADR 002 (capability-provider abstraction) and CONVENTIONS.md.
 */

import type { CapabilityError } from "./errors";

// -------------------------------------------------------------------------------------------------
// Common primitives
// -------------------------------------------------------------------------------------------------

/**
 * EVM-style address as a 0x-prefixed hex string. Validation (checksum/length) is the consumer's job.
 */
export type Address = string;

/**
 * Numeric chain id (EIP-155). See `chains/` for the manifest of supported chains.
 */
export type ChainId = number;

/**
 * Wei amount serialised as a decimal string. We never pass BigInt over JSON.
 */
export type WeiString = string;

/**
 * RFC 4122 UUID — used for traceId, idempotencyKey.
 */
export type Uuid = string;

// -------------------------------------------------------------------------------------------------
// Provider info attached to every successful response
// -------------------------------------------------------------------------------------------------

/**
 * Provider info surfaced back to the caller. The `metadata` bag is provider-specific.
 *
 * **Important:** consumers (FE, agents) may display `provider.name` but must not branch on it for
 * business logic. Provider selection is the backend's job; see ADR 001.
 */
export interface ProviderInfo {
  /** Provider name. Lowercase, ASCII. See CONVENTIONS.md §5. */
  name: string;
  /** Free-form provider-specific data: pool id, route hops, on-chain tx ids of intermediate steps. */
  metadata?: Record<string, unknown>;
}

// -------------------------------------------------------------------------------------------------
// Transaction shape — used by every capability that prepares blockchain transactions
// -------------------------------------------------------------------------------------------------

/**
 * A prepared blockchain transaction ready for user signature.
 *
 * Fee mode:
 * - `authoritative` — the provider committed to specific gas params and they should be used as-is.
 * - `advisory` — the provider suggested gas but the signer may override.
 */
export interface Transaction {
  chainId: ChainId;
  to: Address;
  data: string; // 0x-prefixed calldata
  value: WeiString; // wei as decimal string
  gasLimit?: WeiString;
  gasPrice?: WeiString;
  maxFeePerGas?: WeiString;
  maxPriorityFeePerGas?: WeiString;
  feeMode?: "authoritative" | "advisory";
  /** Optional human-readable action label for UX (e.g. "Approve USDC", "Swap USDC → ETH"). */
  action?: string;
  /** Optional human-readable description for UX. */
  description?: string;
}

// -------------------------------------------------------------------------------------------------
// Request envelope
// -------------------------------------------------------------------------------------------------

/**
 * Standard request envelope. `payload` is the action-specific input.
 *
 * Headers ↔ fields:
 * - `tenantId` ← `x-tenant-id` (mandatory at the public surface; defaulted by the gateway for FE traffic)
 * - `traceId` ← `x-trace-id` (mandatory; gateway generates if missing)
 * - `idempotencyKey` ← `x-idempotency-key` (optional; required for state-mutating actions)
 */
export interface CapabilityRequest<TPayload> {
  tenantId: string;
  traceId: Uuid;
  /** Required for state-mutating actions (prepare-*, schedule-*). Hash(key + body) → cached response. */
  idempotencyKey?: Uuid;
  chainId: ChainId;
  userAddress: Address;
  payload: TPayload;
  /** Receipt metadata — when the request was received by the controller. Filled by middleware. */
  receivedAt?: string; // ISO 8601
}

// -------------------------------------------------------------------------------------------------
// Response envelope (discriminated union)
// -------------------------------------------------------------------------------------------------

/**
 * Successful response. `data` is the action-specific result.
 */
export interface CapabilitySuccessResponse<TData> {
  status: "success";
  data: TData;
  /** Which provider served this request. Display-only for consumers. */
  provider: ProviderInfo;
  traceId: Uuid;
  /** Time spent in the backend orchestration layer (controller → facade → adapter → back). */
  latencyMs: number;
  /** Optional list of providers attempted before the selected one (debug aid). */
  attemptedProviders?: Array<{ name: string; reason: string }>;
}

/**
 * Error response. `error` carries category + code + details for the FE to render UX.
 */
export interface CapabilityErrorResponse {
  status: "error";
  error: SerializedCapabilityError;
  /** Provider attempted when the error occurred (undefined if error happened before provider selection). */
  provider?: ProviderInfo;
  traceId: Uuid;
  latencyMs: number;
  attemptedProviders?: Array<{ name: string; reason: string }>;
}

/**
 * The wire format of `CapabilityError`. Serialisation happens in the HTTP layer; this is what FE sees.
 */
export interface SerializedCapabilityError {
  code: string;
  category: string;
  message: string;
  provider?: string;
  details?: Record<string, unknown>;
  httpStatus: number;
}

/**
 * Union of all responses.
 */
export type CapabilityResponse<TData> =
  | CapabilitySuccessResponse<TData>
  | CapabilityErrorResponse;

// -------------------------------------------------------------------------------------------------
// Type guards
// -------------------------------------------------------------------------------------------------

/**
 * Narrows a `CapabilityResponse<T>` to its success variant.
 *
 * @example
 *   const r = await capabilityClient.invoke('swap', 'quote', payload);
 *   if (isSuccess(r)) {
 *     console.log(r.data.expectedAmount);
 *   } else {
 *     console.error(r.error.code);
 *   }
 */
export function isSuccess<T>(
  response: CapabilityResponse<T>
): response is CapabilitySuccessResponse<T> {
  return response.status === "success";
}

/**
 * Narrows a `CapabilityResponse<T>` to its error variant.
 */
export function isError<T>(
  response: CapabilityResponse<T>
): response is CapabilityErrorResponse {
  return response.status === "error";
}

// -------------------------------------------------------------------------------------------------
// Builders (server-side helpers)
// -------------------------------------------------------------------------------------------------

export interface BuildSuccessInput<TData> {
  data: TData;
  provider: ProviderInfo;
  traceId: Uuid;
  latencyMs: number;
  attemptedProviders?: Array<{ name: string; reason: string }>;
}

/**
 * Build a success response. Server-side helper; FE does not use this.
 */
export function buildSuccess<TData>(
  input: BuildSuccessInput<TData>
): CapabilitySuccessResponse<TData> {
  return {
    status: "success",
    data: input.data,
    provider: input.provider,
    traceId: input.traceId,
    latencyMs: input.latencyMs,
    ...(input.attemptedProviders && { attemptedProviders: input.attemptedProviders }),
  };
}

export interface BuildErrorInput {
  error: CapabilityError;
  traceId: Uuid;
  latencyMs: number;
  provider?: ProviderInfo;
  attemptedProviders?: Array<{ name: string; reason: string }>;
}

/**
 * Build an error response from a `CapabilityError`. The HTTP layer should call this and use
 * `response.error.httpStatus` for the status code.
 */
export function buildError(input: BuildErrorInput): CapabilityErrorResponse {
  return {
    status: "error",
    error: input.error.toSerialized(),
    traceId: input.traceId,
    latencyMs: input.latencyMs,
    ...(input.provider && { provider: input.provider }),
    ...(input.attemptedProviders && { attemptedProviders: input.attemptedProviders }),
  };
}
