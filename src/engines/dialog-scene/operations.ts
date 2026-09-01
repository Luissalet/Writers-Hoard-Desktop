import {
  makeTableOps,
  reorderItems,
  makeCascadeDeleteOp,
  deleteEntityAnnotations,
} from '@/engines/_shared';
import { db } from '@/db';
import type { Scene, DialogBlock, SceneCast } from './types';
import type { OutlineBeat } from '@/engines/outline/types';

// ===== Scenes =====
const sceneOps = makeTableOps<Scene>({
  tableName: 'scenes',
  scopeField: 'projectId',
  sortFn: (a, b) => a.order - b.order,
});

export const getScenes = sceneOps.getAll;
export const getScene = sceneOps.getOne;
export const createScene = sceneOps.create;
export const updateScene = sceneOps.update;

// deleteScene cascades to blocks and cast
const deleteSceneRow = makeCascadeDeleteOp({
  tableName: 'scenes',
  cascades: [
    { table: 'dialogBlocks', foreignKey: 'sceneId' },
    { table: 'sceneCasts', foreignKey: 'sceneId' },
  ],
});

/**
 * Borrar una escena, y DESVINCULAR los beats del esquema que apuntaban a ella.
 *
 * La cascada de arriba se llevaba los bloques y el reparto —lo que sólo existe
 * dentro de la escena— pero dejaba `outlineBeats.linkedSceneId` apuntando a un
 * id muerto, aunque este mismo fichero conoce la relación: la consulta
 * `getLinkedBeats`, treinta líneas más abajo.
 *
 * El síntoma no era un error, que es lo que lo hacía invisible: era un contador
 * que mentía. `services/projectIntelligence.ts` cuenta un beat como conectado
 * con sólo mirar si `linkedSceneId` tiene valor, sin comprobar que la escena
 * exista, y de ahí sale el medidor «beats del esquema conectados» del Cockpit.
 * Con punteros muertos ese medidor **sólo podía subir**: borrases las escenas
 * que borrases, la cobertura de tu esquema seguía marcando lo mismo.
 *
 * Se desvincula, no se borra: el beat es texto del autor y sobrevive sin
 * escena, listo para volver a enlazarse. Es la misma política de
 * `deleteCodexEntry` — se borra lo que es puro vínculo, se desvincula lo que
 * alguien escribió.
 *
 * Las notas al margen ancladas en la escena sí son puro vínculo: se van con
 * ella, junto con sus filas de referencia.
 */
export async function deleteScene(id: string): Promise<void> {
  await db.transaction(
    'rw',
    ['scenes', 'dialogBlocks', 'sceneCasts', 'outlineBeats', 'annotations', 'annotationReferences'],
    async () => {
      const orphaned = await getLinkedBeats(id);
      for (const beat of orphaned) {
        await db.table('outlineBeats').update(beat.id, { linkedSceneId: undefined });
      }
      await deleteEntityAnnotations('dialog-scene', id);
      await deleteSceneRow(id);
    },
  );
}

export async function reorderScenes(projectId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('scenes', 'projectId', projectId, orderedIds);
}

/** Auto-number all non-locked scenes. Omitted scenes keep their number but are prefixed visually. */
export async function autoNumberScenes(projectId: string): Promise<void> {
  const scenes = await getScenes(projectId);
  let nextNumber = 1;
  for (const scene of scenes) {
    if (scene.isLocked) {
      // locked scenes keep their number; advance counter past them
      if (scene.sceneNumber && scene.sceneNumber >= nextNumber) {
        nextNumber = scene.sceneNumber + 1;
      }
      continue;
    }
    await updateScene(scene.id, { sceneNumber: nextNumber });
    nextNumber++;
  }
}

// ===== Dialog Blocks =====
const blockOps = makeTableOps<DialogBlock>({
  tableName: 'dialogBlocks',
  scopeField: 'sceneId',
  sortFn: (a, b) => a.order - b.order,
});

export const getDialogBlocks = blockOps.getAll;
export const createDialogBlock = blockOps.create;
export const updateDialogBlock = blockOps.update;
export const deleteDialogBlock = blockOps.delete;

export async function reorderDialogBlocks(sceneId: string, orderedIds: string[]): Promise<void> {
  await reorderItems('dialogBlocks', 'sceneId', sceneId, orderedIds);
}

// ===== Scene Cast (non-standard CRUD — kept manual) =====
export async function getSceneCast(sceneId: string): Promise<SceneCast[]> {
  return db.table('sceneCasts').where('sceneId').equals(sceneId).toArray();
}

export async function addCastMember(cast: SceneCast): Promise<string> {
  return (await db.table('sceneCasts').add(cast)) as string;
}

export async function removeCastMember(id: string): Promise<void> {
  await db.table('sceneCasts').delete(id);
}

export async function updateCastMember(id: string, changes: Partial<SceneCast>): Promise<void> {
  await db.table('sceneCasts').update(id, changes);
}

// ===== Cross-engine queries =====

/** Find all outline beats linked to a specific scene */
export async function getLinkedBeats(sceneId: string): Promise<OutlineBeat[]> {
  return db.table('outlineBeats')
    .filter((beat: OutlineBeat) => beat.linkedSceneId === sceneId)
    .toArray();
}
