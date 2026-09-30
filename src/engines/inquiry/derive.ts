// ============================================
// Derived claim state (pure)
// ============================================
//
// A claim row only stores what the author entered. Everything a reader relies
// on — status, how many excerpts back it, how many independent sources, whether
// it has ended or gone stale — is computed here from the citations as they are
// NOW. Retract a citation and every claim resting on it changes on the next
// render; no claim row is rewritten.

import type { Citation, ResearchEvidence } from '@/types/projectTools';
import { isRetracted, originOf } from '@/services/sourceGrading';
import { containsDate, dayOfTimestamp, endDay, intervalsOverlap, looseStartDay, parsePartial, startDay } from './dates';
import {
  DEFAULT_FUNCTIONAL_PREDICATES,
  DEFAULT_STALE_DAYS,
  SYMMETRIC_PREDICATES,
  type ClaimStatus,
  type InquiryClaim,
  type InquiryRef,
} from './types';

export type SupportProblem = 'missing-citation' | 'missing-evidence' | 'retracted';

export interface ResolvedSupport {
  citationId: string;
  evidenceId: string;
  citation?: Citation;
  evidence?: ResearchEvidence;
  /** Counts toward the claim: the citation exists, is not retracted, and the excerpt exists. */
  active: boolean;
  problem?: SupportProblem;
  origin?: string;
}

/** ended: validTo is past. stale: still current but not seen for a long time. */
export type TimeState = 'current' | 'ended' | 'stale';

export interface ClaimView {
  claim: InquiryClaim;
  status: ClaimStatus;
  supports: ResolvedSupport[];
  /** Excerpts that currently count. */
  evidenceCount: number;
  /** Distinct origins among those excerpts. */
  independentCount: number;
  origins: string[];
  /** Supports that stopped counting (retracted citation, vanished excerpt). */
  inactiveCount: number;
  timeState: TimeState;
  /** The day the claim was last seen true, or null when nothing says. */
  observedDay: number | null;
  /** Whole days between the observation and the reference day (null when unknown). */
  ageDays: number | null;
  /** Is the claim in effect on the `asOf` date (always true without one)? */
  inEffect: boolean;
}

export interface DeriveOptions {
  /** Clock for "today"; injectable for tests. */
  now?: number;
  staleDays?: number;
  /** A partial date: derive relative to that day and mark claims out of effect then. */
  asOf?: string | null;
}

export type CitationLookup = ReadonlyMap<string, Citation> | readonly Citation[];

function lookupOf(citations: CitationLookup): ReadonlyMap<string, Citation> {
  if (citations instanceof Map) return citations as ReadonlyMap<string, Citation>;
  return new Map((citations as readonly Citation[]).map(citation => [citation.id, citation]));
}

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); } catch { return fallback; }
}

export function resolveSupports(claim: InquiryClaim, citations: CitationLookup): ResolvedSupport[] {
  const byId = lookupOf(citations);
  return claim.supports.map(support => {
    const citation = byId.get(support.citationId);
    if (!citation) return { ...support, active: false, problem: 'missing-citation' as const };
    const evidence = (citation.researchEvidence ?? []).find(row => row.id === support.evidenceId);
    const origin = originOf(citation);
    if (!evidence) return { ...support, citation, active: false, problem: 'missing-evidence' as const, origin };
    if (isRetracted(citation)) return { ...support, citation, evidence, active: false, problem: 'retracted' as const, origin };
    return { ...support, citation, evidence, active: true, origin };
  });
}

/**
 * Precedence: the author's retraction, then a manual "disputed", then the lack
 * of any active support (a confirmation cannot outlive its evidence), then a
 * manual "confirmed", then corroboration by two independent origins, else claimed.
 */
export function deriveStatus(claim: InquiryClaim, activeCount: number, independentCount: number): ClaimStatus {
  if (claim.retractedAt) return 'retracted';
  if (claim.manualStatus === 'disputed') return 'disputed';
  if (activeCount === 0) return 'unsupported';
  if (claim.manualStatus === 'confirmed') return 'confirmed';
  return independentCount >= 2 ? 'corroborated' : 'claimed';
}

export function deriveClaim(claim: InquiryClaim, citations: CitationLookup, options: DeriveOptions = {}): ClaimView {
  const now = options.now ?? Date.now();
  const staleDays = Math.max(1, options.staleDays ?? DEFAULT_STALE_DAYS);
  const asOf = options.asOf?.trim() || null;
  const supports = resolveSupports(claim, citations);
  const active = supports.filter(support => support.active);
  const origins = [...new Set(active.map(support => support.origin!))];
  const status = deriveStatus(claim, active.length, origins.length);

  const today = dayOfTimestamp(now);
  const referenceDay = asOf ? safe(() => parsePartial(asOf)?.end ?? today, today) : today;

  // Last observation: the author's own date, else the freshest thing the active sources say.
  let observedDay: number | null = claim.observedAt ? safe(() => startDay(claim.observedAt), null) : null;
  if (observedDay === null) {
    const days = active.flatMap(support => [
      looseStartDay(support.citation?.accessedAt),
      looseStartDay(support.citation?.publishedAt),
    ]).filter((day): day is number => day !== null);
    observedDay = days.length ? Math.max(...days) : null;
  }
  const validToEnd = safe(() => endDay(claim.validTo), null);
  const ended = validToEnd !== null && validToEnd < referenceDay;
  const ageDays = observedDay === null ? null : Math.max(0, referenceDay - observedDay);
  const stale = !ended && ageDays !== null && ageDays > staleDays;

  return {
    claim,
    status,
    supports,
    evidenceCount: active.length,
    independentCount: origins.length,
    origins,
    inactiveCount: supports.length - active.length,
    timeState: ended ? 'ended' : stale ? 'stale' : 'current',
    observedDay,
    ageDays,
    inEffect: asOf ? safe(() => containsDate(claim.validFrom, claim.validTo, asOf), true) : true,
  };
}

export function deriveClaims(claims: readonly InquiryClaim[], citations: CitationLookup, options: DeriveOptions = {}): ClaimView[] {
  const byId = lookupOf(citations);
  return claims.map(claim => deriveClaim(claim, byId, options));
}

// ---------- Claims a citation change touches ----------

/** Claims whose supports include this citation (by any excerpt). */
export function claimsLeaningOn(claims: readonly InquiryClaim[], citationId: string): InquiryClaim[] {
  return claims.filter(claim => claim.supports.some(support => support.citationId === citationId));
}

export interface CitationImpact {
  /** Claims whose active evidence drops to zero. */
  becomeUnsupported: InquiryClaim[];
  /** Claims that lose some active evidence but keep at least one. */
  weakened: InquiryClaim[];
  /** Claims that had none and get some back (a restore). */
  regainSupport: InquiryClaim[];
  /** Claims that gain evidence but already had some (a restore). */
  strengthened: InquiryClaim[];
  /** Every live claim that leans on the citation (author-retracted claims excluded). */
  affected: InquiryClaim[];
}

/** What replacing a citation with `next` would do to the claims, computed before it is applied. */
export function citationChangeImpact(
  claims: readonly InquiryClaim[],
  citations: CitationLookup,
  next: Citation,
  options: DeriveOptions = {},
): CitationImpact {
  const before = lookupOf(citations);
  const after = new Map(before).set(next.id, next);
  const affected = claimsLeaningOn(claims, next.id).filter(claim => !claim.retractedAt);
  const impact: CitationImpact = { becomeUnsupported: [], weakened: [], regainSupport: [], strengthened: [], affected };
  for (const claim of affected) {
    const was = deriveClaim(claim, before, options).evidenceCount;
    const now = deriveClaim(claim, after, options).evidenceCount;
    if (was === now) continue;
    if (now < was) (now === 0 ? impact.becomeUnsupported : impact.weakened).push(claim);
    else (was === 0 ? impact.regainSupport : impact.strengthened).push(claim);
  }
  return impact;
}

export function retractionImpact(
  claims: readonly InquiryClaim[],
  citations: CitationLookup,
  citationId: string,
  options: DeriveOptions = {},
): CitationImpact {
  const target = lookupOf(citations).get(citationId);
  if (!target || isRetracted(target)) return { becomeUnsupported: [], weakened: [], regainSupport: [], strengthened: [], affected: [] };
  return citationChangeImpact(claims, citations, { ...target, retractedAt: options.now ?? Date.now() }, options);
}

// ---------- Entities, triples, contradictions ----------

export function refKey(ref: InquiryRef | undefined): string | null {
  if (!ref) return null;
  if (ref.kind === 'codex') return `c:${ref.id}`;
  const text = ref.text.trim().toLowerCase().replace(/\s+/g, ' ');
  return text ? `t:${text}` : null;
}

export function predicateKey(predicate: string | undefined): string {
  return (predicate ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function isSymmetricPredicate(predicate: string | undefined): boolean {
  return (SYMMETRIC_PREDICATES as readonly string[]).includes(predicateKey(predicate));
}

export function functionalSet(extra?: readonly string[]): Set<string> {
  return new Set([...DEFAULT_FUNCTIONAL_PREDICATES, ...(extra ?? [])].map(predicateKey));
}

/** Codex ids a claim mentions (subject and object). */
export function claimEntityIds(claim: InquiryClaim): string[] {
  const ids: string[] = [];
  if (claim.subject?.kind === 'codex') ids.push(claim.subject.id);
  if (claim.object?.kind === 'codex') ids.push(claim.object.id);
  return [...new Set(ids)];
}

export interface ClaimContradiction {
  subject: string;
  predicate: string;
  claimIds: [string, string];
  /** The two conflicting values, as keys (see refKey). */
  objects: [string, string];
}

/**
 * Two live claims that give one subject different values of a one-at-a-time
 * predicate (born_in, ceo_of, ...) over periods that can overlap. Retracted and
 * unsupported claims are ignored: they assert nothing the author stands behind.
 * Symmetric predicates are read from both ends (A spouse_of B vs B spouse_of C).
 */
export function findContradictions(
  views: readonly ClaimView[],
  options: { functionalPredicates?: readonly string[]; asOf?: string | null } = {},
): ClaimContradiction[] {
  const functional = functionalSet(options.functionalPredicates);
  type Holding = { view: ClaimView; holder: string; value: string; predicate: string };
  const holdings: Holding[] = [];
  for (const view of views) {
    if (view.status === 'retracted' || view.status === 'unsupported') continue;
    if (options.asOf && !view.inEffect) continue;
    const predicate = predicateKey(view.claim.predicate);
    if (!functional.has(predicate)) continue;
    const subject = refKey(view.claim.subject);
    const object = refKey(view.claim.object);
    if (!subject || !object) continue;
    holdings.push({ view, holder: subject, value: object, predicate });
    if (isSymmetricPredicate(predicate)) holdings.push({ view, holder: object, value: subject, predicate });
  }
  const found: ClaimContradiction[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < holdings.length; i += 1) {
    for (let j = i + 1; j < holdings.length; j += 1) {
      const a = holdings[i];
      const b = holdings[j];
      if (a.holder !== b.holder || a.predicate !== b.predicate || a.value === b.value) continue;
      if (a.view.claim.id === b.view.claim.id) continue;
      const overlap = safe(() => intervalsOverlap(a.view.claim.validFrom, a.view.claim.validTo, b.view.claim.validFrom, b.view.claim.validTo), true);
      if (!overlap) continue;
      const ids = [a.view.claim.id, b.view.claim.id].sort() as [string, string];
      const key = `${ids[0]}|${ids[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ subject: a.holder, predicate: a.predicate, claimIds: ids, objects: [a.value, b.value] });
    }
  }
  return found;
}

// ---------- Chronology ----------

export interface ChronologyEntry {
  view: ClaimView;
  /** The date that places it on the line: validFrom, else observedAt, else undated. */
  anchor: string | null;
  day: number | null;
}

export interface ChronologyGap {
  subject: string;
  predicate: string;
  afterClaimId: string;
  beforeClaimId: string;
  /** First and last uncovered day, inclusive. */
  fromDay: number;
  toDay: number;
  days: number;
}

export interface Chronology {
  entries: ChronologyEntry[];
  contradictions: ClaimContradiction[];
  gaps: ChronologyGap[];
}

/** Claims in effect at `asOf` (all of them without one), ordered in time, undated last. */
export function buildChronology(
  views: readonly ClaimView[],
  options: { asOf?: string | null; functionalPredicates?: readonly string[] } = {},
): Chronology {
  const asOf = options.asOf?.trim() || null;
  const visible = views.filter(view => !asOf || view.inEffect);
  const entries: ChronologyEntry[] = visible.map(view => {
    const anchor = view.claim.validFrom || view.claim.observedAt || null;
    return { view, anchor, day: anchor ? safe(() => startDay(anchor), null) : null };
  }).sort((a, b) => {
    if (a.day === null && b.day === null) return a.view.claim.createdAt - b.view.claim.createdAt;
    if (a.day === null) return 1;
    if (b.day === null) return -1;
    return a.day - b.day || a.view.claim.createdAt - b.view.claim.createdAt;
  });
  return {
    entries,
    contradictions: findContradictions(visible, { asOf, functionalPredicates: options.functionalPredicates }),
    gaps: findGaps(visible, options.functionalPredicates),
  };
}

/**
 * Holes in a run of claims that should be continuous: the same subject holding
 * a one-at-a-time predicate (ceo_of, ...) with a dated end followed by a dated
 * start after a pause. The unknown stretch is reported, never filled.
 */
export function findGaps(views: readonly ClaimView[], functionalPredicates?: readonly string[]): ChronologyGap[] {
  const functional = functionalSet(functionalPredicates);
  const groups = new Map<string, ClaimView[]>();
  for (const view of views) {
    if (view.status === 'retracted' || view.status === 'unsupported') continue;
    const predicate = predicateKey(view.claim.predicate);
    const subject = refKey(view.claim.subject);
    if (!subject || !functional.has(predicate) || !view.claim.validFrom) continue;
    const key = `${subject}|${predicate}`;
    groups.set(key, [...(groups.get(key) ?? []), view]);
  }
  const gaps: ChronologyGap[] = [];
  for (const [key, group] of groups) {
    const dated = group
      .map(view => ({ view, start: safe(() => startDay(view.claim.validFrom), null), end: safe(() => endDay(view.claim.validTo), null) }))
      .filter((row): row is { view: ClaimView; start: number; end: number | null } => row.start !== null)
      .sort((a, b) => a.start - b.start);
    const [subject, predicate] = key.split('|');
    for (let i = 0; i + 1 < dated.length; i += 1) {
      const current = dated[i];
      const next = dated[i + 1];
      if (current.end === null) continue; // open-ended: nothing is missing before the next one
      const days = next.start - current.end - 1;
      if (days > 0) {
        gaps.push({
          subject, predicate,
          afterClaimId: current.view.claim.id, beforeClaimId: next.view.claim.id,
          fromDay: current.end + 1, toDay: next.start - 1, days,
        });
      }
    }
  }
  return gaps.sort((a, b) => a.fromDay - b.fromDay);
}

// ---------- Filters and counts ----------

export interface ClaimFilter {
  statuses?: readonly ClaimStatus[];
  entityId?: string;
  tag?: string;
  asOf?: string | null;
  timeState?: TimeState;
  query?: string;
}

export function filterViews(views: readonly ClaimView[], filter: ClaimFilter): ClaimView[] {
  const query = filter.query?.trim().toLowerCase();
  return views.filter(view => {
    if (filter.asOf && !view.inEffect) return false;
    if (filter.statuses?.length && !filter.statuses.includes(view.status)) return false;
    if (filter.entityId && !claimEntityIds(view.claim).includes(filter.entityId)) return false;
    if (filter.tag && !view.claim.tags.includes(filter.tag)) return false;
    if (filter.timeState && view.timeState !== filter.timeState) return false;
    if (query && !`${view.claim.statement} ${view.claim.notes}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function countByStatus(views: readonly ClaimView[]): Record<ClaimStatus, number> {
  const counts: Record<ClaimStatus, number> = { unsupported: 0, claimed: 0, corroborated: 0, confirmed: 0, disputed: 0, retracted: 0 };
  for (const view of views) counts[view.status] += 1;
  return counts;
}
