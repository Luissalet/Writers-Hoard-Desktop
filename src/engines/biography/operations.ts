import { makeTableOps, reorderItems } from '@/engines/_shared';
import { db } from '@/db';
import type { Biography, BiographyFact } from './types';

// ===== Biographies =====
const bioOps = makeTableOps<Biography>({
  tableName: 'biographies',
  scopeField: 'projectId',
});

export const getBiographies = bioOps.getAll;
export const getBiography = bioOps.getOne;
export const createBiography = bioOps.create;
export const updateBiography = bioOps.update;

// deleteBiography cascades to facts
export async function deleteBiography(id: string): Promise<void> {
  await db.transaction('rw', [db.table('biographies'), db.table('biographyFacts')], async () => {
    await db.table('biographies').delete(id);
    await db.table('biographyFacts').where('biographyId').equals(id).delete();
  });
}

// ===== Biography Facts =====
const factOps = makeTableOps<BiographyFact>({
  tableName: 'biographyFacts',
  scopeField: 'biographyId',
  sortFn: (a, b) => a.order - b.order,
});

export const getFacts = factOps.getAll;
export const getFact = factOps.getOne;
export const createFact = factOps.create;
export const updateFact = factOps.update;
export const deleteFact = factOps.delete;

export async function reorderFacts(biographyId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('biographyFacts', 'biographyId', biographyId, orderedIds);
}
