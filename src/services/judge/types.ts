// ============================================================================
// Judge — persisted, auditable creative-review types
// ============================================================================

export type ReferenceIndexStatus = 'indexing' | 'ready' | 'error' | 'relink-required';

/** A private document in the personal, cross-project reference library. */
export interface ReferenceDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  version: number;
  status: ReferenceIndexStatus;
  statusDetail?: string;
  /** Original bytes. Project backups intentionally omit these; full backups keep them. */
  original: Blob;
  createdAt: number;
  updatedAt: number;
}

/** A locally extracted, citeable piece of a reference document. */
export interface ReferenceSection {
  id: string;
  documentId: string;
  order: number;
  page?: number;
  heading?: string;
  text: string;
  textHash: string;
  /** Derived lexical terms. The section can be regenerated from the original. */
  terms: string[];
}

export interface ReferenceCriterion {
  id: string;
  text: string;
  sourceSectionId?: string;
  approved: boolean;
}

/** A user-curated reading of a document. Lenses never silently merge. */
export interface ReferenceLens {
  id: string;
  documentId: string;
  name: string;
  sectionIds: string[];
  criteria: ReferenceCriterion[];
  createdAt: number;
  updatedAt: number;
}

export type ProjectReferenceStatus = 'ready' | 'relink-required' | 'missing' | 'versioned';

/**
 * Project ownership is a link, not another copy of the private document.
 * The small manifest snapshot makes project backups intelligible without
 * smuggling the book itself into every archive.
 */
export interface ProjectReferenceLink {
  id: string;
  projectId: string;
  documentId: string;
  lensId: string;
  active: boolean;
  status: ProjectReferenceStatus;
  documentName: string;
  documentHash: string;
  documentVersion: number;
  lensName: string;
  sectionIds: string[];
  criteria: ReferenceCriterion[];
  createdAt: number;
  updatedAt: number;
}

export type JudgeMode = 'judge' | 'questions' | 'reader' | 'story-state';
export type JudgeScope = 'selection' | 'chapter' | 'writings';
export type JudgeSourceMode = 'reference' | 'continuity' | 'both';
export type JudgeConfidence = 'low' | 'medium' | 'high';
export type JudgeFindingStatus = 'active' | 'intentional';
export type ReaderFindingKind = 'knows' | 'suspects' | 'promised' | 'open';
export type StoryStateKind = 'confirmed' | 'hypothesis' | 'contradiction' | 'missing' | 'not-applicable';

export interface JudgeContextPermissions {
  previousWritings: boolean;
  selectedWritingIds: string[];
  codex: boolean;
  outline: boolean;
  timeline: boolean;
}

export interface JudgeSourceVersion {
  documentId: string;
  documentHash: string;
  documentVersion: number;
  lensId: string;
  lensUpdatedAt: number;
}

export interface JudgePayloadReceipt {
  routeLocality: 'local' | 'lan' | 'remote' | 'unknown';
  routeConnectionId: string;
  routeModelId: string;
  routeName: string;
  targetCharacters: number;
  referenceCharacters: number;
  internalCharacters: number;
  targetTruncated: boolean;
  /** IDs and hashes only. Private prose is never copied into the audit receipt. */
  evidence: Array<{ id: string; hash: string; characters: number }>;
  /** Binds one-time disclosure consent to this exact bounded payload plan. */
  disclosureFingerprint: string;
}

export interface JudgeRun {
  id: string;
  projectId: string;
  writingId: string;
  mode: JudgeMode;
  scope: JudgeScope;
  sourceMode: JudgeSourceMode;
  selectedLensIds: string[];
  context: JudgeContextPermissions;
  targetHash: string;
  targetVersions: Array<{ writingId: string; contentHash: string }>;
  sourceVersions: JudgeSourceVersion[];
  payload: JudgePayloadReceipt;
  status: 'running' | 'complete' | 'cancelled' | 'error';
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface JudgeTextAnchor {
  quote: string;
  start: number;
  end: number;
}

export interface JudgeReferenceCitation {
  documentId: string;
  documentName: string;
  documentHash: string;
  sectionId: string;
  sectionHeading?: string;
  page?: number;
  quote: string;
}

export interface JudgeInternalCitation {
  engineId: string;
  entityId: string;
  title: string;
  quote: string;
  start?: number;
  end?: number;
}

export interface JudgeSuggestion {
  before: string;
  after: string;
  rationale: string;
}

export interface JudgeFinding {
  id: string;
  runId: string;
  projectId: string;
  writingId: string;
  lensId?: string;
  mode: JudgeMode;
  kind: string | ReaderFindingKind | StoryStateKind;
  anchor: JudgeTextAnchor;
  observation: string;
  principle?: string;
  reference?: JudgeReferenceCitation;
  internal?: JudgeInternalCitation;
  confidence: JudgeConfidence;
  contextLimits: string;
  suggestion?: JudgeSuggestion;
  defence?: string;
  status: JudgeFindingStatus;
  /** Stable while both pieces of evidence stay identical. */
  evidenceFingerprint: string;
  createdAt: number;
  updatedAt: number;
}

export interface JudgeRunFreshness {
  stale: boolean;
  reasons: Array<'target-changed' | 'source-missing' | 'source-versioned' | 'lens-changed' | 'profile-changed'>;
}
