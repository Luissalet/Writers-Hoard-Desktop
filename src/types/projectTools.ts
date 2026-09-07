export interface EntityLink {
  id: string;
  projectId: string;
  sourceEngineId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceTitle: string;
  targetEngineId: string;
  targetEntityType: string;
  targetEntityId: string;
  targetTitle: string;
  relation: string;
  notes?: string;
  provenance: 'manual' | 'conversion' | 'migration';
  createdAt: number;
  updatedAt: number;
}

export interface Citation {
  id: string;
  projectId: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishedAt?: string;
  accessedAt: string;
  url?: string;
  notes?: string;
  snapshotId?: string;
  writingIds: string[];
  tags: string[];
  /** Author-maintained evidence, never an automatic truth certification. */
  researchEvidence?: ResearchEvidence[];
  createdAt: number;
  updatedAt: number;
}

export interface ResearchEvidence {
  id: string;
  statement: string;
  kind: 'fact' | 'attribution' | 'interpretation';
  quote: string;
  locator: string;
  status: 'pending' | 'reviewed' | 'disputed';
  notes: string;
  reviewedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type PublishingFormat = 'manuscript' | 'screenplay' | 'research' | 'biography' | 'video';
export type PublishingSelectionMode = 'all' | 'selected';

export interface PublishingProfile {
  id: string;
  projectId: string;
  name: string;
  format: PublishingFormat;
  includeTitlePage: boolean;
  /** A list of the chapters before the first one. Missing on older profiles: off. */
  includeToc?: boolean;
  includeSynopsis: boolean;
  includeBibliography: boolean;
  citationStyle: 'apa' | 'mla' | 'chicago';
  /**
   * Missing on profiles created before reusable compilation. Legacy profiles
   * keep their old meaning: a non-empty selection means `selected`, otherwise
   * `all`.
   */
  selectionMode?: PublishingSelectionMode;
  selectedWritingIds: string[];
  /** Explicit manuscript order. Missing means the legacy chapter/date order. */
  writingOrder?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ConversionReceipt {
  id: string;
  projectId: string;
  sourceEngineId: string;
  sourceEntityId: string;
  targetEngineId: string;
  targetEntityId: string;
  targetTable: string;
  preview: string;
  undoPayload: Record<string, unknown>;
  /**
   * Receipt contract written by the safe conversion flow. Missing means the
   * row predates target guards and therefore may never authorise a delete.
   */
  receiptVersion?: 2;
  /** Monotonic writing version captured in the same transaction as creation. */
  targetVersion?: number;
  /** Semantic signature of the writing exactly as the conversion created it. */
  targetFingerprint?: string;
  /** The provenance edge created with the target; older receipts omit it. */
  conversionLinkId?: string;
  createdAt: number;
  undoneAt?: number;
  /** What undo actually did. Kept on the receipt as a durable audit trail. */
  undoDisposition?: 'removed-intact' | 'detached-preserved' | 'target-missing';
  /** Why a target was preserved instead of physically removed. */
  undoReason?: 'changed' | 'referenced' | 'legacy' | 'scope-mismatch';
}
