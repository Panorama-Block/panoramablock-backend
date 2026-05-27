import { describe, it, expect } from 'vitest';
import { buildExecutionPlan, validateExecutionPlan, topologicalOrder } from '../plan-builder';
import type { PlanBuilderInput } from '../plan.types';

const USER = '0x1234567890123456789012345678901234567890';

function input(steps: PlanBuilderInput['steps']): PlanBuilderInput {
  return { userAddress: USER, steps };
}

describe('buildExecutionPlan', () => {
  it('creates a plan with sequential IDs', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'prepare-swap', chainId: 8453, payload: {} },
      { capability: 'staking', action: 'prepare-stake', chainId: 1, payload: {} },
    ]));
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.id).toBe('step-0');
    expect(plan.steps[1]!.id).toBe('step-1');
    expect(plan.status).toBe('draft');
    expect(plan.userAddress).toBe(USER);
  });

  it('preserves dependency references', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'prepare-swap', chainId: 8453, payload: {} },
      { capability: 'liquidity', action: 'prepare-add', chainId: 8453, payload: {}, dependsOn: ['step-0'] },
    ]));
    expect(plan.steps[1]!.dependsOn).toEqual(['step-0']);
  });
});

describe('validateExecutionPlan', () => {
  it('accepts valid plan', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'prepare-swap', chainId: 8453, payload: {} },
    ]));
    expect(validateExecutionPlan(plan).valid).toBe(true);
  });

  it('rejects empty plan', () => {
    const plan = buildExecutionPlan(input([]));
    const r = validateExecutionPlan(plan);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Plan must have at least one step');
  });

  it('rejects unknown capability', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'derivatives' as any, action: 'open', chainId: 8453, payload: {} },
    ]));
    const r = validateExecutionPlan(plan);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('unknown capability'))).toBe(true);
  });

  it('rejects broken dependency reference', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'quote', chainId: 8453, payload: {}, dependsOn: ['step-99'] },
    ]));
    const r = validateExecutionPlan(plan);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('unknown step'))).toBe(true);
  });

  it('detects circular dependencies', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'a', chainId: 8453, payload: {}, dependsOn: ['step-1'] },
      { capability: 'swap', action: 'b', chainId: 8453, payload: {}, dependsOn: ['step-0'] },
    ]));
    const r = validateExecutionPlan(plan);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('Circular'))).toBe(true);
  });
});

describe('topologicalOrder', () => {
  it('orders independent steps in original order', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'a', chainId: 8453, payload: {} },
      { capability: 'staking', action: 'b', chainId: 1, payload: {} },
    ]));
    const ordered = topologicalOrder(plan);
    expect(ordered.map((s) => s.id)).toEqual(['step-0', 'step-1']);
  });

  it('puts dependencies before dependents', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'prepare-swap', chainId: 8453, payload: {} },
      { capability: 'liquidity', action: 'prepare-add', chainId: 8453, payload: {}, dependsOn: ['step-0'] },
      { capability: 'staking', action: 'prepare-stake', chainId: 1, payload: {} },
    ]));
    const ordered = topologicalOrder(plan);
    const swapIdx = ordered.findIndex((s) => s.id === 'step-0');
    const liqIdx = ordered.findIndex((s) => s.id === 'step-1');
    expect(swapIdx).toBeLessThan(liqIdx);
  });

  it('handles diamond dependencies', () => {
    const plan = buildExecutionPlan(input([
      { capability: 'swap', action: 'a', chainId: 8453, payload: {} },
      { capability: 'swap', action: 'b', chainId: 8453, payload: {}, dependsOn: ['step-0'] },
      { capability: 'swap', action: 'c', chainId: 8453, payload: {}, dependsOn: ['step-0'] },
      { capability: 'swap', action: 'd', chainId: 8453, payload: {}, dependsOn: ['step-1', 'step-2'] },
    ]));
    const ordered = topologicalOrder(plan);
    expect(ordered).toHaveLength(4);
    const ids = ordered.map((s) => s.id);
    expect(ids.indexOf('step-0')).toBeLessThan(ids.indexOf('step-1'));
    expect(ids.indexOf('step-0')).toBeLessThan(ids.indexOf('step-2'));
    expect(ids.indexOf('step-1')).toBeLessThan(ids.indexOf('step-3'));
    expect(ids.indexOf('step-2')).toBeLessThan(ids.indexOf('step-3'));
  });
});
