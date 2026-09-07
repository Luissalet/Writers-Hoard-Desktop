import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import {
  createCreativeBranch,
  stageBranchUpdate,
} from '@/services/branching';
import { generateId } from '@/utils/idGenerator';
import { buildSceneVariantBranchPlan, sceneTargetFingerprint } from './core';
import type {
  SceneLabStructuralTarget,
  SceneVariantPromotionPreview,
  SceneVariantPromotionResult,
} from './types';

function compactProvenance(preview: SceneVariantPromotionPreview): string {
  const serialized = JSON.stringify({
    version: 1,
    origin: 'scene-lab',
    variantId: preview.variantId,
    comparison: preview.comparison,
    provenance: preview.provenance,
    targetFingerprint: preview.targetFingerprint,
  });
  return serialized.length <= 20_000
    ? serialized
    : JSON.stringify({
        version: 1,
        origin: 'scene-lab',
        variantId: preview.variantId,
        provenance: preview.provenance,
        truncated: true,
      });
}

async function liveTarget(preview: SceneVariantPromotionPreview): Promise<SceneLabStructuralTarget> {
  if (preview.target.kind === 'outline-beat') {
    const row = await db.outlineBeats.get(preview.target.entityId);
    if (!row || row.projectId !== preview.projectId) throw new Error('The branch target is unavailable.');
    return {
      kind: 'outline-beat',
      entityId: row.id,
      projectId: row.projectId,
      title: row.title,
      description: row.description,
      revision: row.updatedAt,
    };
  }
  const row = await db.timelineEvents.get(preview.target.entityId);
  if (!row || row.projectId !== preview.projectId) throw new Error('The branch target is unavailable.');
  return {
    kind: 'timeline-event',
    entityId: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    revision: row.updatedAt,
  };
}

/**
 * Optional host adapter. It stages the preview in the existing branch kernel
 * and records a normal entity-link from the source scene to that branch. It
 * never promotes the branch or writes scene prose into canon.
 */
export async function stageSceneVariantAsBranch(
  preview: SceneVariantPromotionPreview,
): Promise<SceneVariantPromotionResult> {
  const plan = buildSceneVariantBranchPlan(preview);
  let branchId = '';

  await db.transaction('rw', [
    db.creativeBranches,
    db.creativeBranchDeltas,
    db.outlineBeats,
    db.timelineEvents,
    db.timelineConnections,
    db.entityLinks,
    db.scenes,
  ], async () => {
    const scene = await db.scenes.get(preview.sourceSceneId);
    if (!scene || scene.projectId !== preview.projectId) {
      throw new Error('The source scene is unavailable or belongs to another project.');
    }
    const target = await liveTarget(preview);
    if (sceneTargetFingerprint(target) !== plan.targetFingerprint) {
      throw new Error('The structural target changed after the preview. Review the variant again.');
    }

    const branch = await createCreativeBranch({
      projectId: plan.projectId,
      title: plan.branch.title,
      question: plan.branch.question,
      rootKind: plan.branch.rootKind,
      rootId: plan.branch.rootId,
    });
    branchId = branch.id;
    if (plan.delta.kind === 'outline-beat') {
      await stageBranchUpdate(branch.id, plan.delta.kind, plan.delta.entityId, plan.delta.changes);
    } else {
      await stageBranchUpdate(branch.id, plan.delta.kind, plan.delta.entityId, plan.delta.changes);
    }
    const now = Date.now();
    await db.entityLinks.add({
      id: generateId('scene-lab-link'),
      projectId: plan.projectId,
      sourceEngineId: 'dialog-scene',
      sourceEntityType: 'scene',
      sourceEntityId: scene.id,
      sourceTitle: scene.title,
      targetEngineId: 'creative-branches',
      targetEntityType: 'creative-branch',
      targetEntityId: branch.id,
      targetTitle: branch.title,
      relation: 'developed-into',
      notes: compactProvenance(preview),
      provenance: 'manual',
      createdAt: now,
      updatedAt: now,
    });
  });

  notifyDataChanged({ source: 'other', projectId: preview.projectId, entityId: branchId });
  return { branchId, label: preview.variantTitle };
}
