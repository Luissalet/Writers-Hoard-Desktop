// ============================================================================
// Genealogy id-space mapping — local character ids <-> world/1 hoard refs.
//
// This closes the gap the sidecar module declares as pending: sidecar links
// carry LOCAL character ids ('A', 'c1', …) while a world/1 document references
// the same characters as `hoard://writer/codex/<id>` (see
// src/services/familyBridge/worldSchema.ts, refCodex). The two spaces are
// reconciled HERE, explicitly and by an id table the caller supplies — never
// by guessing from names.
//
// Rules (mirroring the contract's identity rule):
//   - Mapping is by EXACT id only. Names, aliases or any other field never
//     merge two ids.
//   - A link whose endpoints are not in the table is REJECTED with the link
//     id in the issue; it is never silently dropped or coerced.
//   - Duplicate link ids in the input are rejected (duplicate_id), matching
//     the validator's rule.
//   - Inputs are never mutated.
//
// Pure functions only: no I/O, no mutation of the inputs.
// ============================================================================

import type { GenealogyLink } from './validate.ts';

export interface GenealogyIdIssue {
  code: 'invalid_shape' | 'duplicate_id' | 'missing_ref';
  detail: string;
  /** Link id when the issue is about a specific link. */
  linkId?: string;
}

export interface GenealogyIdMapResult {
  /** Links with endpoints rewritten to world/1 hoard refs. */
  toWorld: Array<{
    id: string;
    from: string;
    to: string;
    kind: string;
    label?: string;
  }>;
  /** Links with hoard refs rewritten back to local ids. */
  toLocal: Array<{
    id: string;
    from: string;
    to: string;
    kind: string;
    label?: string;
  }>;
  issues: GenealogyIdIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Map sidecar links (LOCAL ids) to world/1 form (hoard refs), or the reverse.
 *
 * `idTable` maps local id -> world ref (e.g. { A: 'hoard://writer/codex/c1' }).
 * `direction` selects the rewrite: 'toWorld' uses the table as-is; 'toLocal'
 * inverts it. A link endpoint missing from the (inverted) table is reported
 * as missing_ref with the link id — never guessed.
 */
export function mapGenealogyIds(
  links: unknown,
  idTable: Readonly<Record<string, string>>,
  direction: 'toWorld' | 'toLocal',
): GenealogyIdMapResult {
  const issues: GenealogyIdIssue[] = [];

  if (!isPlainObject(idTable)) {
    return { toWorld: [], toLocal: [], issues: [{ code: 'invalid_shape', detail: 'idTable must be an object' }] };
  }
  for (const [local, ref] of Object.entries(idTable)) {
    if (!isNonEmptyString(local) || !isNonEmptyString(ref)) {
      return {
        toWorld: [],
        toLocal: [],
        issues: [{ code: 'invalid_shape', detail: 'idTable entries must be non-empty strings' }],
      };
    }
  }

  const table: Record<string, string> = { ...idTable };
  if (direction === 'toLocal') {
    const inverted: Record<string, string> = {};
    for (const [local, ref] of Object.entries(table)) {
      if (ref in inverted) {
        return {
          toWorld: [],
          toLocal: [],
          issues: [{
            code: 'invalid_shape',
            detail: `idTable has two local ids for the same world ref: ${ref}`,
          }],
        };
      }
      inverted[ref] = local;
    }
    for (const key of Object.keys(table)) delete table[key];
    Object.assign(table, inverted);
  }

  if (!Array.isArray(links)) {
    return { toWorld: [], toLocal: [], issues: [{ code: 'invalid_shape', detail: 'links must be an array' }] };
  }

  const seen = new Set<string>();
  const out: GenealogyIdMapResult['toWorld'] = [];
  links.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push({ code: 'invalid_shape', detail: `links[${index}] is not an object` });
      return;
    }
    const { id, from, to, kind, label } = entry as Record<string, unknown>;
    if (!isNonEmptyString(id) || !isNonEmptyString(from) || !isNonEmptyString(to) || !isNonEmptyString(kind)) {
      issues.push({ code: 'invalid_shape', detail: `links[${index}] must carry non-empty string id/from/to/kind` });
      return;
    }
    if (label !== undefined && typeof label !== 'string') {
      issues.push({ code: 'invalid_shape', detail: `links[${index}].label must be a string when present` });
      return;
    }
    if (seen.has(id)) {
      issues.push({ code: 'duplicate_id', detail: `duplicate link id: ${id}`, linkId: id });
      return;
    }
    seen.add(id);

    const mappedFrom = table[from];
    const mappedTo = table[to];
    if (mappedFrom === undefined || mappedTo === undefined) {
      const missing = mappedFrom === undefined ? from : to;
      issues.push({ code: 'missing_ref', detail: `no id-table entry for ${missing}`, linkId: id });
      return;
    }

    const mapped: GenealogyIdMapResult['toWorld'][number] = { id, from: mappedFrom, to: mappedTo, kind };
    if (label !== undefined) mapped.label = label;
    out.push(mapped);
  });

  return { toWorld: direction === 'toWorld' ? out : [], toLocal: direction === 'toLocal' ? out : [], issues };
}
