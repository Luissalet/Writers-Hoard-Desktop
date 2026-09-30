// ============================================
// Source grading and retraction (transactional)
// ============================================
//
// Shared by the research library UI and the AI bridge. Retracting a citation
// NEVER deletes it or any excerpt: it stamps the citation, and every claim that
// rested on it re-derives on its own (see engines/inquiry/derive.ts). The
// result says how many claims that touched, so the author is never surprised.

import { db } from '@/db';
import { citationChangeImpact } from '@/engines/inquiry/derive';
import type { Citation, SourceCredibility, SourceReliability } from '@/types/projectTools';
import { isCredibility, isReliability, isRetracted } from './sourceGrading';

export type GradingErrorCode = 'scope' | 'grade' | 'origin' | 'reason' | 'conflict';

export class SourceGradingError extends Error {
  readonly code: GradingErrorCode;
  constructor(code: GradingErrorCode) { super(code); this.name = 'SourceGradingError'; this.code = code; }
}

export interface GradeInput {
  /** undefined leaves the axis alone, null clears it. */
  reliability?: SourceReliability | null;
  credibility?: SourceCredibility | null;
  origin?: string | null;
}

export interface ClaimImpactSummary {
  /** Live claims that lean on the citation. */
  affected: number;
  becameUnsupported: number;
  weakened: number;
  regainedSupport: number;
  strengthened: number;
  claimIds: string[];
}

export interface GradingResult {
  citation: Citation;
  changed: boolean;
  impact: ClaimImpactSummary;
}

const EMPTY_IMPACT: ClaimImpactSummary = { affected: 0, becameUnsupported: 0, weakened: 0, regainedSupport: 0, strengthened: 0, claimIds: [] };

async function loadScoped(projectId: string, citationId: string, expectedUpdatedAt?: number): Promise<Citation> {
  const citation = await db.citations.get(citationId);
  if (!citation || citation.projectId !== projectId) throw new SourceGradingError('scope');
  if (expectedUpdatedAt !== undefined && citation.updatedAt !== expectedUpdatedAt) throw new SourceGradingError('conflict');
  return citation;
}

async function impactOf(projectId: string, after: Citation): Promise<ClaimImpactSummary> {
  const [claims, citations] = await Promise.all([
    db.inquiryClaims.where('projectId').equals(projectId).toArray(),
    db.citations.where('projectId').equals(projectId).toArray(),
  ]);
  const impact = citationChangeImpact(claims, citations, after);
  return {
    affected: impact.affected.length,
    becameUnsupported: impact.becomeUnsupported.length,
    weakened: impact.weakened.length,
    regainedSupport: impact.regainSupport.length,
    strengthened: impact.strengthened.length,
    claimIds: impact.affected.map(claim => claim.id),
  };
}

function bump(previous: Citation): number {
  return Math.max(Date.now(), previous.updatedAt + 1);
}

/** Set, change or clear the grade and origin of a citation. Never touches excerpts. */
export async function gradeCitation(
  projectId: string,
  citationId: string,
  input: GradeInput,
  guard?: { expectedUpdatedAt: number },
): Promise<GradingResult> {
  if (input.reliability !== undefined && input.reliability !== null && !isReliability(input.reliability)) throw new SourceGradingError('grade');
  if (input.credibility !== undefined && input.credibility !== null && !isCredibility(input.credibility)) throw new SourceGradingError('grade');
  if (typeof input.origin === 'string' && input.origin.length > 200) throw new SourceGradingError('origin');
  return db.transaction('rw', db.projects, db.citations, db.inquiryClaims, async () => {
    const existing = await loadScoped(projectId, citationId, guard?.expectedUpdatedAt);
    const next: Citation = { ...existing };
    if (input.reliability !== undefined) { if (input.reliability === null) delete next.reliability; else next.reliability = input.reliability; }
    if (input.credibility !== undefined) { if (input.credibility === null) delete next.credibility; else next.credibility = input.credibility; }
    if (input.origin !== undefined) {
      const origin = input.origin?.trim();
      if (!origin) delete next.origin; else next.origin = origin;
    }
    const changed = next.reliability !== existing.reliability || next.credibility !== existing.credibility || next.origin !== existing.origin;
    if (!changed) return { citation: existing, changed: false, impact: EMPTY_IMPACT };
    next.updatedAt = bump(existing);
    await db.citations.put(next);
    // Grading does not change what counts; the origin can (two sources become one).
    return { citation: next, changed: true, impact: EMPTY_IMPACT };
  });
}

/** Withdraw a source without deleting it. Dependent claims re-derive; the count is returned. */
export async function retractCitation(
  projectId: string,
  citationId: string,
  reason = '',
  guard?: { expectedUpdatedAt: number },
): Promise<GradingResult> {
  if (reason.length > 2000) throw new SourceGradingError('reason');
  return db.transaction('rw', db.projects, db.citations, db.inquiryClaims, async () => {
    const existing = await loadScoped(projectId, citationId, guard?.expectedUpdatedAt);
    if (isRetracted(existing)) return { citation: existing, changed: false, impact: EMPTY_IMPACT };
    const updatedAt = bump(existing);
    const next: Citation = { ...existing, retractedAt: updatedAt, retractReason: reason.trim() || undefined, updatedAt };
    if (!next.retractReason) delete next.retractReason;
    const impact = await impactOf(projectId, next);
    await db.citations.put(next);
    return { citation: next, changed: true, impact };
  });
}

/** Undo a retraction. The reason is dropped; the excerpts were never touched. */
export async function restoreCitation(
  projectId: string,
  citationId: string,
  guard?: { expectedUpdatedAt: number },
): Promise<GradingResult> {
  return db.transaction('rw', db.projects, db.citations, db.inquiryClaims, async () => {
    const existing = await loadScoped(projectId, citationId, guard?.expectedUpdatedAt);
    if (!isRetracted(existing)) return { citation: existing, changed: false, impact: EMPTY_IMPACT };
    const next: Citation = { ...existing, updatedAt: bump(existing) };
    delete next.retractedAt;
    delete next.retractReason;
    const impact = await impactOf(projectId, next);
    await db.citations.put(next);
    return { citation: next, changed: true, impact };
  });
}

/** How many live claims lean on a citation: shown before retracting or deleting it. */
export async function claimsLeaningOnCitation(projectId: string, citationId: string): Promise<number> {
  const claims = await db.inquiryClaims.where('projectId').equals(projectId).toArray();
  return claims.filter(claim => !claim.retractedAt && claim.supports.some(support => support.citationId === citationId)).length;
}
