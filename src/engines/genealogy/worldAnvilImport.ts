// ============================================================================
// Genealogy World Anvil importer — W6, fourth importer.
//
// Parses a World Anvil-style Markdown export into a genealogy PROPOSAL
// (links only, no persistence): the same shape `validateGenealogy` consumes.
// The accepted shape is one `# Name (id)` heading per person, with family
// field bullets under it:
//
//   # Alice (a1)
//   - Parents: Bob (b1), Clara (c1)
//   - Children: Dora (d1)
//   - Spouses: Elin (e1) : married 1901
//
// Direction follows the field: Parents/Adoptive Parents/Guardians point FROM
// the named person TO the heading person (they are the parents); Children
// point FROM the heading person TO the named one; Spouses/Partners are
// partner links from the heading person. Field-to-kind mapping:
//   Parents -> biological_parent, Adoptive Parents -> adoptive_parent,
//   Guardians -> guardian, Children -> biological_parent,
//   Spouses/Partners -> partner. Unknown fields are per-line issues.
// Everything else mirrors the other importers: per-line issues with line
// numbers, derived link ids (`g1`, `g2`, …) unless explicit (fourth colon
// field), duplicate ids rejected, pure function with no I/O.
// ============================================================================

import type { GenealogyImportIssue, GenealogyImportResult } from './markdownImport.ts';

/** Field name (lowercased) -> [kind, direction]; direction is who is `from`. */
const FIELDS: Record<string, [string, 'field' | 'heading']> = {
  'parents': ['biological_parent', 'field'],
  'adoptive parents': ['adoptive_parent', 'field'],
  'guardians': ['guardian', 'field'],
  'children': ['biological_parent', 'heading'],
  'spouses': ['partner', 'heading'],
  'partners': ['partner', 'heading'],
};

/** Splits `Name (id)` into [name, id?] — the id is the last parenthesised group. */
function nameAndId(text: string): [string, string | undefined] {
  const m = text.match(/^(.*?)\s*\(([^()]*)\)$/);
  if (!m) return [text.trim(), undefined];
  const id = m[2].trim();
  return [m[1].trim(), id === '' ? undefined : id];
}

export function importGenealogyWorldAnvil(markdown: unknown): GenealogyImportResult {
  const issues: GenealogyImportIssue[] = [];
  const links: GenealogyImportResult['links'] = [];

  if (typeof markdown !== 'string') {
    return { links: [], issues: [{ code: 'invalid_line', detail: 'input must be a string' }] };
  }

  const lines = markdown.split(/\r\n|\r|\n/);
  const seen = new Set<string>();
  let current: { id: string } | null = null;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;

    if (line.startsWith('#')) {
      const heading = line.replace(/^#+\s*/, '');
      const [name, id] = nameAndId(heading);
      const nodeId = id ?? name;
      current = nodeId === '' ? null : { id: nodeId };
      if (current === null) {
        issues.push({ code: 'invalid_line', detail: 'heading must name a person', line: index + 1 });
      }
      return;
    }

    if (!line.startsWith('-')) {
      issues.push({ code: 'invalid_line', detail: `expected a "- " list item`, line: index + 1 });
      return;
    }
    if (current === null) {
      issues.push({ code: 'invalid_line', detail: 'field bullet before any person heading', line: index + 1 });
      return;
    }

    const body = line.slice(1).trim();
    const parts = body.split(':').map((p) => p.trim());
    const field = (parts[0] ?? '').toLowerCase();
    const mapping = FIELDS[field];
    if (!mapping) {
      issues.push({
        code: 'unknown_kind',
        detail: `unknown family field "${parts[0]}" (expected Parents, Adoptive Parents, Guardians, Children, Spouses or Partners)`,
        line: index + 1,
      });
      return;
    }
    const [kind, direction] = mapping;
    const targets = (parts[1] ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    if (targets.length === 0) {
      issues.push({ code: 'invalid_line', detail: `missing name after "${parts[0]}:"`, line: index + 1 });
      return;
    }
    const label = parts.length > 2 && parts[2] !== '' ? parts[2] : undefined;

    for (const target of targets) {
      const [toName, toId] = nameAndId(target);
      const nodeId = toId ?? toName;
      if (nodeId === '') {
        issues.push({ code: 'invalid_line', detail: 'name must be non-empty', line: index + 1 });
        continue;
      }
      const from = direction === 'field' ? nodeId : current.id;
      const to = direction === 'field' ? current.id : nodeId;
      const explicitId = parts.length > 3 && parts[3] !== '' ? parts[3] : `g${links.length + 1}`;
      if (seen.has(explicitId)) {
        issues.push({ code: 'duplicate_id', detail: `duplicate link id: ${explicitId}`, line: index + 1 });
        continue;
      }
      seen.add(explicitId);

      const link: GenealogyImportResult['links'][number] = { id: explicitId, from, to, kind };
      if (label !== undefined) link.label = label;
      links.push(link);
    }
  });

  if (links.length === 0 && issues.length === 0) {
    issues.push({ code: 'no_links', detail: 'no family field lines found' });
  }

  return { links, issues };
}
