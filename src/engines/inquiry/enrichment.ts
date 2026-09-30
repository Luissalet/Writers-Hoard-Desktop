// ============================================
// Wikidata enrichment of codex entries
// ============================================
//
// Search candidates → preview what would be filled → apply (fill EMPTY fields
// only, store the item id, record a graded citation) → undo. Each apply writes
// an `enrichmentRuns` row holding exactly what it changed, so undo reverses
// that and nothing else: a field the author edited since is kept, and a
// citation that claims now rest on is kept too.
//
// The privacy guard lives here, in one place, and is checked before any name
// leaves the machine and again inside the apply transaction: a person in the
// codex is private unless the author marked them a public figure.

import { db } from '@/db';
import type { CodexEntry } from '@/types';
import type { Citation, ResearchEvidence } from '@/types/projectTools';
import { generateId } from '@/utils/idGenerator';
import type { EnrichmentChange, EnrichmentRun } from './types';
import {
  evidenceQuote, itemsToResolve, parseEntity, parseLabels, parseSearch, planFields, wikidataUrl, QID_PATTERN,
  type PlannedField, type WikidataCandidate, type WikidataItem, type WikidataRequest, type WikidataResponse,
} from './wikidata';

export type EnrichmentErrorCode =
  | 'scope' | 'private_person' | 'not_person' | 'unavailable' | 'network' | 'timeout' | 'http' | 'too-large'
  | 'bad-request' | 'not_found' | 'bad_response' | 'qid' | 'run_not_found' | 'already_undone' | 'query';

/** Shown to a person or an agent: what happened and what to do about it. */
const HINTS: Partial<Record<EnrichmentErrorCode, string>> = {
  private_person: 'This person is not marked as a public figure, so nothing about them is looked up. If they really are one, mark them as a public figure in Investigation > Entities first.',
  unavailable: 'Wikidata lookups need the desktop app; this build has no connection to it.',
  network: 'Wikidata could not be reached. Check the connection and try again.',
  timeout: 'Wikidata did not answer in time. Try again in a moment.',
  http: 'Wikidata answered with an error. Try again later.',
  'too-large': 'That Wikidata item is too large to read. Pick a more specific one.',
};

export class EnrichmentError extends Error {
  readonly code: EnrichmentErrorCode;
  readonly hint: string;
  constructor(code: EnrichmentErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EnrichmentError';
    this.code = code;
    this.hint = HINTS[code] ?? '';
  }
}

export type WikidataTransport = (request: WikidataRequest) => Promise<WikidataResponse>;

/** The desktop app's bridge to main, or null on a build without it. */
export function electronTransport(): WikidataTransport | null {
  const api = typeof window === 'undefined' ? undefined : window.electronAPI?.wikidata;
  return api ? request => api.request(request) : null;
}

async function ask(transport: WikidataTransport | null | undefined, request: WikidataRequest): Promise<unknown> {
  const send = transport ?? electronTransport();
  if (!send) throw new EnrichmentError('unavailable');
  let response: WikidataResponse;
  try {
    response = await send(request);
  } catch {
    throw new EnrichmentError('network');
  }
  if (!response.ok) throw new EnrichmentError(response.code, response.error);
  return response.data;
}

// ---------- Privacy guard ----------

export function isPerson(entry: Pick<CodexEntry, 'type'>): boolean {
  return entry.type === 'character';
}

/** A person is enrichable only when the author marked them a public figure. Everything else is. */
export function isEnrichable(entry: Pick<CodexEntry, 'type' | 'publicFigure'>): boolean {
  return !isPerson(entry) || entry.publicFigure === true;
}

export function assertEnrichable(entry: Pick<CodexEntry, 'type' | 'publicFigure'>): void {
  if (!isEnrichable(entry)) throw new EnrichmentError('private_person');
}

async function loadEntry(projectId: string, entryId: string): Promise<CodexEntry> {
  const entry = await db.codexEntries.get(entryId);
  if (!entry || entry.projectId !== projectId) throw new EnrichmentError('scope');
  return entry;
}

/** Mark (or unmark) a codex person as a public figure. Only people carry the flag. */
export async function setPublicFigure(projectId: string, entryId: string, publicFigure: boolean): Promise<CodexEntry> {
  return db.transaction('rw', db.codexEntries, async () => {
    const entry = await loadEntry(projectId, entryId);
    if (!isPerson(entry)) throw new EnrichmentError('not_person');
    if ((entry.publicFigure === true) === publicFigure) return entry;
    const next: CodexEntry = { ...entry, publicFigure, updatedAt: Math.max(Date.now(), entry.updatedAt + 1) };
    if (!publicFigure) delete next.publicFigure;
    await db.codexEntries.put(next);
    return next;
  });
}

// ---------- Search and preview ----------

export interface SearchResult {
  query: string;
  candidates: WikidataCandidate[];
}

export async function searchCandidates(
  projectId: string,
  entryId: string,
  options: { query?: string; language?: string; transport?: WikidataTransport } = {},
): Promise<SearchResult> {
  const entry = await loadEntry(projectId, entryId);
  assertEnrichable(entry); // before anything is sent
  const query = (options.query ?? entry.title).replace(/\s+/g, ' ').trim();
  if (!query || query.length > 200) throw new EnrichmentError('query');
  const data = await ask(options.transport, { op: 'search', query, language: options.language ?? 'en' });
  return { query, candidates: parseSearch(data) };
}

export interface EnrichmentPreview {
  projectId: string;
  entryId: string;
  qid: string;
  language: string;
  item: WikidataItem;
  /** Everything Wikidata offers for this type. */
  planned: PlannedField[];
  /** What would be written now: the fields that are empty. */
  willFill: PlannedField[];
  /** Offered but left alone because the author already wrote something. */
  alreadyFilled: PlannedField[];
  labels: Record<string, string>;
}

function split(entry: CodexEntry, planned: readonly PlannedField[]) {
  const willFill: PlannedField[] = [];
  const alreadyFilled: PlannedField[] = [];
  for (const row of planned) {
    const current = entry.fields[row.field];
    (current === undefined || current.trim() === '' ? willFill : alreadyFilled).push(row);
  }
  return { willFill, alreadyFilled };
}

export async function previewEnrichment(
  projectId: string,
  entryId: string,
  qid: string,
  options: { language?: string; transport?: WikidataTransport } = {},
): Promise<EnrichmentPreview> {
  if (!QID_PATTERN.test(qid)) throw new EnrichmentError('qid');
  const entry = await loadEntry(projectId, entryId);
  assertEnrichable(entry);
  const language = options.language ?? 'en';
  const item = parseEntity(await ask(options.transport, { op: 'entity', qid, language }), qid, language);
  if (!item) throw new EnrichmentError('not_found', qid);
  const ids = itemsToResolve(entry.type, item);
  const labels = ids.length ? parseLabels(await ask(options.transport, { op: 'labels', qids: ids, language }), language) : new Map<string, string>();
  const planned = planFields(entry.type, item, labels);
  return { projectId, entryId, qid, language, item, planned, ...split(entry, planned), labels: Object.fromEntries(labels) };
}

// ---------- Apply ----------

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function applyEnrichment(preview: EnrichmentPreview): Promise<EnrichmentRun> {
  const { projectId, entryId, qid, item, planned } = preview;
  return db.transaction('rw', db.codexEntries, db.citations, db.enrichmentRuns, async () => {
    const entry = await loadEntry(projectId, entryId);
    assertEnrichable(entry); // the flag may have changed since the preview
    const now = Date.now();
    const changes: EnrichmentChange[] = [];
    const fields = { ...entry.fields };
    for (const row of split(entry, planned).willFill) {
      changes.push({ field: `fields.${row.field}`, before: entry.fields[row.field] ?? null, after: row.value });
      fields[row.field] = row.value;
    }
    if (entry.wikidataQid !== qid) changes.unshift({ field: 'wikidataQid', before: entry.wikidataQid ?? null, after: qid });

    // One citation per Wikidata item: reuse it when the project already has it.
    const url = wikidataUrl(qid);
    const existing = (await db.citations.where('projectId').equals(projectId).toArray()).find(row => row.url === url);
    const createdCitationIds: string[] = [];
    let citationId = existing?.id;
    if (!existing) {
      const evidence: ResearchEvidence = {
        id: generateId('evidence'), statement: `${item.label}${item.description ? `: ${item.description}` : ''}`, kind: 'attribution',
        quote: evidenceQuote(item, planned), locator: qid, status: 'pending', notes: '', createdAt: now, updatedAt: now,
      };
      const citation: Citation = {
        id: generateId('cite'), projectId, title: `Wikidata: ${item.label} (${qid})`, authors: [], publisher: 'Wikidata',
        accessedAt: localDay(), url, notes: item.description, writingIds: [], tags: ['wikidata'],
        researchEvidence: [evidence],
        // A crowd-edited index: usually fine as a pointer, never enough alone to settle anything.
        reliability: 'C', credibility: 3, origin: 'wikidata.org',
        createdAt: now, updatedAt: now,
      };
      await db.citations.add(citation);
      citationId = citation.id;
      createdCitationIds.push(citation.id);
    }

    if (changes.length) {
      await db.codexEntries.put({ ...entry, fields, wikidataQid: qid, updatedAt: Math.max(now, entry.updatedAt + 1) });
    }
    const run: EnrichmentRun = {
      id: generateId('enrich'), projectId, enricher: 'wikidata', entryId, qid, status: 'ok',
      createdCitationIds, citationId: citationId!, changes, createdAt: now,
    };
    await db.enrichmentRuns.add(run);
    return run;
  });
}

/** Preview and apply in one step (the tool path). */
export async function enrichEntry(
  projectId: string,
  entryId: string,
  qid: string,
  options: { language?: string; transport?: WikidataTransport } = {},
): Promise<{ run: EnrichmentRun; preview: EnrichmentPreview }> {
  const preview = await previewEnrichment(projectId, entryId, qid, options);
  return { run: await applyEnrichment(preview), preview };
}

// ---------- Undo ----------

export async function undoEnrichment(projectId: string, runId: string): Promise<EnrichmentRun> {
  return db.transaction('rw', db.codexEntries, db.citations, db.inquiryClaims, db.enrichmentRuns, async () => {
    const run = await db.enrichmentRuns.get(runId);
    if (!run || run.projectId !== projectId) throw new EnrichmentError('run_not_found');
    if (run.status === 'undone') throw new EnrichmentError('already_undone');
    const notes: string[] = [];
    const entry = await db.codexEntries.get(run.entryId);
    if (!entry || entry.projectId !== projectId) {
      notes.push('entry-missing');
    } else {
      const fields = { ...entry.fields };
      let wikidataQid = entry.wikidataQid;
      const hadQid = 'wikidataQid' in entry;
      for (const change of [...run.changes].reverse()) {
        if (change.field === 'wikidataQid') {
          if (wikidataQid === change.after) {
            wikidataQid = change.before ?? undefined;
            notes.push('restored:wikidataQid');
          } else notes.push('kept-edited:wikidataQid');
          continue;
        }
        const key = change.field.slice('fields.'.length);
        if (fields[key] === change.after) {
          if (change.before === null) delete fields[key]; else fields[key] = change.before;
          notes.push(`restored:${key}`);
        } else notes.push(`kept-edited:${key}`);
      }
      const next: CodexEntry = { ...entry, fields, updatedAt: Math.max(Date.now(), entry.updatedAt + 1) };
      if (wikidataQid === undefined) { if (hadQid) delete next.wikidataQid; } else next.wikidataQid = wikidataQid;
      await db.codexEntries.put(next);
    }
    if (run.createdCitationIds.length) {
      const claims = await db.inquiryClaims.where('projectId').equals(projectId).toArray();
      for (const id of run.createdCitationIds) {
        const inUse = claims.some(claim => claim.supports.some(support => support.citationId === id));
        if (inUse) { notes.push('citation-kept'); continue; }
        await db.citations.delete(id);
        notes.push('citation-removed');
      }
    }
    const undone: EnrichmentRun = { ...run, status: 'undone', undoneAt: Date.now(), undoNotes: notes };
    await db.enrichmentRuns.put(undone);
    return undone;
  });
}

export async function listEnrichmentRuns(projectId: string, entryId?: string): Promise<EnrichmentRun[]> {
  const rows = await db.enrichmentRuns.where('projectId').equals(projectId).toArray();
  return rows.filter(row => !entryId || row.entryId === entryId).sort((a, b) => b.createdAt - a.createdAt);
}
