import { db } from '@/db';
import { makeTableOps, reorderItems, makeCascadeDeleteOp, deleteEntityAnnotations } from '@/engines/_shared';
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
const deleteBiographyRow = makeCascadeDeleteOp({
  tableName: 'biographies',
  cascades: [{ table: 'biographyFacts', foreignKey: 'biographyId' }],
});

// ...and to the margin notes anchored on the biography, which are pure link.
export async function deleteBiography(id: string): Promise<void> {
  await db.transaction(
    'rw',
    ['biographies', 'biographyFacts', 'annotations', 'annotationReferences'],
    async () => {
      await deleteEntityAnnotations('biography', id);
      await deleteBiographyRow(id);
    },
  );
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
