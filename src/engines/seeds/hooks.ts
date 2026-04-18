import { makeEntityHook, makeReadOnlyHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Seed, Payoff } from './types';

export const useSeeds = makeEntityHook<Seed>({
  fetchFn: ops.getSeeds,
  createFn: ops.createSeed,
  updateFn: ops.updateSeed,
  deleteFn: ops.deleteSeed,
});

export const usePayoffs = makeEntityHook<Payoff>({
  fetchFn: ops.getPayoffs,
  createFn: ops.createPayoff,
  updateFn: ops.updatePayoff,
  deleteFn: ops.deletePayoff,
});

/**
 * Convenience hook — all payoffs for the project, across every seed.
 * Useful for the dashboard totals/timeline.
 */
export const useAllPayoffs = makeReadOnlyHook<Payoff>({
  fetchFn: ops.getAllPayoffsForProject,
});
