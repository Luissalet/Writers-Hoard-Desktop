import type { GenealogyLink } from './validate.ts';
import { ANCESTRY_KINDS, NON_ANCESTRY_KINDS } from './validate.ts';

/**
 * Minimal structural surface of a Dexie Table that this repository touches.
 * Declared structurally (instead of importing Dexie) so the module stays
 * testable without IndexedDB: any object with these methods works, including
 * the real `db.genealogyLinks` table once the v36 schema lands.
 */
export interface GenealogyTableLike {
  where(index: string): { equals(value: string): { toArray(): Promise<unknown[]> } };
  bulkPut(rows: unknown[]): Promise<number>;
  get(id: string): Promise<unknown>;
  delete(id: string): Promise<void>;
}

export interface GenealogySaveReceipt {
  saved: number;
  issues: Array<{ code: string; index?: number; id?: string; message: string }>;
}

const VALID_KINDS: ReadonlySet<string> = new Set([...ANCESTRY_KINDS, ...NON_ANCESTRY_KINDS]);

const STORAGE_FIELDS = ['updatedAt'] as const;

function stripStorageFields(row: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...row };
  for (const field of STORAGE_FIELDS) delete clean[field];
  return clean;
}

/**
 * Storage-level validation, deliberately narrower than validateGenealogy:
 * referential integrity (missing_ref) belongs to the engine, because the
 * characters a link points at live in another table and may be imported in
 * any order. Here only the row itself must be sound: plain object with
 * non-empty string id/from/to and a known kind.
 */
function storageIssues(link: unknown, index: number): Array<{ code: string; index: number; id?: string; message: string }> {
  const issues: Array<{ code: string; index: number; id?: string; message: string }> = [];
  const idOf =
    typeof link === 'object' && link !== null && typeof (link as Record<string, unknown>).id === 'string'
      ? (link as Record<string, unknown>).id as string
      : undefined;

  if (typeof link !== 'object' || link === null) {
    return [{ code: 'invalid_shape', index, id: idOf, message: 'link is not an object' }];
  }
  const rec = link as Record<string, unknown>;
  for (const field of ['id', 'from', 'to', 'kind'] as const) {
    if (typeof rec[field] !== 'string' || (rec[field] as string).length === 0) {
      issues.push({ code: 'invalid_shape', index, id: idOf, message: `field ${field} must be a non-empty string` });
    }
  }
  if (typeof rec.kind === 'string' && !VALID_KINDS.has(rec.kind)) {
    issues.push({ code: 'unknown_kind', index, id: idOf, message: `unknown genealogy kind: ${rec.kind}` });
  }
  if (rec.from === rec.to && typeof rec.from === 'string') {
    issues.push({ code: 'self_link', index, id: idOf, message: `link ${idOf} connects ${rec.from} to itself` });
  }
  return issues;
}

/**
 * Load every genealogy link of one project. Rows come back in the plain link
 * shape (storage-only fields removed), so callers never see the Dexie row.
 */
export async function loadGenealogyLinks(
  table: GenealogyTableLike,
  projectId: string,
): Promise<GenealogyLink[]> {
  const rows = await table.where('projectId').equals(projectId).toArray();
  return rows.map((row) => stripStorageFields(row as Record<string, unknown>) as unknown as GenealogyLink);
}

/**
 * Validate a batch and persist it in one go. The batch is all-or-nothing: if
 * any link fails validation or repeats an id, nothing is written and the
 * issues come back in the receipt. Rows are stamped with the owning project
 * and an updatedAt timestamp for future conflict handling.
 */
export async function saveGenealogyLinks(
  table: GenealogyTableLike,
  projectId: string,
  links: readonly unknown[],
): Promise<GenealogySaveReceipt> {
  const issues: GenealogySaveReceipt['issues'] = [];
  const seen = new Set<string>();

  links.forEach((link, index) => {
    issues.push(...storageIssues(link, index));
    if (typeof link === 'object' && link !== null && typeof (link as Record<string, unknown>).id === 'string') {
      const id = (link as Record<string, unknown>).id as string;
      if (seen.has(id)) {
        issues.push({ code: 'duplicate_id', index, id, message: `id ${id} repeated in batch` });
      }
      seen.add(id);
    }
  });

  if (issues.length > 0) return { saved: 0, issues };

  const now = new Date().toISOString();
  // Primary key is the composite projectId+id: two projects may hold links
  // with the same id without overwriting each other (review r2, P1).
  const rows = links.map((link) => ({
    ...(link as Record<string, unknown>),
    key: `${projectId}\u0000${(link as Record<string, unknown>).id as string}`,
    projectId,
    updatedAt: now,
  }));
  await table.bulkPut(rows);
  return { saved: rows.length, issues: [] };
}

/**
 * Delete one link, but only if it belongs to the given project: a wrong
 * projectId must never remove another project's row. Returns whether a row
 * was actually deleted.
 */
export async function deleteGenealogyLink(
  table: GenealogyTableLike,
  projectId: string,
  id: string,
): Promise<boolean> {
  const row = (await table.get(`${projectId}\u0000${id}`)) as Record<string, unknown> | undefined;
  if (!row || row.projectId !== projectId) return false;
  await table.delete(`${projectId}\u0000${id}`);
  return true;
}
