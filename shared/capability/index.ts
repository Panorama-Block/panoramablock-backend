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

// Registry: generic container that holds providers per capability.
export { ProviderRegistry } from "./registry";
export type {
  RegistryListFilter,
  RegistryEvent,
  RegistryListener,
  ListByChainOptions,
  HealthOracle,
} from "./registry.types";

// Registry config loader: instantiate providers from a JSON config + a factory.
export {
  loadProvidersFromConfig,
  type ProviderConfigEntry,
  type ProviderConfigFile,
  type ProviderFactory,
  type LoaderOptions,
  type LoaderResult,
} from "./registry.loader";

// Priority policy + the iterate/fallback helper used by every capability facade.
export {
  ChainAssetPriorityPolicy,
  fallbackInvoke,
  type IPriorityPolicy,
  type PolicyContext,
  type ChainAssetPriorityConfig,
  type ChainPriorityEntry,
  type PerChainAssetMap,
  type PerChainList,
  type FallbackInvokeInput,
  type FallbackInvokeOutcome,
  type FallbackInvokeSuccess,
  type FallbackInvokeFailure,
  type FallbackAttempt,
} from "./policy";

// Provider limitations + applyLimitations check.
export {
  applyLimitations,
  compareDecimalStrings,
  type ProviderLimitations,
  type LimitationCheckInput,
  type LimitationResult,
} from "./provider-limitations";

// Health tracker: periodic probes + HealthOracle implementation.
export {
  ProviderHealthTracker,
  type ProviderHealthTrackerOptions,
  type ProviderHealthReport,
  type HealthScheduler,
  type HealthSchedulerHandle,
} from "./health";

// Discovery handler factory — framework-agnostic.
export {
  createDiscoveryHandler,
  type DiscoveryHandler,
  type DiscoveryHandlerDeps,
  type DiscoveryHandlerInput,
  type DiscoveryHandlerOutput,
} from "./http/discovery.handler";
