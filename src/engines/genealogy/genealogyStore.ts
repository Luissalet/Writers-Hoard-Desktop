// Persistence row layer for genealogy links (W3): the exact shape a link takes
// in the Dexie table (`genealogyLinks`, wired as schema v36 during integration)
// and the pure conversions/validation around it. Pure functions, no I/O, no
// mutation — the table itself lives in src/db/index.ts, which imports these
// helpers; keeping them pure lets the row contract be tested without a browser
// or an IndexedDB shim.
import type { GenealogyLink, GenealogyLinkKind } from './validate.ts';

/** Row stored in the Dexie `genealogyLinks` table (schema v36). */
export interface GenealogyLinkRow {
  id: string;
  projectId: string;
  from: string;
  to: string;
  kind: GenealogyLinkKind;
  label?: string;
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
    id: link.id,
    projectId,
    from: link.from,
    to: link.to,
    kind: link.kind,
  };
  if (link.label !== undefined) row.label = link.label;
  return row;
}

/** Restore the contract's link shape from a stored row. */
export function rowToLink(row: GenealogyLinkRow): GenealogyLink {
  const link: GenealogyLink = { id: row.id, from: row.from, to: row.to, kind: row.kind };
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
    if (seen.has(row.id)) {
      issues.push({
        code: 'duplicate_id',
        id: row.id,
        detail: `duplicate id '${row.id}' in the batch`,
      });
      continue;
    }
    seen.add(row.id);
    ok.push(row);
  }
  return { ok, issues };
}
