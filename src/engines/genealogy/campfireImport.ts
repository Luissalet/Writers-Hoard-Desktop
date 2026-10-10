// ============================================================================
// Genealogy Campfire importer — W6, fifth importer.
//
// Parses a Campfire-style JSON export into a genealogy PROPOSAL (links only,
// no persistence): the same shape `validateGenealogy` consumes. The accepted
// shape is an object with a `relationships` array; each entry is
//
//   { "from": "a1", "to": "b1", "type": "parent", "label": "…", "id": "…" }
//
// where `from`/`to` are character ids and `type` maps to the contract kinds:
//   parent -> biological_parent, adoptive -> adoptive_parent,
//   guardian -> guardian, partner/spouse -> partner.
// Unknown types, missing ids and non-object entries are per-item issues;
// the rest of the batch still imports. Everything else mirrors the other
// importers: derived link ids (`g1`, `g2`, …) unless explicit, duplicate ids
// rejected, pure function with no I/O (the input is never mutated).
// ============================================================================

import type { GenealogyImportIssue, GenealogyImportResult } from './markdownImport.ts';

/** Campfire relationship type (lowercased) -> contract kind. */
const TYPES: Record<string, string> = {
  'parent': 'biological_parent',
  'adoptive': 'adoptive_parent',
  'guardian': 'guardian',
  'partner': 'partner',
  'spouse': 'partner',
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function importGenealogyCampfire(data: unknown): GenealogyImportResult {
  const issues: GenealogyImportIssue[] = [];
  const links: GenealogyImportResult['links'] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { links: [], issues: [{ code: 'invalid_line', detail: 'input must be a JSON object' }] };
  }

  const relationships = (data as { relationships?: unknown }).relationships;
  if (relationships === undefined) {
    return { links: [], issues: [{ code: 'no_links', detail: 'no relationships array found' }] };
  }
  if (!Array.isArray(relationships)) {
    return { links: [], issues: [{ code: 'invalid_line', detail: 'relationships must be an array' }] };
  }

  const seen = new Set<string>();
  relationships.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      issues.push({ code: 'invalid_line', detail: `relationship #${index + 1} must be an object` });
      return;
    }
    const rel = entry as Record<string, unknown>;
    const from = rel.from;
    const to = rel.to;
    if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
      issues.push({
        code: 'invalid_line',
        detail: `relationship #${index + 1} needs non-empty "from" and "to" ids`,
      });
      return;
    }
    const type = isNonEmptyString(rel.type) ? rel.type.toLowerCase() : '';
    const kind = TYPES[type];
    if (!kind) {
      issues.push({
        code: 'unknown_kind',
        detail: `unknown relationship type "${rel.type}" (expected parent, adoptive, guardian, partner or spouse)`,
      });
      return;
    }

    const explicitId = isNonEmptyString(rel.id) ? (rel.id as string).trim() : `g${links.length + 1}`;
    if (seen.has(explicitId)) {
      issues.push({ code: 'duplicate_id', detail: `duplicate link id: ${explicitId}` });
      return;
    }
    seen.add(explicitId);

    const link: GenealogyImportResult['links'][number] = { id: explicitId, from, to, kind };
    if (isNonEmptyString(rel.label)) link.label = (rel.label as string).trim();
    links.push(link);
  });

  if (links.length === 0 && issues.length === 0) {
    issues.push({ code: 'no_links', detail: 'no relationships found' });
  }

  return { links, issues };
}
