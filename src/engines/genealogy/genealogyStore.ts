// Persistence row layer for genealogy links (W3): the exact shape a link takes
// in the Dexie table (`genealogyLinks`, wired as schema v36 during integration)
// and the pure conversions/validation around it. Pure functions, no I/O, no
// mutation — the table itself lives in src/db/index.ts, which imports these
// helpers; keeping them pure lets the row contract be tested without a browser
// or an IndexedDB shim.
import type { GenealogyLink, GenealogyLinkKind } from './validate.ts';

/** Row stored in the Dexie `genealogyLinks` table (schema v37). */
export interface GenealogyLinkRow {
  /** Primary key: composite `projectId\0linkId` (Dexie cannot change the
   * primary key between versions, so the composite lives in `id` itself). */
  id: string;
  /** Original link id (what the contract calls the link's id). */
  linkId: string;
  projectId: string;
  from: string;
  to: string;
  kind: GenealogyLinkKind;
  label?: string;
}

/** Composite primary key for a link inside a project (NUL separator cannot
 * appear in ids, so the mapping is injective). */
export function genealogyLinkKey(projectId: string, linkId: string): string {
  return `${projectId}\u0000${linkId}`;
}

/**
 * Rewrite one v36 row (primary key `id` = link id) into the v37 shape
 * (primary key `id` = composite projectId+linkId, original id kept in
 * `linkId`). Pure: returns a new object, never mutates the input. Rows that
 * are not well-formed v36 rows are passed through unchanged so the upgrade
 * never throws on unexpected data.
 */
export function migrateGenealogyLinkV36toV37(row: Record<string, unknown>): Record<string, unknown> {
  const rawId = typeof row.id === 'string' ? row.id : '';
  const projectId = typeof row.projectId === 'string' ? row.projectId : '';
  if (projectId === '') return { ...row };
  // Recover the link id: an explicit linkId field wins; otherwise the id is
  // either a bare v36 link id or already a composite (a database that ran
  // v37 code without the upgrade completing — review r4 P1 idempotency).
  const linkId =
    typeof row.linkId === 'string' && row.linkId !== ''
      ? row.linkId
      : rawId.includes('\u0000')
        ? rawId.slice(rawId.indexOf('\u0000') + 1)
        : rawId;
  if (linkId === '') return { ...row };
  const composite = genealogyLinkKey(projectId, linkId);
  if (rawId === composite && typeof row.linkId === 'string') return { ...row }; // already v37
  return {
    ...row,
    id: composite,
    linkId,
  };
}

/** Issue codes mirror the contract's validator so callers can treat them alike. */
export interface GenealogyRowIssue {
  code: 'invalid_shape' | 'unknown_kind' | 'duplicate_id';
  id: string;
  detail: string;
}

export const GENEALOGY_LINK_ROW_KINDS: readonly GenealogyLinkKind[] = [
  'biological_parent',
  'adoptive_parent',
  'guardian',
  'partner',
] as const;

const KINDS = new Set<string>(GENEALOGY_LINK_ROW_KINDS);

/** Wrap a validated link as a project-scoped row. Does not mutate the link. */
export function linkToRow(projectId: string, link: GenealogyLink): GenealogyLinkRow {
  const row: GenealogyLinkRow = {
    id: genealogyLinkKey(projectId, link.id),
    linkId: link.id,
    projectId,
    from: link.from,
    to: link.to,
    kind: link.kind,
  };
  if (link.label !== undefined) row.label = link.label;
  return row;
}

/** Restore the contract's link shape from a stored row. Defensive against
 * legacy v36 rows (id = link id, no linkId field) so a row that escaped the
 * migration still reads back instead of yielding id: undefined (review r4). */
export function rowToLink(row: GenealogyLinkRow): GenealogyLink {
  const linkId =
    typeof row.linkId === 'string' && row.linkId !== ''
      ? row.linkId
      : typeof row.id === 'string' && row.id.includes('\u0000')
        ? row.id.slice(row.id.indexOf('\u0000') + 1)
        : row.id;
  const link: GenealogyLink = { id: linkId, from: row.from, to: row.to, kind: row.kind };
  if (row.label !== undefined) link.label = row.label;
  return link;
}

/**
 * Validate a batch of rows before a bulk write: shape, kind and duplicate ids.
 * Valid rows are returned in order so the caller can persist exactly them and
 * surface the issues; nothing is mutated.
 */
export function validateRows(
  rows: readonly GenealogyLinkRow[],
): { ok: GenealogyLinkRow[]; issues: GenealogyRowIssue[] } {
  const ok: GenealogyLinkRow[] = [];
  const issues: GenealogyRowIssue[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      typeof row?.id !== 'string' ||
      row.id === '' ||
      typeof row?.projectId !== 'string' ||
      row.projectId === '' ||
      typeof row?.from !== 'string' ||
      row.from === '' ||
      typeof row?.to !== 'string' ||
      row.to === ''
    ) {
      issues.push({
        code: 'invalid_shape',
        id: typeof row?.id === 'string' ? row.id : '',
        detail: 'row must carry non-empty id, projectId, from and to',
      });
      continue;
    }
    if (!KINDS.has(row.kind)) {
      issues.push({
        code: 'unknown_kind',
        id: row.id,
        detail: `kind '${String(row.kind)}' is not a genealogy link kind`,
      });
      continue;
    }
    // v37: rows are keyed by the composite projectId+linkId, so the real
    // duplicate within a batch is a repeated linkId, not a repeated row id.
    const linkId = typeof row.linkId === 'string' && row.linkId !== '' ? row.linkId : row.id;
    if (seen.has(linkId)) {
      issues.push({
        code: 'duplicate_id',
        id: linkId,
        detail: `duplicate id '${linkId}' in the batch`,
      });
      continue;
    }
    seen.add(linkId);
    ok.push(row);
  }
  return { ok, issues };
}

/**
 * Reserve the explicit ids of a batch (and the ids already taken by the
 * existing state) BEFORE deriving g1..gN for the entries without id, so a
 * derived id can never collide with an explicit id later in the same batch
 * (review r3). Returns the ids in input order: explicit ids pass through,
 * empty/missing ids get the next free gN.
 */
export function deriveLinkIds(
  entries: ReadonlyArray<Record<string, unknown>>,
  existingIds: ReadonlySet<string>,
): string[] {
  const taken = new Set(existingIds);
  for (const e of entries) {
    // Guard against null/non-object entries (review r4 P2: a batch like
    // [null, valid] must not dereference e.id before validation).
    if (e === null || typeof e !== 'object') continue;
    if (typeof e.id === 'string' && e.id !== '') taken.add(e.id);
  }
  const ids: string[] = [];
  let next = 1;
  for (const e of entries) {
    if (e !== null && typeof e === 'object' && typeof e.id === 'string' && e.id !== '') {
      ids.push(e.id);
    } else {
      while (taken.has(`g${next}`)) next++;
      const id = `g${next}`;
      next++;
      taken.add(id);
      ids.push(id);
    }
  }
  return ids;
}
