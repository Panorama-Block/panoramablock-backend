import type { Transaction, ChainId, Address } from '@panorama/capability';

export type StepStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';

export interface ExecutionStep {
  id: string;
  capability: string;
  action: string;
  chainId: ChainId;
  payload: Record<string, unknown>;
  dependsOn?: string[];
  transactions?: Transaction[];
  status: StepStatus;
  error?: string;
}

export interface ExecutionPlan {
  planId: string;
  userAddress: Address;
  steps: ExecutionStep[];
  createdAt: string;
  status: 'draft' | 'validated' | 'executing' | 'completed' | 'failed';
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PlanBuilderInput {
  userAddress: Address;
  steps: Array<{
    capability: string;
    action: string;
    chainId: ChainId;
    payload: Record<string, unknown>;
    dependsOn?: string[];
  }>;
}
