// ============================================================================
// Genealogy Notion importer — W6, third importer.
//
// Parses a Notion-style Markdown export into a genealogy PROPOSAL (links
// only, no persistence): the same shape `validateGenealogy` consumes. The
// accepted shape is one `## Name (id)` heading per person, with relationship
// bullets under it:
//
//   ## Alice (a1)
//   - biological_parent: Bob (b1)
//   - partner: Clara (c1), Dora : married 1901
//
// The heading is the source person; the optional `(id)` after the name is
// the node id (a bare name uses the name itself). Each bullet is
// `kind: target[, target2…]` with the kind accepted verbatim; a target may
// carry its own `(id)`. A second `:` is the label. Everything else mirrors
// the other importers: per-line issues with line numbers, derived link ids
// (`g1`, `g2`, …) unless explicit, duplicate ids rejected, pure function
// with no I/O.
// ============================================================================

import type { GenealogyImportIssue, GenealogyImportResult } from './markdownImport.ts';

const KINDS = new Set(['biological_parent', 'adoptive_parent', 'guardian', 'partner']);

/** Splits `Name (id)` into [name, id?] — the id is the last parenthesised group. */
function nameAndId(text: string): [string, string | undefined] {
  const m = text.match(/^(.*?)\s*\(([^()]*)\)$/);
  if (!m) return [text.trim(), undefined];
  const id = m[2].trim();
  return [m[1].trim(), id === '' ? undefined : id];
}

export function importGenealogyNotion(markdown: unknown): GenealogyImportResult {
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
      issues.push({ code: 'invalid_line', detail: 'bullet before any person heading', line: index + 1 });
      return;
    }

    const body = line.slice(1).trim();
    const parts = body.split(':').map((p) => p.trim());
    const kind = parts[0] ?? '';
    const targets = (parts[1] ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    const label = parts.length > 2 && parts[2] !== '' ? parts[2] : undefined;

    if (!KINDS.has(kind)) {
      issues.push({
        code: 'unknown_kind',
        detail: `unknown kind "${kind}" (expected biological_parent, adoptive_parent, guardian or partner)`,
        line: index + 1,
      });
      return;
    }
    if (targets.length === 0) {
      issues.push({ code: 'invalid_line', detail: 'missing target after "kind:"', line: index + 1 });
      return;
    }

    for (const target of targets) {
      const [toName, toId] = nameAndId(target);
      const to = toId ?? toName;
      if (to === '') {
        issues.push({ code: 'invalid_line', detail: 'target must be non-empty', line: index + 1 });
        continue;
      }
      const explicitId = parts.length > 3 && parts[3] !== '' ? parts[3] : `g${links.length + 1}`;
      if (seen.has(explicitId)) {
        issues.push({ code: 'duplicate_id', detail: `duplicate link id: ${explicitId}`, line: index + 1 });
        continue;
      }
      seen.add(explicitId);

      const link: GenealogyImportResult['links'][number] = { id: explicitId, from: current.id, to, kind };
      if (label !== undefined) link.label = label;
      links.push(link);
    }
  });

  if (links.length === 0 && issues.length === 0) {
    issues.push({ code: 'no_links', detail: 'no relationship lines found' });
  }

  return { links, issues };
}
