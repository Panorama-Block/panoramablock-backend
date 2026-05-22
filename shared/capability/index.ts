/**
 * @panorama/capability — public API.
 *
 * Consumers (backend services) import from this entry point. See CONVENTIONS.md.
 */

// Envelope: request/response shapes, primitives, transaction, type guards, builders.
export type {
  Address,
  ChainId,
  WeiString,
  Uuid,
  ProviderInfo,
  Transaction,
  CapabilityRequest,
  CapabilitySuccessResponse,
  CapabilityErrorResponse,
  CapabilityResponse,
  SerializedCapabilityError,
  BuildSuccessInput,
  BuildErrorInput,
} from "./envelope.types";

export { isSuccess, isError, buildSuccess, buildError } from "./envelope.types";

// Errors: taxonomy, class, factories.
export { ErrorCategory, CapabilityError, categoryToHttpStatus } from "./errors";

// Provider metadata: shape + capability slug + base provider interface.
export type {
  CapabilitySlug,
  ProviderMetadata,
  ICapabilityProvider,
  ProviderHealth,
} from "./provider.types";

export {
  CAPABILITY_SLUGS,
  isCapabilitySlug,
  validateProviderMetadata,
} from "./provider.types";

// Availability: discovery schema for /v1/capability/_discovery.
export type {
  ProviderAvailability,
  CapabilityAvailability,
  AvailabilityMap,
} from "./availability.types";

export { buildAvailabilityMap } from "./availability.types";
