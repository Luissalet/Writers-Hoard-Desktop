import { canonicalJson, sha256Hex } from '@/services/aiRuntime/recipe';
import type {
  SceneLabSource,
  SceneLabStructuralTarget,
  SceneVariant,
  SceneVariantBranchPlan,
  SceneVariantPromotionPreview,
  SceneVariable,
} from './types';

function trimmed(value: string): string {
  return value.trim();
}

export function normalizeSceneTension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10, Math.max(0, Math.round(value)));
}

export function sceneSourceFingerprint(source: SceneLabSource): string {
  return sha256Hex(canonicalJson({
    id: source.id,
    projectId: source.projectId,
    title: source.title,
    text: source.text,
    intention: source.intention,
    tension: normalizeSceneTension(source.tension),
    voice: source.voice,
    revision: source.revision,
  }));
}

export function sceneTargetFingerprint(target: SceneLabStructuralTarget): string {
  return sha256Hex(canonicalJson({
    kind: target.kind,
    entityId: target.entityId,
    projectId: target.projectId,
    title: target.title,
    description: target.description,
    revision: target.revision,
  }));
}

export function createSceneVariant(input: {
  id: string;
  source: SceneLabSource;
  variable: SceneVariable;
  value: string;
  title?: string;
  createdAt: number;
}): SceneVariant {
  const id = trimmed(input.id);
  const value = trimmed(input.value);
  if (!id) throw new Error('A scene variant needs an id.');
  if (!trimmed(input.source.projectId)) throw new Error('A scene variant needs a project.');
  if (!value) throw new Error('Declare how the selected variable changes.');

  const title = trimmed(input.title ?? '') || `${trimmed(input.source.title) || 'Scene'}: ${value}`;
  return {
    id,
    projectId: input.source.projectId,
    sourceSceneId: input.source.id,
    title,
    variable: { kind: input.variable, value },
    intention: input.source.intention,
    tension: normalizeSceneTension(input.source.tension),
    voice: input.source.voice,
    text: input.source.text,
    status: 'active',
    provenance: {
      version: 1,
      origin: 'scene-lab',
      source: {
        sceneId: input.source.id,
        projectId: input.source.projectId,
        title: input.source.title,
        ...(input.source.revision === undefined ? {} : { revision: input.source.revision }),
        baselineHash: sceneSourceFingerprint(input.source),
      },
      declaredVariable: { kind: input.variable, value },
      createdAt: input.createdAt,
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function updateSceneVariant(
  variant: SceneVariant,
  changes: Partial<Pick<SceneVariant, 'title' | 'intention' | 'tension' | 'voice' | 'text'>>,
  updatedAt: number,
): SceneVariant {
  if (variant.status !== 'active') throw new Error('A promoted scene variant is read-only.');
  return {
    ...variant,
    ...changes,
    title: changes.title === undefined ? variant.title : changes.title,
    intention: changes.intention === undefined ? variant.intention : changes.intention,
    tension: changes.tension === undefined ? variant.tension : normalizeSceneTension(changes.tension),
    voice: changes.voice === undefined ? variant.voice : changes.voice,
    text: changes.text === undefined ? variant.text : changes.text,
    updatedAt,
  };
}

export function toggleSceneComparison(current: readonly string[], variantId: string): string[] {
  if (current.includes(variantId)) return current.filter((id) => id !== variantId);
  return [...current.slice(-1), variantId];
}

export function buildSceneVariantPromotionPreview(input: {
  variant: SceneVariant;
  target: SceneLabStructuralTarget;
  title: string;
  description: string;
}): SceneVariantPromotionPreview {
  if (input.variant.projectId !== input.target.projectId) {
    throw new Error('The scene variant and branch target must belong to one project.');
  }
  const after = { title: trimmed(input.title), description: trimmed(input.description) };
  if (!after.title) throw new Error('The structural proposal needs a title.');
  const before = { title: input.target.title, description: input.target.description };
  const changedFields: SceneVariantPromotionPreview['changedFields'] = [];
  if (before.title !== after.title) changedFields.push('title');
  if (before.description !== after.description) changedFields.push('description');

  return {
    version: 1,
    projectId: input.variant.projectId,
    variantId: input.variant.id,
    sourceSceneId: input.variant.sourceSceneId,
    variantTitle: input.variant.title,
    target: { ...input.target },
    before,
    after,
    changedFields,
    structuralDelta: {
      kind: input.target.kind,
      entityId: input.target.entityId,
      changes: after,
    },
    comparison: {
      intention: input.variant.intention,
      tension: input.variant.tension,
      voice: input.variant.voice,
    },
    provenance: {
      ...input.variant.provenance,
      source: { ...input.variant.provenance.source },
      declaredVariable: { ...input.variant.provenance.declaredVariable },
    },
    targetFingerprint: sceneTargetFingerprint(input.target),
    canPromote: input.variant.status === 'active' && changedFields.length > 0,
  };
}

export function buildSceneVariantBranchPlan(
  preview: SceneVariantPromotionPreview,
): SceneVariantBranchPlan {
  if (!preview.canPromote) throw new Error('The scene variant has no structural change to stage.');
  return {
    projectId: preview.projectId,
    branch: {
      title: preview.variantTitle,
      question: `${preview.provenance.declaredVariable.kind}: ${preview.provenance.declaredVariable.value}`,
      rootKind: preview.target.kind,
      rootId: preview.target.entityId,
    },
    delta: {
      kind: preview.structuralDelta.kind,
      entityId: preview.structuralDelta.entityId,
      changes: { ...preview.structuralDelta.changes },
    },
    provenance: {
      ...preview.provenance,
      source: { ...preview.provenance.source },
      declaredVariable: { ...preview.provenance.declaredVariable },
    },
    targetFingerprint: preview.targetFingerprint,
  };
}
