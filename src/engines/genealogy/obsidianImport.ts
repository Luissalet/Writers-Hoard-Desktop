// ============================================================================
// Genealogy Obsidian importer — W6, second importer.
//
// Parses Obsidian-style wiki links into a genealogy PROPOSAL (links only, no
// persistence): the same shape `validateGenealogy` consumes. One relationship
// per list line:
//
//   - [[Alice]] -> [[Bob]] : biological_parent
//   - [[Alice|a1]] → [[Bob|b1]] : partner : married 1901
//
// The wiki-link form `[[display|id]]` uses the part after the pipe as the
// node id; a bare `[[Name]]` uses the name itself. Everything else mirrors
// the Markdown importer: kinds accepted verbatim, per-line issues with line
// numbers, derived link ids (`g1`, `g2`, …) unless explicit, duplicate ids
// rejected, pure function with no I/O.
// ============================================================================

import type { GenealogyImportIssue, GenealogyImportResult } from './markdownImport.ts';
import { deriveLinkIds } from './genealogyStore.ts';

const KINDS = new Set(['biological_parent', 'adoptive_parent', 'guardian', 'partner']);

/** Extracts the node id from a `[[display]]` or `[[display|id]]` wiki link. */
function wikiId(link: string): string | null {
  const m = link.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (!m) return null;
  const id = (m[2] ?? m[1]).trim();
  return id === '' ? null : id;
}

export function importGenealogyObsidian(markdown: unknown): GenealogyImportResult {
  const issues: GenealogyImportIssue[] = [];
  const links: GenealogyImportResult['links'] = [];

  if (typeof markdown !== 'string') {
    return { links: [], issues: [{ code: 'invalid_line', detail: 'input must be a string' }] };
  }

  const lines = markdown.split(/\r\n|\r|\n/);
  const seen = new Set<string>();

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;

    if (!line.startsWith('-')) {
      issues.push({ code: 'invalid_line', detail: `expected a "- " list item`, line: index + 1 });
      return;
    }

    const body = line.slice(1).trim();
    const arrowMatch = body.match(/^(.+?)\s*(?:->|→)\s*(.+)$/);
    if (!arrowMatch) {
      issues.push({ code: 'invalid_line', detail: `missing "from -> to" arrow`, line: index + 1 });
      return;
    }

    const from = wikiId(arrowMatch[1].trim());
    const rest = arrowMatch[2];
    const parts = rest.split(':').map((p) => p.trim());
    const to = wikiId(parts[0]);
    const kind = (parts[1] ?? '').trim();
    const label = parts.length > 2 && parts[2] !== '' ? parts[2] : undefined;

    if (from === null || to === null) {
      issues.push({
        code: 'invalid_line',
        detail: 'from and to must be [[wiki links]] (optionally [[display|id]])',
        line: index + 1,
      });
      return;
    }
    if (!KINDS.has(kind)) {
      issues.push({
        code: 'unknown_kind',
        detail: `unknown kind "${kind}" (expected biological_parent, adoptive_parent, guardian or partner)`,
        line: index + 1,
      });
      return;
    }

    // Link id: explicit fourth field when present, else left empty and
    // derived after the loop (see deriveLinkIds below; review r4 P2).
    const explicitId = parts.length > 3 && parts[3] !== '' ? parts[3] : '';
    if (explicitId !== '' && seen.has(explicitId)) {
      issues.push({ code: 'duplicate_id', detail: `duplicate link id: ${explicitId}`, line: index + 1 });
      return;
    }
    seen.add(explicitId);

    const link: GenealogyImportResult['links'][number] = { id: explicitId, from, to, kind };
    if (label !== undefined) link.label = label;
    links.push(link);
  });

  if (links.length === 0 && issues.length === 0) {
    issues.push({ code: 'no_links', detail: 'no relationship lines found' });
  }

  // Derive ids for the entries without one (review r4 P2): reserve the
  // batch's explicit ids first so a derived id never collides with one of them.
  const ids = deriveLinkIds(links as unknown as Record<string, unknown>[], new Set());
  links.forEach((link, i) => { if (link.id === '') link.id = ids[i]; });

  return { links, issues };
}
