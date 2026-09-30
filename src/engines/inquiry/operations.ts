// ============================================
// Investigation — transactional operations
// ============================================
//
// One place for every write, shared by the UI and the AI bridge. Each function
// validates, runs in one Dexie transaction, and throws an InquiryError with a
// stable code. Nothing here stores a status: claims hold what the author typed
// and supports point at excerpts that already exist in the project's citations.

import { db } from '@/db';
import { saveResearchEvidence, type EvidenceInput } from '@/services/researchEvidence';
import type { Citation } from '@/types/projectTools';
import type { CodexEntry } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { normalizePartial, parsePartial, PartialDateError } from './dates';
import { ratingId } from './ach';
import {
  DEFAULT_STALE_DAYS,
  ACH_RATINGS,
  type AchRating,
  type ClaimSupport,
  type InquiryCase,
  type InquiryClaim,
  type InquiryHypothesis,
  type InquiryRating,
  type InquiryRef,
  type ManualClaimStatus,
} from './types';

export type InquiryErrorCode =
  | 'scope' | 'not_found' | 'statement' | 'support' | 'date' | 'confidence' | 'ref' | 'place'
  | 'reason' | 'conflict' | 'status' | 'rating' | 'hypothesis' | 'predicate' | 'quote' | 'field';

export class InquiryError extends Error {
  readonly code: InquiryErrorCode;
  constructor(code: InquiryErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'InquiryError';
    this.code = code;
  }
}

const MAX_TEXT = 10_000;
const MAX_SHORT = 500;

export interface QuoteSupport {
  citationId: string;
  quote: string;
  locator?: string;
}

export interface ClaimInput {
  statement: string;
  subject?: InquiryRef | null;
  predicate?: string | null;
  object?: InquiryRef | null;
  validFrom?: string | null;
  validTo?: string | null;
  observedAt?: string | null;
  confidence?: number;
  notes?: string;
  placeIds?: string[];
  tags?: string[];
  /** Existing excerpts. */
  supports?: ClaimSupport[];
  /** Verbatim quotes to turn into new excerpts in the same transaction. */
  fromQuotes?: QuoteSupport[];
}

export type ClaimPatch = Partial<Omit<ClaimInput, 'fromQuotes'>> & {
  /** Set or clear the author's override. Setting one needs a reason. */
  manualStatus?: ManualClaimStatus | null;
  manualReason?: string | null;
  fromQuotes?: QuoteSupport[];
};

const CLAIM_TABLES = () => [db.projects, db.citations, db.snapshots, db.codexEntries, db.atlasPlaces, db.inquiryClaims, db.inquiryRatings] as const;

function text(value: string | undefined | null, max: number, code: InquiryErrorCode): string {
  const out = (value ?? '').trim();
  if (out.length > max) throw new InquiryError(code, `longer than ${max}`);
  return out;
}

function date(value: string | null | undefined, field: string): string | undefined {
  try {
    return normalizePartial(value ?? undefined);
  } catch (error) {
    if (error instanceof PartialDateError) throw new InquiryError('date', `${field}: ${error.message}`);
    throw error;
  }
}

function checkDateOrder(from: string | undefined, to: string | undefined) {
  if (!from || !to) return;
  if (parsePartial(from)!.start > parsePartial(to)!.end) throw new InquiryError('date', 'validFrom is after validTo');
}

function confidence(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new InquiryError('confidence', 'use 0..1');
  return value;
}

async function ref(projectId: string, value: InquiryRef | null | undefined): Promise<InquiryRef | undefined> {
  if (!value) return undefined;
  if (value.kind === 'text') {
    const label = text(value.text, MAX_SHORT, 'ref');
    return label ? { kind: 'text', text: label } : undefined;
  }
  const entry = await db.codexEntries.get(value.id);
  if (!entry || entry.projectId !== projectId) throw new InquiryError('ref', `codex entry ${value.id}`);
  return { kind: 'codex', id: value.id };
}

function tags(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map(tag => tag.trim()).filter(Boolean))].slice(0, 50);
}

async function places(projectId: string, ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  for (const id of unique) {
    const place = await db.atlasPlaces.get(id);
    if (!place || place.projectId !== projectId) throw new InquiryError('place', id);
  }
  return unique;
}

/** A support must point at an excerpt of a citation of this project. */
async function assertSupport(projectId: string, support: ClaimSupport): Promise<void> {
  const citation = await db.citations.get(support.citationId);
  if (!citation || citation.projectId !== projectId) throw new InquiryError('support', `citation ${support.citationId}`);
  if (!(citation.researchEvidence ?? []).some(row => row.id === support.evidenceId)) {
    throw new InquiryError('support', `excerpt ${support.evidenceId} is not in citation ${support.citationId}`);
  }
}

async function quotedSupports(projectId: string, statement: string, quotes: QuoteSupport[] | undefined): Promise<ClaimSupport[]> {
  const out: ClaimSupport[] = [];
  for (const item of quotes ?? []) {
    if (!item.quote.trim()) throw new InquiryError('quote', 'empty quote');
    const input: EvidenceInput = {
      statement, kind: 'fact', quote: item.quote, locator: item.locator ?? '', status: 'pending', notes: '',
    };
    const evidence = await saveResearchEvidence(projectId, { citationId: item.citationId }, input);
    out.push({ citationId: item.citationId, evidenceId: evidence.id });
  }
  return out;
}

function dedupeSupports(supports: ClaimSupport[]): ClaimSupport[] {
  const seen = new Set<string>();
  return supports.filter(support => {
    const key = `${support.citationId}|${support.evidenceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePredicate(value: string | null | undefined): string | undefined {
  const predicate = text(value, 120, 'predicate');
  return predicate ? predicate.toLowerCase().replace(/[\s-]+/g, '_') : undefined;
}

/** Create a claim. At least one support is required; quotes become excerpts atomically. */
export async function createClaim(projectId: string, input: ClaimInput): Promise<InquiryClaim> {
  const statement = text(input.statement, MAX_TEXT, 'statement');
  if (!statement) throw new InquiryError('statement', 'empty');
  return db.transaction('rw', [...CLAIM_TABLES()], async () => {
    if (!await db.projects.get(projectId)) throw new InquiryError('scope', 'project');
    const validFrom = date(input.validFrom, 'validFrom');
    const validTo = date(input.validTo, 'validTo');
    checkDateOrder(validFrom, validTo);
    const given = dedupeSupports(input.supports ?? []);
    for (const support of given) await assertSupport(projectId, support);
    const supports = dedupeSupports([...given, ...await quotedSupports(projectId, statement, input.fromQuotes)]);
    if (!supports.length) throw new InquiryError('support', 'a claim needs at least one excerpt');
    const now = Date.now();
    const claim: InquiryClaim = {
      id: generateId('claim'),
      projectId,
      statement,
      subject: await ref(projectId, input.subject),
      predicate: normalizePredicate(input.predicate),
      object: await ref(projectId, input.object),
      validFrom,
      validTo,
      observedAt: date(input.observedAt, 'observedAt'),
      confidence: confidence(input.confidence, 0.5),
      notes: text(input.notes, MAX_TEXT, 'statement'),
      placeIds: await places(projectId, input.placeIds),
      tags: tags(input.tags),
      supports,
      createdAt: now,
      updatedAt: now,
    };
    stripUndefined(claim);
    await db.inquiryClaims.add(claim);
    return claim;
  });
}

function stripUndefined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key];
  return value;
}

async function loadClaim(projectId: string, claimId: string, expectedUpdatedAt?: number): Promise<InquiryClaim> {
  const claim = await db.inquiryClaims.get(claimId);
  if (!claim || claim.projectId !== projectId) throw new InquiryError('not_found', `claim ${claimId}`);
  if (expectedUpdatedAt !== undefined && claim.updatedAt !== expectedUpdatedAt) throw new InquiryError('conflict', 'claim changed');
  return claim;
}

/** Edit a claim. `supports` replaces the list (never below one); omitted fields stay. */
export async function updateClaim(
  projectId: string,
  claimId: string,
  patch: ClaimPatch,
  guard?: { expectedUpdatedAt: number },
): Promise<InquiryClaim> {
  return db.transaction('rw', [...CLAIM_TABLES()], async () => {
    const existing = await loadClaim(projectId, claimId, guard?.expectedUpdatedAt);
    const next: InquiryClaim = { ...existing };
    if (patch.statement !== undefined) {
      next.statement = text(patch.statement, MAX_TEXT, 'statement');
      if (!next.statement) throw new InquiryError('statement', 'empty');
    }
    if (patch.subject !== undefined) next.subject = await ref(projectId, patch.subject);
    if (patch.object !== undefined) next.object = await ref(projectId, patch.object);
    if (patch.predicate !== undefined) next.predicate = normalizePredicate(patch.predicate);
    if (patch.validFrom !== undefined) next.validFrom = date(patch.validFrom, 'validFrom');
    if (patch.validTo !== undefined) next.validTo = date(patch.validTo, 'validTo');
    if (patch.observedAt !== undefined) next.observedAt = date(patch.observedAt, 'observedAt');
    checkDateOrder(next.validFrom, next.validTo);
    if (patch.confidence !== undefined) next.confidence = confidence(patch.confidence, existing.confidence);
    if (patch.notes !== undefined) next.notes = text(patch.notes, MAX_TEXT, 'statement');
    if (patch.placeIds !== undefined) next.placeIds = await places(projectId, patch.placeIds);
    if (patch.tags !== undefined) next.tags = tags(patch.tags);
    if (patch.supports !== undefined || patch.fromQuotes?.length) {
      const base = patch.supports !== undefined ? dedupeSupports(patch.supports) : existing.supports;
      const known = new Set(existing.supports.map(s => `${s.citationId}|${s.evidenceId}`));
      for (const support of base) if (!known.has(`${support.citationId}|${support.evidenceId}`)) await assertSupport(projectId, support);
      next.supports = dedupeSupports([...base, ...await quotedSupports(projectId, next.statement, patch.fromQuotes)]);
      if (!next.supports.length) throw new InquiryError('support', 'a claim needs at least one excerpt');
    }
    if (patch.manualStatus !== undefined) {
      if (patch.manualStatus === null) {
        delete next.manualStatus;
        delete next.manualReason;
      } else {
        if (patch.manualStatus !== 'confirmed' && patch.manualStatus !== 'disputed') throw new InquiryError('status', String(patch.manualStatus));
        const reason = text(patch.manualReason ?? existing.manualReason, MAX_TEXT, 'reason');
        if (!reason) throw new InquiryError('reason', 'an override needs a reason');
        next.manualStatus = patch.manualStatus;
        next.manualReason = reason;
      }
    } else if (patch.manualReason !== undefined && existing.manualStatus) {
      const reason = text(patch.manualReason, MAX_TEXT, 'reason');
      if (!reason) throw new InquiryError('reason', 'an override needs a reason');
      next.manualReason = reason;
    }
    stripUndefined(next);
    if (JSON.stringify(next) === JSON.stringify(existing)) return existing;
    next.updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
    await db.inquiryClaims.put(next);
    return next;
  });
}

/** The author withdraws the claim itself. It stays on file and shows as retracted. */
export async function retractClaim(projectId: string, claimId: string, reason = '', guard?: { expectedUpdatedAt: number }): Promise<InquiryClaim> {
  const cleaned = text(reason, MAX_TEXT, 'reason');
  return db.transaction('rw', db.inquiryClaims, async () => {
    const existing = await loadClaim(projectId, claimId, guard?.expectedUpdatedAt);
    if (existing.retractedAt) return existing;
    const updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
    const next: InquiryClaim = { ...existing, retractedAt: updatedAt, updatedAt };
    if (cleaned) next.retractReason = cleaned;
    await db.inquiryClaims.put(next);
    return next;
  });
}

export async function restoreClaim(projectId: string, claimId: string, guard?: { expectedUpdatedAt: number }): Promise<InquiryClaim> {
  return db.transaction('rw', db.inquiryClaims, async () => {
    const existing = await loadClaim(projectId, claimId, guard?.expectedUpdatedAt);
    if (!existing.retractedAt) return existing;
    const next: InquiryClaim = { ...existing, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
    delete next.retractedAt;
    delete next.retractReason;
    await db.inquiryClaims.put(next);
    return next;
  });
}

/** Delete a claim and the matrix ratings that were about it. Sources and excerpts stay. */
export async function deleteClaim(projectId: string, claimId: string, guard?: { expectedUpdatedAt: number }): Promise<{ ratingsRemoved: number }> {
  return db.transaction('rw', db.inquiryClaims, db.inquiryRatings, async () => {
    await loadClaim(projectId, claimId, guard?.expectedUpdatedAt);
    const ratingsRemoved = await db.inquiryRatings.where('claimId').equals(claimId).delete();
    await db.inquiryClaims.delete(claimId);
    return { ratingsRemoved };
  });
}

// ---------- Case (research question) ----------

export async function getCase(projectId: string): Promise<InquiryCase | undefined> {
  return db.inquiryCases.where('projectId').equals(projectId).first();
}

export interface CaseInput {
  question?: string;
  staleDays?: number;
  functionalPredicates?: string[];
}

export async function saveCase(projectId: string, input: CaseInput): Promise<InquiryCase> {
  const question = input.question === undefined ? undefined : text(input.question, MAX_TEXT, 'statement');
  if (input.staleDays !== undefined && (!Number.isInteger(input.staleDays) || input.staleDays < 1 || input.staleDays > 36_500)) {
    throw new InquiryError('field', 'staleDays must be 1..36500');
  }
  return db.transaction('rw', db.projects, db.inquiryCases, async () => {
    if (!await db.projects.get(projectId)) throw new InquiryError('scope', 'project');
    const existing = await db.inquiryCases.where('projectId').equals(projectId).first();
    const now = Date.now();
    const next: InquiryCase = {
      id: existing?.id ?? generateId('inq'),
      projectId,
      question: question ?? existing?.question ?? '',
      staleDays: input.staleDays ?? existing?.staleDays ?? DEFAULT_STALE_DAYS,
      functionalPredicates: input.functionalPredicates
        ? [...new Set(input.functionalPredicates.map(normalizePredicate).filter((p): p is string => !!p))]
        : existing?.functionalPredicates,
      createdAt: existing?.createdAt ?? now,
      updatedAt: Math.max(now, (existing?.updatedAt ?? 0) + 1),
    };
    stripUndefined(next);
    await db.inquiryCases.put(next);
    return next;
  });
}

// ---------- Hypotheses and ratings ----------

export async function addHypothesis(projectId: string, statement: string): Promise<InquiryHypothesis> {
  const cleaned = text(statement, MAX_TEXT, 'hypothesis');
  if (!cleaned) throw new InquiryError('hypothesis', 'empty');
  return db.transaction('rw', db.projects, db.inquiryHypotheses, async () => {
    if (!await db.projects.get(projectId)) throw new InquiryError('scope', 'project');
    const rows = await db.inquiryHypotheses.where('projectId').equals(projectId).toArray();
    const now = Date.now();
    const row: InquiryHypothesis = {
      id: generateId('hyp'), projectId, statement: cleaned, status: 'open',
      order: rows.reduce((max, h) => Math.max(max, h.order), -1) + 1, createdAt: now, updatedAt: now,
    };
    await db.inquiryHypotheses.add(row);
    return row;
  });
}

export async function updateHypothesis(
  projectId: string,
  hypothesisId: string,
  patch: { statement?: string; status?: InquiryHypothesis['status'] },
): Promise<InquiryHypothesis> {
  return db.transaction('rw', db.inquiryHypotheses, async () => {
    const existing = await db.inquiryHypotheses.get(hypothesisId);
    if (!existing || existing.projectId !== projectId) throw new InquiryError('not_found', `hypothesis ${hypothesisId}`);
    const next = { ...existing };
    if (patch.statement !== undefined) {
      next.statement = text(patch.statement, MAX_TEXT, 'hypothesis');
      if (!next.statement) throw new InquiryError('hypothesis', 'empty');
    }
    if (patch.status !== undefined) {
      if (patch.status !== 'open' && patch.status !== 'discarded') throw new InquiryError('status', String(patch.status));
      next.status = patch.status;
    }
    if (next.statement === existing.statement && next.status === existing.status) return existing;
    next.updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
    await db.inquiryHypotheses.put(next);
    return next;
  });
}

export async function deleteHypothesis(projectId: string, hypothesisId: string): Promise<{ ratingsRemoved: number }> {
  return db.transaction('rw', db.inquiryHypotheses, db.inquiryRatings, async () => {
    const existing = await db.inquiryHypotheses.get(hypothesisId);
    if (!existing || existing.projectId !== projectId) throw new InquiryError('not_found', `hypothesis ${hypothesisId}`);
    const ratingsRemoved = await db.inquiryRatings.where('hypothesisId').equals(hypothesisId).delete();
    await db.inquiryHypotheses.delete(hypothesisId);
    return { ratingsRemoved };
  });
}

/** One rating per (hypothesis, claim); `null` clears the cell. */
export async function rateHypothesis(
  projectId: string,
  hypothesisId: string,
  claimId: string,
  rating: AchRating | null,
  note = '',
): Promise<InquiryRating | null> {
  if (rating !== null && !(ACH_RATINGS as readonly string[]).includes(rating)) throw new InquiryError('rating', String(rating));
  const cleaned = text(note, MAX_TEXT, 'rating');
  return db.transaction('rw', db.inquiryHypotheses, db.inquiryClaims, db.inquiryRatings, async () => {
    const hypothesis = await db.inquiryHypotheses.get(hypothesisId);
    if (!hypothesis || hypothesis.projectId !== projectId) throw new InquiryError('not_found', `hypothesis ${hypothesisId}`);
    await loadClaim(projectId, claimId);
    const id = ratingId(hypothesisId, claimId);
    if (rating === null) {
      await db.inquiryRatings.delete(id);
      return null;
    }
    const row: InquiryRating = { id, projectId, hypothesisId, claimId, rating, note: cleaned, updatedAt: Date.now() };
    await db.inquiryRatings.put(row);
    return row;
  });
}

// ---------- Reading ----------

export interface InquirySnapshot {
  case: InquiryCase | undefined;
  claims: InquiryClaim[];
  hypotheses: InquiryHypothesis[];
  ratings: InquiryRating[];
  citations: Citation[];
  entries: CodexEntry[];
}

export async function loadInquirySnapshot(projectId: string): Promise<InquirySnapshot> {
  const [inquiryCase, claims, hypotheses, ratings, citations, entries] = await Promise.all([
    getCase(projectId),
    db.inquiryClaims.where('projectId').equals(projectId).toArray(),
    db.inquiryHypotheses.where('projectId').equals(projectId).sortBy('order'),
    db.inquiryRatings.where('projectId').equals(projectId).toArray(),
    db.citations.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
  ]);
  claims.sort((a, b) => a.createdAt - b.createdAt);
  return { case: inquiryCase, claims, hypotheses, ratings, citations, entries };
}
