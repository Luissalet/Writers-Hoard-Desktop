import type { Annotation, AnnotationReference } from '@/engines/annotations/types';
import type { WritingSnapshot } from '@/engines/writings/snapshotTypes';
import type { BranchPromotionReceipt } from '@/services/branching';
import type { ConversionReceipt, EntityLink } from '@/types/projectTools';

export interface StoryLensEntityRef {
  engineId: string;
  entityType: string;
  entityId: string;
  title: string;
}

/**
 * A disposable projection of a canonical row. The lenses never persist it and
 * never inspect prose to manufacture motifs: only the explicit `tags` array is
 * semantic input.
 */
export interface StoryLensEntity extends StoryLensEntityRef {
  projectId: string;
  tags: readonly string[];
  createdAt?: number;
  updatedAt?: number;
  /** Optional order supplied by a real Outline/scene/narrative-axis adapter. */
  sequence?: {
    scopeId: string;
    scopeTitle: string;
    order: number;
    label?: string;
  };
}

export type StoryLensAvailability = 'live' | 'snapshot-only' | 'reference-only';

export interface StoryLensEntityNode extends StoryLensEntityRef {
  key: string;
  projectId: string;
  tags: string[];
  availability: StoryLensAvailability;
  createdAt?: number;
  updatedAt?: number;
  sequence?: StoryLensEntity['sequence'];
}

export interface CreativePromotionEvidence {
  id: string;
  projectId: string;
  target: StoryLensEntityRef;
  sources: readonly StoryLensEntityRef[];
  move: string;
  createdAt: number;
}

export interface BuildStoryLensesInput {
  projectId: string;
  entities: readonly StoryLensEntity[];
  annotations?: readonly Annotation[];
  annotationReferences?: readonly AnnotationReference[];
  entityLinks?: readonly EntityLink[];
  conversionReceipts?: readonly ConversionReceipt[];
  branchPromotionReceipts?: readonly BranchPromotionReceipt[];
  writingSnapshots?: readonly WritingSnapshot[];
  /** Persisted or session-owned Mesa de ideas provenance, projected by its host. */
  creativePromotions?: readonly CreativePromotionEvidence[];
}

export type MotifEvidenceKind = 'co-occurrence' | 'annotation-reference' | 'entity-link';
export type MotifEchoKind = 'echo' | 'transformation';

export interface MotifAppearance {
  id: string;
  motifId: string;
  entityKey: string;
  explicitTag: string;
}

export interface MotifEcho {
  id: string;
  motifId: string;
  sourceEntityKey: string;
  targetEntityKey: string;
  kind: MotifEchoKind;
  evidenceKind: Exclude<MotifEvidenceKind, 'co-occurrence'>;
  evidenceId: string;
  relation?: string;
  note?: string;
  orphaned?: boolean;
  /** Always true: evidence supports a question, never an imposed reading. */
  suggested: true;
}

export interface MotifConnection {
  id: string;
  motifIds: readonly [string, string];
  kind: MotifEvidenceKind;
  evidenceIds: string[];
  entityKeys: string[];
  suggested: true;
}

export interface MotifGap {
  id: string;
  motifId: string;
  scopeId: string;
  scopeTitle: string;
  beforeEntityKey: string;
  afterEntityKey: string;
  missingEntityKeys: string[];
}

export interface MotifNode {
  id: string;
  label: string;
  aliases: string[];
  appearances: MotifAppearance[];
  echoes: MotifEcho[];
  relatedMotifIds: string[];
  gapIds: string[];
}

export interface MotifConstellation {
  motifs: MotifNode[];
  appearances: MotifAppearance[];
  echoes: MotifEcho[];
  connections: MotifConnection[];
  gaps: MotifGap[];
}

export type ArchaeologyTransitionKind =
  | 'conversion'
  | 'migration'
  | 'entity-link'
  | 'creative-promotion'
  | 'branch-promotion';

export interface ArchaeologyTransition {
  id: string;
  projectId: string;
  kind: ArchaeologyTransitionKind;
  sourceKey: string;
  targetKey: string;
  evidenceId: string;
  createdAt: number;
  state: 'active' | 'undone';
  label?: string;
}

export interface ArchaeologyRevision {
  id: string;
  projectId: string;
  entityKey: string;
  snapshotId: string;
  title: string;
  reason: WritingSnapshot['reason'];
  wordCount: number;
  createdAt: number;
  /** Writing snapshots retain their body; reference-only links do not. */
  contentAvailable: true;
}

export interface IdeaArchaeology {
  nodes: StoryLensEntityNode[];
  transitions: ArchaeologyTransition[];
  revisions: ArchaeologyRevision[];
  originKeys: string[];
  endpointKeys: string[];
}

export interface ArchaeologyTraceNode {
  node: StoryLensEntityNode;
  depth: number;
}

export interface ArchaeologyTrace {
  selected: StoryLensEntityNode;
  ancestors: ArchaeologyTraceNode[];
  descendants: ArchaeologyTraceNode[];
  activeTransitions: ArchaeologyTransition[];
  undoneTransitions: ArchaeologyTransition[];
  revisions: ArchaeologyRevision[];
}

export interface StoryLensesReadModel {
  projectId: string;
  entities: StoryLensEntityNode[];
  constellation: MotifConstellation;
  archaeology: IdeaArchaeology;
}
