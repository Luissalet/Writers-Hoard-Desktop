import { useEffect, useState, useCallback } from 'react';
import { makeEntityHook } from '@/engines/_shared';
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
export function useAllPayoffs(projectId: string) {
  const [items, setItems] = useState<Payoff[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const rows = await ops.getAllPayoffsForProject(projectId);
    setItems(rows);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, refresh };
}
