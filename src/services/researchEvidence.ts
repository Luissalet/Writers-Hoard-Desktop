import { db } from '@/db';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import type { Citation, ResearchEvidence } from '@/types/projectTools';

export type EvidenceInput = Pick<ResearchEvidence, 'statement' | 'kind' | 'quote' | 'locator' | 'status' | 'notes'>;
export type EvidenceSource = { citationId: string } | { snapshotId: string };
export class ResearchEvidenceError extends Error {
  readonly code: 'scope' | 'source' | 'statement' | 'quote' | 'url' | 'conflict';
  constructor(code: ResearchEvidenceError['code']) { super(code); this.code = code; }
}

export function safeResearchUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export async function getResearchEvidence(projectId: string) {
  const citations = await db.citations.where('projectId').equals(projectId).toArray();
  return citations.flatMap(citation => (citation.researchEvidence ?? []).map(evidence => ({ citation, evidence })))
    .sort((a, b) => b.evidence.updatedAt - a.evidence.updatedAt);
}

/** Transactional and shared by UI and tools. A review records the author's decision only. */
export async function saveResearchEvidence(projectId: string, source: EvidenceSource, input: EvidenceInput,
  edit?: { id: string; expectedUpdatedAt: number }): Promise<ResearchEvidence> {
  if (!input.statement.trim() || input.statement.length > 10000) throw new ResearchEvidenceError('statement');
  if (!['fact', 'attribution', 'interpretation'].includes(input.kind) || !['pending', 'reviewed', 'disputed'].includes(input.status)) throw new ResearchEvidenceError('statement');
  if (input.quote.length > 50000 || input.locator.length > 2000 || input.notes.length > 10000 || (input.status === 'reviewed' && !input.quote.trim())) throw new ResearchEvidenceError('quote');
  return db.transaction('rw', db.projects, db.citations, db.snapshots, async () => {
    if (!await db.projects.get(projectId)) throw new ResearchEvidenceError('scope');
    let citation: Citation | undefined;
    if ('citationId' in source) citation = await db.citations.get(source.citationId);
    else {
      const snapshot = await db.snapshots.get(source.snapshotId);
      if (!snapshot || snapshot.projectId !== projectId) throw new ResearchEvidenceError('scope');
      citation = (await db.citations.where('projectId').equals(projectId).toArray()).find(row => row.snapshotId === snapshot.id);
      if (!citation) {
        const now = Date.now();
        citation = { id: crypto.randomUUID(), projectId, title: snapshot.title || snapshot.url,
          authors: snapshot.author ? [snapshot.author] : [], url: snapshot.url || undefined,
          publishedAt: snapshot.publishDate, accessedAt: toLocalDateKey(new Date(snapshot.preservedAt || snapshot.createdAt)),
          snapshotId: snapshot.id, writingIds: [], tags: [...snapshot.tags], createdAt: now, updatedAt: now };
      }
    }
    if (!citation) throw new ResearchEvidenceError('source');
    if (citation.projectId !== projectId) throw new ResearchEvidenceError('scope');
    if (citation.url && !safeResearchUrl(citation.url)) throw new ResearchEvidenceError('url');
    const entries = citation.researchEvidence ?? [];
    const previous = edit ? entries.find(row => row.id === edit.id) : undefined;
    if (edit && (!previous || previous.updatedAt !== edit.expectedUpdatedAt)) throw new ResearchEvidenceError('conflict');
    const now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
    const evidence: ResearchEvidence = { ...input, statement: input.statement.trim(),
      id: previous?.id ?? crypto.randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now,
      reviewedAt: input.status === 'reviewed' ? now : undefined };
    await db.citations.put({ ...citation, researchEvidence: [...entries.filter(row => row.id !== evidence.id), evidence], updatedAt: now });
    return evidence;
  });
}
