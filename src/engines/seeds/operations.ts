import { makeTableOps, makeCascadeDeleteOp } from '@/engines/_shared';
import type { Seed, Payoff } from './types';

// ===== Seeds =====
const seedOps = makeTableOps<Seed>({
  tableName: 'seeds',
  scopeField: 'projectId',
  sortFn: (a, b) => (a.plantedAt ?? 0) - (b.plantedAt ?? 0),
});

export const getSeeds = seedOps.getAll;
export const getSeed = seedOps.getOne;
export const createSeed = seedOps.create;
export const updateSeed = seedOps.update;

// deleteSeed cascades to payoffs (a payoff can't exist without its seed)
export const deleteSeed = makeCascadeDeleteOp({
  tableName: 'seeds',
  cascades: [{ table: 'payoffs', foreignKey: 'seedId' }],
});

// ===== Payoffs =====
const payoffOps = makeTableOps<Payoff>({
  tableName: 'payoffs',
  scopeField: 'seedId',
  sortFn: (a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0),
});

export const getPayoffs = payoffOps.getAll;
export const getPayoff = payoffOps.getOne;
export const createPayoff = payoffOps.create;
export const updatePayoff = payoffOps.update;
export const deletePayoff = payoffOps.delete;

// All payoffs across a project (used for the dashboard/timeline view)
export async function getAllPayoffsForProject(projectId: string): Promise<Payoff[]> {
  const { db } = await import('@/db');
  return db.payoffs.where('projectId').equals(projectId).toArray();
}
