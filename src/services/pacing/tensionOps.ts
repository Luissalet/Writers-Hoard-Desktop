import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { findSceneAnchor, measure, resolveTensions, sceneAnchor, splitScenes, type SceneAnchor, type SceneTension } from '@/engines/writings/pacing/pacing';
import { eraWritingOperations } from '@/services/worldEras/writings';
import type { WorldEraScope } from '@/services/worldEras/types';
import { pacingText } from './report';

export interface SceneTensionReceipt {
  writingId: string;
  anchor: SceneAnchor;
  before: number | null;
  after: number | null;
  replaced: SceneTension[];
}

interface TensionChange {
  tension: number | null;
  expected?: number | null;
  restore?: SceneTension[];
}

async function changeSceneTension(
  scope: WorldEraScope, writingId: string, target: number | SceneAnchor, { tension, expected, restore }: TensionChange,
): Promise<SceneTensionReceipt> {
  if (typeof target === 'number' && (!Number.isInteger(target) || target < 0)) throw new Error('sceneIndex must be a non-negative integer.');
  if (tension !== null && (!Number.isFinite(tension) || tension < 0 || tension > 1)) throw new Error('Tension must be a number from 0 to 1, or null.');

  const ops = eraWritingOperations(scope);
  const receipt = await db.transaction('rw', scope.eraId ? db.tables : [db.writings], async () => {
    const writing = await ops.getWriting(writingId);
    if (!writing || writing.projectId !== scope.projectId) throw new Error('The chapter no longer exists in this project.');
    const anchors = splitScenes(pacingText(writing.content)).flatMap((paragraphs, index) => (
      measure(paragraphs).words ? [sceneAnchor(paragraphs, index)] : []
    ));
    const anchor = typeof target === 'number' ? anchors.find((item) => item.index === target) : findSceneAnchor(anchors, target);
    if (!anchor) throw new Error('The scene no longer exists in this chapter.');
    const values = writing.sceneTension ?? [];
    const current = resolveTensions(anchors, values).get(anchor.index);
    const before = current?.value ?? null;
    if (expected !== undefined && before !== expected) throw new Error('The scene tension changed in the meantime.');
    const replaced: SceneTension[] = [];
    if (before !== tension) {
      const next = values.filter((value) => {
        if (findSceneAnchor(anchors, value)?.index !== anchor.index) return true;
        replaced.push(value);
        return false;
      });
      if (restore) next.unshift(...restore);
      else if (tension !== null) next.push({ ...anchor, value: tension });
      await ops.updateWriting(writingId, { sceneTension: next.length ? next : undefined });
    }
    return { writingId, anchor, before, after: tension, replaced };
  });
  if (receipt.before !== receipt.after) notifyDataChanged({ source: 'other', projectId: scope.projectId, table: 'writings', entityId: writingId });
  return receipt;
}

export function setSceneTension(
  scope: WorldEraScope, writingId: string, target: number | SceneAnchor, tension: number | null, expected?: number | null,
): Promise<SceneTensionReceipt> {
  return changeSceneTension(scope, writingId, target, { tension, expected });
}

export async function undoSceneTension(scope: WorldEraScope, receipt: SceneTensionReceipt): Promise<void> {
  await changeSceneTension(scope, receipt.writingId, receipt.anchor, { tension: receipt.before, expected: receipt.after, restore: receipt.replaced });
}
