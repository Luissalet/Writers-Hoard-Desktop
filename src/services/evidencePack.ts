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
// under other names. Re-filing the same pack adds nothing: each source keeps
// its pack reference in its notes and is recognised by it.

import { db } from '@/db';
import type { Citation, ResearchEvidence } from '@/types/projectTools';
import { generateId } from '@/utils/idGenerator';
import { safeResearchUrl } from '@/services/researchEvidence';

export interface PackSource {
  id: string;
  title: string;
  url?: string;
  publisher?: string;
  published?: string;
  authors?: string[];
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
  claims: FiledClaim[];
}

function sourceRef(pack: EvidencePack, source: PackSource): string {
  return `${pack.ref}#source=${source.id}`;
}

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * File the pack into the project: a citation per source (reused when the same
 * pack source was filed before) carrying one pending evidence row per claim.
 * Only new citations are created; an existing one is never edited, so undoing
 * the import is removing what it created.
 */
export async function filePack(projectId: string, pack: EvidencePack): Promise<FiledPack> {
  return db.transaction('rw', db.projects, db.citations, async () => {
    if (!await db.projects.get(projectId)) throw new EvidencePackError(`No project ${projectId}.`);
    const existing = await db.citations.where('projectId').equals(projectId).toArray();
    const createdCitationIds: string[] = [];
    const claims: FiledClaim[] = [];
    for (const source of pack.sources) {
      const ref = sourceRef(pack, source);
      const mine = pack.claims.filter(c => c.sourceId === source.id);
      const found = existing.find(c => (c.notes ?? '').split('\n').includes(ref));
      if (found) {
        for (const claim of mine) {
          const match = (found.researchEvidence ?? []).find(e => e.statement === claim.text && e.quote === claim.quote);
          if (match) claims.push({ claim: claim.text, quote: claim.quote, sourceId: found.id, evidenceId: match.id, packSourceId: source.id, created: false });
        }
        continue;
      }
      const now = Date.now();
      const seen = new Set<string>();
      const evidence: ResearchEvidence[] = [];
      for (const claim of mine) {
        const key = `${claim.text}\n${claim.quote}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const row: ResearchEvidence = {
          id: generateId('evidence'), statement: claim.text, kind: claim.kind ?? 'fact', quote: claim.quote,
          locator: claim.locator ?? '', status: 'pending',
          notes: `Filed from ${pack.ref}${claim.id ? ` (claim ${claim.id})` : ''}. Check the quote against the source before relying on it.`,
          createdAt: now, updatedAt: now,
        };
        evidence.push(row);
        claims.push({ claim: claim.text, quote: claim.quote, sourceId: '', evidenceId: row.id, packSourceId: source.id, created: true });
      }
      const url = source.url ? safeResearchUrl(source.url) : undefined;
      const citation: Citation = {
        id: generateId('cite'), projectId, title: source.title, authors: source.authors ?? [],
        ...(source.publisher ? { publisher: source.publisher } : {}),
        ...(source.published ? { publishedAt: source.published } : {}),
        accessedAt: localDay(),
        ...(url ? { url } : {}),
        notes: `${ref}${pack.title ? `\nEvidence pack: ${pack.title}` : ''}`,
        writingIds: [], tags: ['evidence-pack'], researchEvidence: evidence, createdAt: now, updatedAt: now,
      };
      await db.citations.add(citation);
      existing.push(citation);
      createdCitationIds.push(citation.id);
      for (const filed of claims) if (filed.created && !filed.sourceId && filed.packSourceId === source.id) filed.sourceId = citation.id;
    }
    return { ref: pack.ref, createdCitationIds, claims };
  });
}
