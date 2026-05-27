import { randomUUID } from 'node:crypto';
import type { ExecutionPlan, PlanBuilderInput, ExecutionStep, ValidationResult } from './plan.types';
import { isCapabilitySlug } from '@panorama/capability';

export function buildExecutionPlan(input: PlanBuilderInput): ExecutionPlan {
  const steps: ExecutionStep[] = input.steps.map((s, i) => ({
    id: s.dependsOn ? `step-${i}` : `step-${i}`,
    capability: s.capability,
    action: s.action,
    chainId: s.chainId,
    payload: s.payload,
    dependsOn: s.dependsOn,
    status: 'pending',
  }));

  // Auto-assign step IDs if dependsOn references are by index
  for (let i = 0; i < steps.length; i++) {
    steps[i]!.id = `step-${i}`;
  }

  return {
    planId: randomUUID(),
    userAddress: input.userAddress,
    steps,
    createdAt: new Date().toISOString(),
    status: 'draft',
  };
}

export function validateExecutionPlan(plan: ExecutionPlan): ValidationResult {
  const errors: string[] = [];
  const stepIds = new Set(plan.steps.map((s) => s.id));

  if (plan.steps.length === 0) {
    errors.push('Plan must have at least one step');
  }

  for (const step of plan.steps) {
    if (!step.capability) errors.push(`Step ${step.id}: capability is required`);
    if (!step.action) errors.push(`Step ${step.id}: action is required`);
    if (!step.chainId || step.chainId <= 0) errors.push(`Step ${step.id}: valid chainId is required`);

    if (!isCapabilitySlug(step.capability)) {
      errors.push(`Step ${step.id}: unknown capability "${step.capability}"`);
    }

    for (const dep of step.dependsOn ?? []) {
      if (!stepIds.has(dep)) {
        errors.push(`Step ${step.id}: depends on unknown step "${dep}"`);
      }
    }
  }

  // Detect cycles
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function hasCycle(stepId: string): boolean {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    visiting.add(stepId);
    const step = plan.steps.find((s) => s.id === stepId);
    for (const dep of step?.dependsOn ?? []) {
      if (hasCycle(dep)) return true;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  }

  for (const step of plan.steps) {
    if (hasCycle(step.id)) {
      errors.push(`Circular dependency detected involving step "${step.id}"`);
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

export function topologicalOrder(plan: ExecutionPlan): ExecutionStep[] {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const stepMap = new Map<string, ExecutionStep>();

  for (const step of plan.steps) {
    stepMap.set(step.id, step);
    graph.set(step.id, []);
    inDegree.set(step.id, 0);
  }

  for (const step of plan.steps) {
    for (const dep of step.dependsOn ?? []) {
      graph.get(dep)?.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const ordered: ExecutionStep[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(stepMap.get(id)!);
    for (const next of graph.get(id) ?? []) {
      const newDegree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDegree);
      if (newDegree === 0) queue.push(next);
    }
  }

  return ordered;
}
