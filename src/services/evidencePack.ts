// ============================================================================
// Evidence packs — a research station's claims, each with its source and quote
// ============================================================================
//
// A research station hands Writer what it found as an evidence pack: sources
// (title, address, publisher, date) and claims, each claim tied to one source
// by the verbatim passage that backs it. Filing a pack turns every source into
// a project citation and every claim into one of that citation's research
// evidence rows (statement = the claim, quote = the passage, untouched), so
// the claim can then be cited in a chapter with `insertCitation {sourceId,
// evidenceId}` without rewriting a word of it.
//
// Two shapes are read: the plain pack below, and a dossier report of Coase's
// Hoard (`findings[].quotes[]` against `sources[]`), which is the same thing
// under other names. Each source keeps its pack reference in its notes and is
// recognised by it when the pack is filed again: claims already there are
// reused, and a claim the pack has gained since is added to that source.

import { db } from '@/db';
import type { Citation, CitationDataTable, ResearchEvidence } from '@/types/projectTools';
import { generateId } from '@/utils/idGenerator';
import { safeResearchUrl } from '@/services/researchEvidence';

export interface PackSource {
  id: string;
  title: string;
  url?: string;
  publisher?: string;
  published?: string;
  authors?: string[];
  /** A data station's table, kept on the citation so it can be inserted without retyping a figure. */
  table?: CitationDataTable;
}

export interface PackClaim {
  id?: string;
  text: string;
  sourceId: string;
  quote: string;
  locator?: string;
  kind?: ResearchEvidence['kind'];
}

export interface EvidencePack {
  /** Where the pack comes from, stable across re-filing (e.g. hoard://coase/report/<id>). */
  ref: string;
  title?: string;
  sources: PackSource[];
  claims: PackClaim[];
}

export class EvidencePackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidencePackError';
  }
}

const MAX_SOURCES = 200;
const MAX_CLAIMS = 1000;

function text(value: unknown, max = 50_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sourceOf(raw: unknown): PackSource | null {
  const row = record(raw);
  if (!row) return null;
  const id = text(row.id, 200);
  const title = text(row.title, 500);
  if (!id || !title) return null;
  const authors = list(row.authors).map(a => text(a, 200)).filter(Boolean);
  return {
    id, title,
    ...(text(row.url, 2000) ? { url: text(row.url, 2000) } : {}),
    ...(text(row.publisher ?? row.source_provider, 300) ? { publisher: text(row.publisher ?? row.source_provider, 300) } : {}),
    ...(text(row.published ?? row.published_at, 40) ? { published: text(row.published ?? row.published_at, 40) } : {}),
    ...(authors.length ? { authors } : {}),
  };
}

/**
 * The pack inside `raw`: a plain pack (`sources` + `claims`) or a Coase dossier
 * report (`findings` + `sources`). `ref` names it when `raw` carries none.
 */
export function normalizePack(raw: unknown, ref = ''): EvidencePack {
  const root = record(raw);
  if (!root) throw new EvidencePackError('The evidence pack must be an object with sources and claims.');
  const sources = list(root.sources).map(sourceOf).filter((s): s is PackSource => s !== null);
  const known = new Set(sources.map(s => s.id));
  const claims: PackClaim[] = [];
  if (Array.isArray(root.findings)) {
    // A Coase dossier report: one claim per finding and quoted source.
    for (const item of root.findings) {
      const finding = record(item);
      if (!finding) continue;
      const claim = text(finding.claim, 10_000);
      for (const q of list(finding.quotes)) {
        const quote = record(q);
        const sourceId = text(quote?.source_id, 200);
        const passage = text(quote?.text);
        if (!claim || !passage || !known.has(sourceId)) continue;
        claims.push({
          id: text(finding.id, 200) || undefined, text: claim, sourceId, quote: passage,
          locator: [text(finding.section, 100), text(finding.id, 200)].filter(Boolean).join(' · ') || undefined,
          kind: finding.kind === 'inference' ? 'interpretation' : 'fact',
        });
      }
    }
  } else {
    for (const item of list(root.claims)) {
      const row = record(item);
      if (!row) continue;
      const claim = text(row.text ?? row.claim ?? row.statement, 10_000);
      const sourceId = text(row.source_id ?? row.sourceId, 200);
      const quote = text(row.quote);
      if (!claim || !quote || !known.has(sourceId)) continue;
      const kind = row.kind === 'attribution' || row.kind === 'interpretation' ? row.kind : 'fact';
      claims.push({ id: text(row.id, 200) || undefined, text: claim, sourceId, quote, locator: text(row.locator, 500) || undefined, kind });
    }
  }
  if (!sources.length) throw new EvidencePackError('The evidence pack has no source with an id and a title.');
  if (!claims.length) throw new EvidencePackError('No claim in the pack has a text, a quote and a source of the pack: nothing to file.');
  if (sources.length > MAX_SOURCES || claims.length > MAX_CLAIMS) {
    throw new EvidencePackError(`A pack holds at most ${MAX_SOURCES} sources and ${MAX_CLAIMS} claims.`);
  }
  const caseRow = record(root.case);
  const title = text(root.title, 300) || text(root.question, 300) || text(caseRow?.name, 300) || undefined;
  const packRef = text(root.ref, 500) || ref || (text(root.id, 200) ? `pack:${text(root.id, 200)}` : '');
  if (!packRef) throw new EvidencePackError('The pack needs a ref (where it comes from) so it can be recognised when filed again.');
  return { ref: packRef, title, sources: sources.filter(s => claims.some(c => c.sourceId === s.id)), claims };
}

type Cell = string | number | boolean | null;

function cellOf(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' || typeof value === 'boolean' ? value : String(value).slice(0, 2000);
}

/**
 * The pack of a table Nightingale hands over (its `data_handoff` answer): one
 * source per version and print of the rows, carrying the table itself, and one
 * claim per row whose quote is that row as Nightingale wrote it. A table whose
 * data changed is a new source; the same table filed again is recognised.
 */
export function packFromHandoff(raw: unknown): EvidencePack {
  const root = record(raw);
  const provenance = record(root?.provenance);
  const columns = list(root?.columns).map(c => text(c, 200));
  const rows = list(root?.rows).filter((row): row is unknown[] => Array.isArray(row));
  const ref = text(provenance?.ref, 500);
  if (!root || !ref || !columns.length || columns.some(c => !c) || !rows.length) {
    throw new EvidencePackError('Nightingale handed over no table with columns, rows and a provenance ref.');
  }
  if (rows.length > MAX_CLAIMS) throw new EvidencePackError(`A cited table holds at most ${MAX_CLAIMS} rows: ask Nightingale for fewer (limit or filter).`);
  const version = typeof provenance?.version === 'number' ? provenance.version : undefined;
  const fingerprint = text(provenance?.fingerprint, 128);
  const dataset = text(provenance?.dataset, 200);
  const title = text(root.title, 300) || dataset || 'Nightingale';
  const sourceId = `v${version ?? 0}-${fingerprint.slice(0, 12) || 'rows'}`;
  const table: CitationDataTable = {
    columns, rows: rows.map(row => columns.map((_, i) => cellOf(row[i]))), ref,
    ...(version !== undefined ? { version } : {}), ...(fingerprint ? { fingerprint } : {}),
    ...(text(provenance?.query, 4000) ? { query: text(provenance?.query, 4000) } : {}),
  };
  const lines = text(root.csv, 20_000_000).split(/\r?\n/);
  const claims: PackClaim[] = table.rows.map((row, i) => {
    const statement = columns.map((column, j) => `${column}: ${row[j] ?? '—'}`).join(' · ');
    return { id: `row-${i + 1}`, text: statement, sourceId, quote: lines[i + 1]?.trim() || statement, locator: `row ${i + 1}`, kind: 'fact' };
  });
  const source: PackSource = {
    id: sourceId,
    title: `${title}${dataset && dataset !== title ? ` · ${dataset}` : ''}${version !== undefined ? ` · v${version}` : ''}`,
    publisher: "Nightingale's Hoard",
    ...(text(provenance?.version_created_at, 40) ? { published: text(provenance?.version_created_at, 40).slice(0, 10) } : {}),
    table,
  };
  return { ref, title, sources: [source], claims };
}

export interface FiledClaim {
  claim: string;
  quote: string;
  sourceId: string;
  evidenceId: string;
  packSourceId: string;
  created: boolean;
}

export interface FiledPack {
  ref: string;
  createdCitationIds: string[];
  /** Evidence rows added to sources filed before, per source: what undo takes back there. */
  appended: Array<{ citationId: string; evidenceIds: string[] }>;
  claims: FiledClaim[];
}

function sourceRef(pack: EvidencePack, source: PackSource): string {
  return `${pack.ref}#source=${source.id}`;
}

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function evidenceRow(pack: EvidencePack, claim: PackClaim, now: number): ResearchEvidence {
  return {
    id: generateId('evidence'), statement: claim.text, kind: claim.kind ?? 'fact', quote: claim.quote,
    locator: claim.locator ?? '', status: 'pending',
    notes: `Filed from ${pack.ref}${claim.id ? ` (claim ${claim.id})` : ''}. Check the quote against the source before relying on it.`,
    createdAt: now, updatedAt: now,
  };
}

/**
 * File the pack into the project: a citation per source (reused when the same
 * pack source was filed before) carrying one pending evidence row per claim.
 * A reused citation only gains the rows of claims it did not have; nothing
 * already there is edited, so undoing the import is removing what it added.
 */
export async function filePack(projectId: string, pack: EvidencePack): Promise<FiledPack> {
  return db.transaction('rw', db.projects, db.citations, async () => {
    if (!await db.projects.get(projectId)) throw new EvidencePackError(`No project ${projectId}.`);
    const existing = await db.citations.where('projectId').equals(projectId).toArray();
    const createdCitationIds: string[] = [];
    const appended: FiledPack['appended'] = [];
    const claims: FiledClaim[] = [];
    for (const source of pack.sources) {
      const ref = sourceRef(pack, source);
      const found = existing.find(c => (c.notes ?? '').split('\n').includes(ref));
      const citationId = found?.id ?? generateId('cite');
      const rows = [...(found?.researchEvidence ?? [])];
      const added: ResearchEvidence[] = [];
      const now = Date.now();
      for (const claim of pack.claims.filter(c => c.sourceId === source.id)) {
        const match = rows.find(e => e.statement === claim.text && e.quote === claim.quote);
        if (match) {
          if (!added.includes(match)) claims.push({ claim: claim.text, quote: claim.quote, sourceId: citationId, evidenceId: match.id, packSourceId: source.id, created: false });
          continue;
        }
        const row = evidenceRow(pack, claim, now);
        rows.push(row);
        added.push(row);
        claims.push({ claim: claim.text, quote: claim.quote, sourceId: citationId, evidenceId: row.id, packSourceId: source.id, created: true });
      }
      if (found) {
        if (added.length) {
          await db.citations.update(found.id, { researchEvidence: rows, updatedAt: now });
          appended.push({ citationId: found.id, evidenceIds: added.map(row => row.id) });
        }
        continue;
      }
      const url = source.url ? safeResearchUrl(source.url) : undefined;
      const citation: Citation = {
        id: citationId, projectId, title: source.title, authors: source.authors ?? [],
        ...(source.publisher ? { publisher: source.publisher } : {}),
        ...(source.published ? { publishedAt: source.published } : {}),
        accessedAt: localDay(),
        ...(url ? { url } : {}),
        notes: `${ref}${pack.title ? `\nEvidence pack: ${pack.title}` : ''}`,
        writingIds: [], tags: source.table ? ['evidence-pack', 'data-table'] : ['evidence-pack'], researchEvidence: rows,
        ...(source.table ? { dataTable: source.table } : {}), createdAt: now, updatedAt: now,
      };
      await db.citations.add(citation);
      existing.push(citation);
      createdCitationIds.push(citation.id);
    }
    return { ref: pack.ref, createdCitationIds, appended, claims };
  });
}

/** Undo the rows a re-filing added to sources filed before; other rows stay as they are. */
export async function removeAppendedEvidence(appended: FiledPack['appended']): Promise<number> {
  return db.transaction('rw', db.citations, async () => {
    let removed = 0;
    for (const { citationId, evidenceIds } of appended) {
      const citation = await db.citations.get(citationId);
      if (!citation) continue;
      const rows = citation.researchEvidence ?? [];
      const kept = rows.filter(row => !evidenceIds.includes(row.id));
      if (kept.length === rows.length) continue;
      removed += rows.length - kept.length;
      await db.citations.update(citationId, { researchEvidence: kept, updatedAt: Date.now() });
    }
    return removed;
  });
}
