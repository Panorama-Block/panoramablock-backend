/**
 * Public re-exports for the chains sub-module.
 *
 * Consumers import from `@panorama/capability/chains` for chain manifests + lookup helpers.
 * The chains module is independent from the registry — it just describes which networks the
 * system knows about and what capabilities each chain claims to support.
 */

export {
  loadChains,
  getChain,
  tryGetChain,
  listChains,
  listKnownChains,
  validateChainManifest,
  _resetChainsCache,
  type ChainManifest,
  type ChainNativeAsset,
  type LoadChainsOptions,
} from "./chain.types";
