import type { OutlineBeat } from '@/engines/outline/types';
import type { TimelineConnection, TimelineEvent } from '@/types';

export type BranchEntityKind = 'outline-beat' | 'timeline-event' | 'timeline-connection';
export type CreativeBranchStatus = 'active' | 'archived' | 'promoted';
export type BranchDeltaOperation = 'create' | 'update' | 'remove';

export interface BranchEntityByKind {
  'outline-beat': OutlineBeat;
  'timeline-event': TimelineEvent;
  'timeline-connection': TimelineConnection;
}

export interface BranchEntityPointer {
  kind: BranchEntityKind;
  entityId: string;
  title: string;
}

export type BranchEntitySnapshot = {
  [Kind in BranchEntityKind]: {
    kind: Kind;
    value: BranchEntityByKind[Kind];
  }
}[BranchEntityKind];

/** One lightweight alternative rooted in canonical structure, never prose. */
export interface CreativeBranch {
  id: string;
  projectId: string;
  title: string;
  question?: string;
  root: BranchEntityPointer;
  /** Exact canonical root at the moment the alternative split. */
  baseHash: string;
  status: CreativeBranchStatus;
  createdAt: number;
  updatedAt: number;
  promotedAt?: number;
}

/** A proposed structural change. `base` never moves after the first edit. */
export interface CreativeBranchDelta {
  id: string;
  projectId: string;
  branchId: string;
  targetKind: BranchEntityKind;
  targetId: string;
  operation: BranchDeltaOperation;
  base: BranchEntitySnapshot | null;
  baseHash: string;
  proposal: BranchEntitySnapshot | null;
  createdAt: number;
  updatedAt: number;
}

export interface BranchPromotionChange {
  deltaId: string;
  targetKind: BranchEntityKind;
  targetId: string;
  before: BranchEntitySnapshot | null;
  after: BranchEntitySnapshot | null;
  beforeHash: string;
  afterHash: string;
}

/** Full inverse payload for one atomic promotion. */
export interface BranchPromotionReceipt {
  id: string;
  projectId: string;
  branchId: string;
  changes: BranchPromotionChange[];
  createdAt: number;
  undoneAt?: number;
}

export interface BranchPreviewChange extends BranchPromotionChange {
  operation: BranchDeltaOperation;
  changedFields: string[];
  conflict?: 'canonical-changed' | 'target-now-exists' | 'target-missing' | 'invalid-reference';
}

export interface BranchPromotionPreview {
  branch: CreativeBranch;
  changes: BranchPreviewChange[];
  rootChanged: boolean;
  canPromote: boolean;
}

export class BranchConflictError extends Error {
  readonly preview: BranchPromotionPreview;

  constructor(message: string, preview: BranchPromotionPreview) {
    super(message);
    this.name = 'BranchConflictError';
    this.preview = preview;
  }
}
