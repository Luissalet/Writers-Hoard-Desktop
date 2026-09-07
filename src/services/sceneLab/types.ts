import type { BranchEntityKind } from '@/services/branching';

export const SCENE_VARIABLES = [
  'pov',
  'objective',
  'location',
  'entry-order',
  'information',
  'cost',
  'outcome',
  'tone',
] as const;

export type SceneVariable = (typeof SCENE_VARIABLES)[number];
export type SceneBranchTargetKind = Extract<BranchEntityKind, 'outline-beat' | 'timeline-event'>;

/** Read-only projection supplied by the host. Scene Lab never persists it. */
export interface SceneLabSource {
  id: string;
  projectId: string;
  title: string;
  text: string;
  intention: string;
  tension: number;
  voice: string;
  revision?: number;
}

/** A canonical structural anchor that can root an existing creative branch. */
export interface SceneLabStructuralTarget {
  kind: SceneBranchTargetKind;
  entityId: string;
  projectId: string;
  title: string;
  description: string;
  /** `updatedAt` from the canonical beat or event, used for stale-preview refusal. */
  revision: number;
}

export interface SceneVariantProvenance {
  version: 1;
  origin: 'scene-lab';
  source: {
    sceneId: string;
    projectId: string;
    title: string;
    revision?: number;
    baselineHash: string;
  };
  declaredVariable: {
    kind: SceneVariable;
    value: string;
  };
  createdAt: number;
}

export type SceneVariantStatus = 'active' | 'promoted';

/** Session-only prose experiment. No Dexie table owns this shape. */
export interface SceneVariant {
  id: string;
  projectId: string;
  sourceSceneId: string;
  title: string;
  variable: { kind: SceneVariable; value: string };
  intention: string;
  tension: number;
  voice: string;
  text: string;
  status: SceneVariantStatus;
  provenance: SceneVariantProvenance;
  createdAt: number;
  updatedAt: number;
  promotion?: {
    branchId: string;
    label?: string;
    promotedAt: number;
  };
}

export interface SceneVariantPromotionPreview {
  version: 1;
  projectId: string;
  variantId: string;
  sourceSceneId: string;
  variantTitle: string;
  target: SceneLabStructuralTarget;
  before: { title: string; description: string };
  after: { title: string; description: string };
  changedFields: Array<'title' | 'description'>;
  /** Deliberately excludes prose: the branch kernel only receives structure. */
  structuralDelta: {
    kind: SceneBranchTargetKind;
    entityId: string;
    changes: { title: string; description: string };
  };
  comparison: {
    intention: string;
    tension: number;
    voice: string;
  };
  provenance: SceneVariantProvenance;
  targetFingerprint: string;
  canPromote: boolean;
}

export interface SceneVariantBranchPlan {
  projectId: string;
  branch: {
    title: string;
    question: string;
    rootKind: SceneBranchTargetKind;
    rootId: string;
  };
  delta: SceneVariantPromotionPreview['structuralDelta'];
  provenance: SceneVariantProvenance;
  targetFingerprint: string;
}

export interface SceneVariantPromotionResult {
  branchId: string;
  label?: string;
}
