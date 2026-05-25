/**
 * DI Container — wires the automation capability for the dca-service.
 *
 * Single source of truth for object creation. Import `container` singleton
 * everywhere you need a service; do not instantiate services directly in route files.
 */

import { ProviderRegistry, ChainAssetPriorityPolicy } from '@panorama/capability';
import { ERC4337DCAAdapter } from '../adapters/erc4337.dca.adapter';
import { DCACapabilityService } from '../../application/services/dca.capability.service';
import type { IDCAProvider } from '../../domain/ports/dca.provider.port';

export class DCAContainer {
  private static _instance: DCAContainer;

  readonly provider: ERC4337DCAAdapter;
  readonly registry: ProviderRegistry<IDCAProvider>;
  readonly policy: ChainAssetPriorityPolicy;
  readonly capabilityService: DCACapabilityService;

  private constructor() {
    this.provider = new ERC4337DCAAdapter();

    this.registry = new ProviderRegistry<IDCAProvider>();
    this.registry.register(this.provider);

    this.policy = new ChainAssetPriorityPolicy({
      '1':     ['erc4337-dca'],
      '137':   ['erc4337-dca'],
      '42161': ['erc4337-dca'],
      '10':    ['erc4337-dca'],
      '8453':  ['erc4337-dca'],
    });

    this.capabilityService = new DCACapabilityService({
      registry: this.registry,
      policy: this.policy,
    });
  }

  static getInstance(): DCAContainer {
    if (!DCAContainer._instance) {
      DCAContainer._instance = new DCAContainer();
    }
    return DCAContainer._instance;
  }
}

export const container = DCAContainer.getInstance();
