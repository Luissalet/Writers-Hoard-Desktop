// ============================================
// Investigation engine — data model
// ============================================
//
// An investigation turns the research evidence a project already holds
// (citations, each with verbatim excerpts) into CLAIMS and reasons about them.
// Nothing here stores a verdict: a claim row keeps what the author entered,
// and its status, evidence count and freshness are recomputed from the
// citations it rests on (see ./derive.ts). Retracting a source therefore
// changes every claim that leaned on it without touching a claim row.

/** A date as sources give it: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
export type PartialDate = string;

/** One end of a structured claim: a codex entry of the project, or free text. */
export type InquiryRef =
  | { kind: 'codex'; id: string }
  | { kind: 'text'; text: string };

/** Points at one excerpt (ResearchEvidence) inside one citation of the project. */
export interface ClaimSupport {
  citationId: string;
  evidenceId: string;
}

/** What the author can set by hand. Everything else is derived. */
export type ManualClaimStatus = 'confirmed' | 'disputed';

/** The derived verdicts, weakest to strongest support. */
export type ClaimStatus =
  | 'unsupported'
  | 'claimed'
  | 'corroborated'
  | 'confirmed'
  | 'disputed'
  | 'retracted';

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  'confirmed', 'corroborated', 'claimed', 'disputed', 'unsupported', 'retracted',
];

export interface InquiryClaim {
  id: string;
  projectId: string;
  /** The assertion, in the author's words. */
  statement: string;
  /** Optional structured triple; subject and object are codex ids or free text. */
  subject?: InquiryRef;
  predicate?: string;
  object?: InquiryRef;
  /** Interval in which the claim is meant to hold; open ends are open. */
  validFrom?: PartialDate;
  validTo?: PartialDate;
  /** When somebody last saw it to be true, when the sources do not say. */
  observedAt?: PartialDate;
  /** The author's own confidence, 0..1. Never used to compute a status. */
  confidence: number;
  notes: string;
  /** Real Atlas places (atlasPlaces ids) the claim is about. */
  placeIds: string[];
  tags: string[];
  /** At least one at creation and always afterwards. */
  supports: ClaimSupport[];
  manualStatus?: ManualClaimStatus;
  manualReason?: string;
  /** The author withdrew the claim itself (sticky until restored). */
  retractedAt?: number;
  retractReason?: string;
  createdAt: number;
  updatedAt: number;
}

/** One row per project: the research question and its tuning. */
export interface InquiryCase {
  id: string;
  projectId: string;
  question: string;
  /** A current fact not observed for longer than this is "stale". */
  staleDays: number;
  /** Predicates where a subject holds one object at a time (conflicts are flagged). */
  functionalPredicates?: string[];
  createdAt: number;
  updatedAt: number;
}

export type HypothesisStatus = 'open' | 'discarded';

export interface InquiryHypothesis {
  id: string;
  projectId: string;
  statement: string;
  status: HypothesisStatus;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** Analysis of competing hypotheses: how consistent a claim is with a hypothesis. */
export type AchRating = 'CC' | 'C' | 'N' | 'I' | 'II' | 'NA';
export const ACH_RATINGS: readonly AchRating[] = ['CC', 'C', 'N', 'I', 'II', 'NA'];

export interface InquiryRating {
  /** `${hypothesisId}|${claimId}`: one rating per pair, written with put. */
  id: string;
  projectId: string;
  hypothesisId: string;
  claimId: string;
  rating: AchRating;
  note: string;
  updatedAt: number;
}

/** What one enrichment run wrote, exactly, so undo can reverse it and nothing else. */
export interface EnrichmentChange {
  field: 'wikidataQid' | `fields.${string}`;
  before: string | null;
  after: string;
}

export interface EnrichmentRun {
  id: string;
  projectId: string;
  enricher: 'wikidata';
  entryId: string;
  qid: string;
  status: 'ok' | 'undone';
  /** Citations this run created (a Wikidata item the project did not cite yet). */
  createdCitationIds: string[];
  /** The citation that stands for the item, whether created now or reused. */
  citationId: string;
  changes: EnrichmentChange[];
  createdAt: number;
  undoneAt?: number;
  /** Plain-language trace of the undo: what was restored, kept or skipped. */
  undoNotes?: string[];
}

export const DEFAULT_STALE_DAYS = 365;

/** Built in: a subject can only hold one object of these at a time. */
export const DEFAULT_FUNCTIONAL_PREDICATES: readonly string[] = [
  'born_in', 'died_in', 'ceo_of', 'headquartered_in', 'capital_of',
  'spouse_of', 'reports_to', 'subsidiary_of', 'occurred_at',
];

/** Built in: the relation reads the same from either end. */
export const SYMMETRIC_PREDICATES: readonly string[] = ['spouse_of', 'sibling_of', 'associated_with'];
