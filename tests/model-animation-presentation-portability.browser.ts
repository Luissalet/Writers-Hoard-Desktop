import { db } from '@/db';
import type { Project } from '@/types';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { assetFromFile, removeModelAsset } from '@/engines/model-viewer/model';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { readWorldDocument, saveWorldEra, restoreEraVersion } from '@/services/worldEras/store';
import { resolveEraDocumentAssets } from '@/services/worldEras/assets';
import { worldDocumentCloner } from '@/services/worldEras/portability';
import type { WorldEraAsset } from '@/services/worldEras/types';
import { getDocumentHistory, readHistoryPresent, saveDocumentHistory, restoreDocumentHistory } from '@/services/documentHistory/store';
import { restoreArchivedDocument } from '@/services/documentArchive/store';
import { previewProjectDuplicate, duplicateProject, undoProjectDuplicate } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { modelAnimationPresentationFixture } from './model-animation-presentation-fixture';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, item]) => item !== undefined).map(([key, item]) => [key, canonical(item)])); return value; }
const encoded = (value: unknown) => JSON.stringify(canonical(value));
const equal = (a: unknown, b: unknown, message: string) => check(encoded(a) === encoded(b), message);
const all = async () => encoded(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
async function rejects(run: () => unknown, message: string) { let failed = false; try { await run(); } catch { failed = true; } check(failed, message); }

export async function testModelAnimationPresentationPortability() {
  const P = 'synthetic-clips-portable', C = P + '-control', copies: string[] = [], duplicateOperations: string[] = [], passed: string[] = [];
  const project: Project = { id: P, title: 'Synthetic clip portability', description: '', mode: 'novelist', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['model-viewer', 'tables'], createdAt: 1, updatedAt: 1, dataTables: [{ id: P + '-table', title: 'Other metadata kind', mode: 'table', columns: [], rows: [] }] };
  try {
    const model = await assetFromFile(new File([await modelAnimationPresentationFixture()], 'Portable-clips.glb'));
    await db.projects.bulkAdd([{ ...project, modelAssets: [model] }, { ...project, id: C, modelAssets: [{ ...model, id: model.id + '-control' }], dataTables: [] }]);
    const controlBefore = await db.projects.get(C), scope = { projectId: P };
    const edit = async (args: Record<string, unknown>, eraId?: string) => {
      const current = await runBridgeTool('wh_model_animation_get', { ...scope, eraId, modelId: model.id }); check(current.ok, 'Read for portability edit failed');
      const result = await runBridgeTool('wh_model_animation_action', { ...scope, eraId, modelId: model.id, expectedVersion: (current.result as {version:string}).version, ...args }); check(result.ok, 'Portability edit failed: ' + JSON.stringify(result));
    };
    await edit({ action: 'rename', index: 1, label: 'Portable lift' }); await edit({ action: 'move', index: 1, position: 0 });
    const authored = (await db.projects.get(P))!.modelAssets![0];
    const manual = await saveDocumentHistory(P, 'model-viewer', model.id, (await readHistoryPresent(P, 'model-viewer', model.id))!.version);
    await saveDocumentHistory(P, 'tables', project.dataTables![0].id, (await readHistoryPresent(P, 'tables', project.dataTables![0].id))!.version);
    await edit({ action: 'rename', index: 1, label: 'Temporary later label' });
    await restoreDocumentHistory(P, 'model-viewer', model.id, manual.id, (await readHistoryPresent(P, 'model-viewer', model.id))!.version);
    equal((await db.projects.get(P))!.modelAssets![0], authored, 'Normal history restore lost presentation or changed binary');
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    await edit({ action: 'rename', index: 2, label: 'First retained era label' }, 'past');
    const firstEra = await readWorldDocument({ projectId: P, eraId: 'past' }, 'model-viewer', model.id); check(firstEra?.variantRevision, 'First era variant missing');
    await edit({ action: 'rename', index: 2, label: 'Later era label' }, 'past');
    const laterEra = (await readWorldDocument({ projectId: P, eraId: 'past' }, 'model-viewer', model.id))!;
    await restoreEraVersion({ projectId: P, eraId: 'past' }, 'model-viewer', model.id, laterEra.variantRevision!, firstEra.variantRevision);
    equal((await readWorldDocument({ projectId: P, eraId: 'past' }, 'model-viewer', model.id))!.document.root.animationPresentation, firstEra.document.root.animationPresentation, 'Era history restore lost the earlier sidecar');
    const variants = await db.worldEraVariants.where('projectId').equals(P).toArray(), assets = await db.worldEraAssets.where('projectId').equals(P).toArray(), histories = await db.documentHistory.where('projectId').equals(P).toArray();
    const modelVariant = variants.find(item => item.kind === 'model-viewer')!;
    check(typeof modelVariant.document?.root.__worldEraAssetId === 'string' && !Object.hasOwn(modelVariant.document.root, 'dataUrl'), 'Stored era unexpectedly inlines binary');
    const remap = (id: string, prefix: string) => prefix + '-copy-' + id;
    const clone = worldDocumentCloner([...variants, ...histories], (await db.projects.get(P))!, P + '-mapped', remap, {}, assets);
    const cloned = clone('model-viewer', modelVariant.document!);
    check(cloned.root.__worldEraAssetId === remap(String(modelVariant.document!.root.__worldEraAssetId), 'era-asset') && !Object.hasOwn(cloned.root, 'dataUrl') && !Object.hasOwn(cloned.root, 'sourceFiles'), 'Internal validation hydration leaked inline binary or lost mapped reference');
    equal(cloned.root.animationPresentation, modelVariant.document!.root.animationPresentation, 'Cloner rewrote source-index sidecar');
    const tableHistory = histories.find(item => item.kind === 'tables')!; clone('tables', tableHistory.document);
    const sourceProject = (await db.projects.get(P))!;
    for (const badAssets of [[], assets.map(item => ({ ...item, projectId: C }))]) await rejects(() => worldDocumentCloner([...variants, ...histories], sourceProject, P + '-invalid', remap, {}, badAssets), 'Missing/cross-project model asset reference was trusted');
    passed.push('History and era-version restores preserve metadata; internal remapper validates hydrated models for model and other-kind catalogues but keeps mapped immutable references thin');

    const summarize = async (id: string) => {
      const rows = await db.worldEraVariants.where('projectId').equals(id).toArray();
      const documents = [];
      for (const row of rows.filter(item => item.kind === 'model-viewer')) for (const state of [row, ...row.history ?? []]) if (state.document) {
        check(!Object.hasOwn(state.document.root, 'dataUrl') && typeof state.document.root.__worldEraAssetId === 'string', 'Copied retained variant gained inline binary');
        const root = (await resolveEraDocumentAssets(id, state.document)).root;
        documents.push({ name: root.name, dataUrl: root.dataUrl, sourceFiles: root.sourceFiles, animationPresentation: root.animationPresentation });
      }
      const retained = [];
      for (const row of (await db.documentHistory.where('projectId').equals(id).toArray()).filter(item => item.kind === 'model-viewer')) {
        check(!Object.hasOwn(row.document.root, 'dataUrl') && typeof row.document.root.__worldEraAssetId === 'string', 'Copied document history gained inline binary');
        const root = (await getDocumentHistory(id, 'model-viewer', row.entityId, row.id)).document.root;
        retained.push({ name: root.name, dataUrl: root.dataUrl, sourceFiles: root.sourceFiles, animationPresentation: root.animationPresentation });
      }
      return { variants: documents.map(encoded).sort(), history: retained.map(encoded).sort() };
    };
    const retainedBefore = await summarize(P), sourceData = await exportProjectData(P);
    const jsonId = await importProjectData(JSON.parse(JSON.stringify(sourceData))); copies.push(jsonId);
    equal(await summarize(jsonId), retainedBefore, 'Actual JSON clone lost retained variants/history sidecars or binary bytes');
    const copied = (await db.projects.get(jsonId))!.modelAssets![0];
    check(copied.id !== model.id && copied.dataUrl === model.dataUrl, 'JSON clone did not remap model identity or changed binary');
    equal(copied.animationPresentation, authored.animationPresentation, 'JSON clone lost source-index order/labels');
    const preview = await previewProjectDuplicate({ projectId: P }); check(preview.canDuplicate, 'Normal Duplicate unavailable');
    const operationId = crypto.randomUUID(), duplicate = await duplicateProject({ projectId: P, title: 'Synthetic independent clips copy', operationId, expectedSourceVersion: preview.sourceVersion });
    copies.push(duplicate.projectId); duplicateOperations.push(operationId); check(duplicate.complete && !duplicate.unfinished.length, 'Normal Duplicate incomplete');
    equal((await db.projects.get(duplicate.projectId))!.modelAssets![0].animationPresentation, authored.animationPresentation, 'Duplicate lost presentation');
    equal(await summarize(duplicate.projectId), retainedBefore, 'Normal Duplicate lost retained variants/history or binary bytes');
    const zip = await createProjectZipArchive(P); await edit({ action: 'reset' });
    const imported = await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }), { replaceProjectIds: [P] }); check(imported.includes(P), 'ZIP did not restore own project');
    equal((await db.projects.get(P))!.modelAssets![0], authored, 'Actual ZIP replacement did not restore exact model/sidecar/binary');
    equal(await summarize(P), retainedBefore, 'ZIP lost retained variant/history sidecars or binary');
    passed.push('Actual JSON clone, complete normal Duplicate and ZIP replacement preserve Base plus every retained variant/history sidecar and binary while remapping only document/asset identities');

    await removeModelAsset(P, model.id); const archive = await db.documentArchives.where('projectId').equals(P).filter(item => item.sourceId === model.id && item.kind === 'model-viewer').last(); check(archive, 'Normal model removal did not archive');
    await restoreArchivedDocument(P, archive.id); equal((await db.projects.get(P))!.modelAssets![0], authored, 'Normal archive/restore lost exact sidecar or GLB');
    const beforeForged = await all();
    for (const reference of ['missing-local-asset', assets[0].id]) {
      const malformed = structuredClone(sourceData), modelRow = malformed.project!.modelAssets![0] as unknown as Record<string, unknown>;
      delete modelRow.dataUrl; modelRow.__worldEraAssetId = reference;
      await rejects(() => importProjectData(malformed), 'External project model trusted a forged thin binary marker');
      check(await all() === beforeForged, 'Forged marker import left partial writes');
    }
    const foreignAssets = structuredClone(sourceData); foreignAssets.worldEraAssets = (foreignAssets.worldEraAssets as WorldEraAsset[]).map(item => ({ ...item, projectId: C }));
    await rejects(() => importProjectData(foreignAssets), 'External archive accepted cross-project retained asset'); check(await all() === beforeForged, 'Cross-project retained asset rejection wrote data');
    equal(await db.projects.get(C), controlBefore, 'Portability changed control project');
    passed.push('Normal archive/restore is exact; external forged model markers and cross-project retained assets reject before writes, preserving control data');
    return passed;
  } finally {
    for (const operation of duplicateOperations) await undoProjectDuplicate(operation);
    for (const id of copies) if (await db.projects.get(id)) await deleteProject(id);
    await deleteProject(P); await deleteProject(C);
  }
}
