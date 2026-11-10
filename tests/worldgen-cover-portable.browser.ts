import '@/engines';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { generatedWorldOps } from '@/engines/worldgen/operations';
import { worldgenScopeOperations } from '@/engines/worldgen/era';
import { getWorldCover, saveWorldCover } from '@/engines/worldgen/worldCover';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { readProjectDuplicate, duplicateSnapshotVersion } from '@/services/projectDuplicate/capture';
import { listEraRows, mutateEraRows } from '@/services/worldEras/store';
import type { GeneratedWorld } from '@/engines/worldgen/types';
import { coverCheck, coverFixture, coverCleanTables, coverObserved } from './worldgen-cover-contract.browser';

async function runWorldCoverPortability() {
  const f = await coverFixture(), owned = new Set([f.projectId]), operationId = crypto.randomUUID();
  const save = async (scope: Parameters<typeof getWorldCover>[0], worldId: string, image: string | null, expectedRevision: number) => { const read = await getWorldCover(scope, worldId); return saveWorldCover(scope, worldId, image, expectedRevision, read.ownerToken); };
  try {
    await save(f.scope, f.worldId, f.A, 0);
    await mutateEraRows(f.past, [{ table: 'generatedWorlds', id: f.worldId, changes: { title: 'Own past cover world' } }]);
    await save(f.past, f.worldId, f.B, 1);
    const onlyId = f.worldId+'-era-only', removedId = f.worldId+'-removed';
    await worldgenScopeOperations(f.past).worlds.create({ ...f.world, id: onlyId, title: 'Era-only cover world' });
    await save(f.past, onlyId, f.A, 0);
    await generatedWorldOps.create({ ...f.world, id: removedId, title: 'Removed cover world' });
    await save(f.scope, removedId, f.B, 0);
    await save(f.scope, removedId, null, 1);

    async function verify(projectId: string, copied: boolean) {
      const project = await db.projects.get(projectId), eraId = project?.worldEras?.find(row => row.name === 'past')?.id;
      coverCheck(eraId, 'Portable own era missing');
      const rows = await db.generatedWorlds.where('projectId').equals(projectId).toArray();
      const base = rows.find(row => row.title === f.world.title), control = rows.find(row => row.title === 'Control world'), removed = rows.find(row => row.title === 'Removed cover world');
      coverCheck(base && control && removed && rows.length === 3, 'Portable Base/control/removed rows missing');
      coverCheck(rows.every(row => row.projectId === projectId) && (!copied || base.id !== f.worldId && removed.id !== removedId), 'Portable rows have wrong actual identities/owners');
      const scope = { projectId, eraId }, eraRows = await listEraRows<GeneratedWorld>(scope, 'generatedWorlds');
      const own = eraRows.find(row => row.title === 'Own past cover world'), only = eraRows.find(row => row.title === 'Era-only cover world');
      coverCheck(own && only && own.id === base.id && only.projectId === projectId && !rows.some(row => row.id === only.id), 'Own/era-only identity or Base isolation lost');
      const [baseCover, ownCover, onlyCover, removedCover, legacy] = await Promise.all([getWorldCover({ projectId }, base.id), getWorldCover(scope, own.id), getWorldCover(scope, only.id), getWorldCover({ projectId }, removed.id), getWorldCover({ projectId }, control.id)]);
      coverCheck(baseCover.coverImage === f.A && baseCover.revision === 1 && !baseCover.scope.eraId, 'Base cover bytes/revision/owner lost');
      coverCheck(ownCover.coverImage === f.B && ownCover.revision === 2 && ownCover.scope.eraId === eraId, 'Own-era bytes/revision/owner lost');
      coverCheck(onlyCover.coverImage === f.A && onlyCover.revision === 1 && onlyCover.scope.eraId === eraId, 'Era-only cover lost');
      coverCheck(removedCover.coverImage === null && removedCover.revision === 2 && legacy.coverImage === null && legacy.revision === 0 && !Object.hasOwn(control, 'coverImage') && !Object.hasOwn(control, 'coverRevision'), 'Effective removal or untouched legacy lost');
      coverCheck(JSON.stringify(base.params) === JSON.stringify(f.world.params) && base.edits === f.world.edits && base.thumbnail === f.world.thumbnail && base.mapWidthKm === f.world.mapWidthKm && base.scaleRevision === f.world.scaleRevision, 'Portability changed terrain/thumbnail/calibration');
      const variant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([projectId, eraId, 'worldgen', own.id]).first();
      coverCheck(variant?.history?.some(state => state.document?.root.coverImage === f.A && state.document.root.coverRevision === 1), 'Previous own cover bytes/history lost');
      return { projectId, baseId: base.id, ownId: own.id, onlyId: only.id, baseImage: baseCover.coverImage, ownImage: ownCover.coverImage, onlyImage: onlyCover.coverImage, removedRevision: removedCover.revision, historyRetained: true };
    }
    const original = await verify(f.projectId, false), sourceVersion = await duplicateSnapshotVersion(await readProjectDuplicate(f.projectId));
    const originalExport = JSON.stringify(await exportProjectData(f.projectId));
    const jsonId = await importProjectData(JSON.parse(originalExport)); owned.add(jsonId);
    const json = await verify(jsonId, true);
    const preview = await previewProjectDuplicate({ projectId: f.projectId });
    const copy = await duplicateProject({ projectId: f.projectId, title: 'Owned portable cover copy', operationId, expectedSourceVersion: preview.sourceVersion });
    owned.add(copy.projectId); coverCheck(copy.complete, 'Normal duplicate not complete');
    const duplicate = await verify(copy.projectId, true);
    coverCheck(await duplicateSnapshotVersion(await readProjectDuplicate(f.projectId)) === sourceVersion, 'JSON/copy changed source/control snapshot');
    const zip = await createProjectZipArchive(f.projectId); coverCheck(zip.blob.size > 0, 'Empty actual ZIP');
    await deleteProject(f.projectId);
    const restored = await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }));
    coverCheck(restored.length === 1 && restored[0] === f.projectId, 'ZIP restored different project identity');
    const zipResult = await verify(f.projectId, false);
    coverCheck(!(await db.worldSnapshots.count()) && !(await db.canonTiles.count()) && !(await db.renderedTiles.count()), 'Portability materialized terrain caches');
    return [`WORLD_COVER_PORTABLE ${JSON.stringify({ original, json, duplicate, zip: zipResult, zipBytes: zip.blob.size, sourceVersion, sourceIntactBeforeZip: true, exportSerializedBytes: originalExport.length })}`];
  } finally {
    for (const id of owned) await deleteProject(id);
    await db.settings.delete('projectDuplicate.operation.'+operationId);
    await coverCleanTables();
  }
}

export const testWorldCoverPortability = () => coverObserved(runWorldCoverPortability);
