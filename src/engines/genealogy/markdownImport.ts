// ============================================================================
// Genealogy Markdown importer — W6, first importer of the second round.
//
// Parses a plain Markdown family tree into a genealogy PROPOSAL (links only,
// no persistence): the same shape `validateGenealogy` consumes. The importer
// is deliberately narrow and explicit:
//
//   - Sections: `## Personajes` (one `- Name (id)` per line, optional) and
//     `## Relaciones` (one `- from -> to : kind` per line, required).
//   - Kinds accepted verbatim: biological_parent, adoptive_parent, guardian,
//     partner. Anything else is a per-line issue, never a global throw.
//   - Arrow forms accepted: `->` and `→`. Label after a second `:`.
//   - Every malformed line is reported with its line number; valid lines
//     still produce links (per-line acceptance, like the validator).
//   - Duplicate link ids are rejected (duplicate_id), matching the validator.
//   - Pure function: no I/O, no mutation.
// ============================================================================

export interface GenealogyImportIssue {
  code: 'invalid_line' | 'unknown_kind' | 'duplicate_id' | 'no_links';
  detail: string;
  /** 1-based line number when the issue is about a specific line. */
  line?: number;
}

export interface GenealogyImportResult {
  /** Valid links, ready for validateGenealogy. */
  links: Array<{ id: string; from: string; to: string; kind: string; label?: string }>;
  issues: GenealogyImportIssue[];
}

const KINDS = new Set(['biological_parent', 'adoptive_parent', 'guardian', 'partner']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export function importGenealogyMarkdown(markdown: unknown): GenealogyImportResult {
  const issues: GenealogyImportIssue[] = [];
  const links: GenealogyImportResult['links'] = [];

  if (typeof markdown !== 'string') {
    return { links: [], issues: [{ code: 'invalid_line', detail: 'input must be a string' }] };
  }

  const lines = markdown.split(/\r\n|\r|\n/);
  const seen = new Set<string>();
  let inCharactersSection = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    if (line.startsWith('#')) {
      // `## Personajes` (or any Characters heading) lists `- Name (id)` lines
      // that are NOT relationships: skip them until the next heading.
      inCharactersSection = /personaje|character/i.test(line);
      return;
    }
    if (inCharactersSection) return; // blank or heading

    if (!line.startsWith('-')) {
      issues.push({ code: 'invalid_line', detail: `expected a "- " list item`, line: index + 1 });
      return;
    }

    const body = line.slice(1).trim();
    // Split "from -> to : kind : label" (arrow and colon separated).
    const arrowMatch = body.match(/^(.+?)\s*(?:->|→)\s*(.+)$/);
    if (!arrowMatch) {
      issues.push({ code: 'invalid_line', detail: `missing "from -> to" arrow`, line: index + 1 });
      return;
    }
    const from = arrowMatch[1].trim();
    const rest = arrowMatch[2];
    const parts = rest.split(':').map((p) => p.trim());
    const to = parts[0];
    const kind = (parts[1] ?? '').trim();
    const label = parts.length > 2 && parts[2] !== '' ? parts[2] : undefined;

    if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
      issues.push({ code: 'invalid_line', detail: 'from and to must be non-empty', line: index + 1 });
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

    // Link id: explicit fourth field when present, else derived and unique.
    const explicitId = parts.length > 3 && parts[3] !== '' ? parts[3] : `g${links.length + 1}`;
    if (seen.has(explicitId)) {
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

  return { links, issues };
}
