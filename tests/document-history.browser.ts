import Dexie from 'dexie';
import { updateWorkspaceLibrary } from '@/components/project/workspace/library/store';
import { assetFromFile } from '@/engines/model-viewer/model';
import { modelViewerFixture } from './model-viewer-fixture';
import { db } from '@/db';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import { exportProjectData, importProjectData, exportFullDatabase, importFullDatabase } from '@/db/operations';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import { eraAdapters } from '@/services/worldEras/adapters';
import { eraDocumentKinds, type EraDocumentKind, type EraRow } from '@/services/worldEras/types';
import { createRadarChart } from '@/engines/radar/model';
import { createSheet } from '@/engines/character-sheets/types';
import { listDocumentHistory, getDocumentHistory, readHistoryPresent, restoreDocumentHistory, undoDocumentHistory } from '@/services/documentHistory/store';
const assert = (value: unknown, message: string): asserts value => { if (!value) throw Error(message); };
export async function testDocumentHistory(): Promise<string[]> {
 const P = 'synthetic-document-history', passed: string[] = []; let clone: string|undefined;
 const project: Project = { id: P, title: 'History', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1 };
 const metadata: Record<string, unknown> = {'local-tool':{id:'local-tool',namespace:'tests.history-tool',title:'Source document',revision:1,createdAt:1,updatedAt:1,data:{notes:'Opaque source prose',linked:{kind:'codex',documentId:'codex'}},codec:{version:1,fields:{notes:{kind:'prose'},linked:{kind:'reference'}}}}, dictionary: { id: 'dictionary', name: 'Language', description: '', scriptMapping: '', detectInManuscript: false, words: [] }, tables: { id: 'tables', title: 'Table', mode: 'table', columns: [], rows: [] }, genealogy: { id: 'genealogy', title: 'Tree', nodes: [], edges: [], revision: 0, createdAt: 1, updatedAt: 1 }, 'character-sheets': { ...createSheet('coc7'), id: 'character-sheets' }, radar: { ...createRadarChart(), id: 'radar' }, 'model-viewer': { ...await assetFromFile(new File([await modelViewerFixture()], 'Model.glb')), id: 'model-viewer' } };
 try {
  await db.projects.put(project);
  for (const kind of eraDocumentKinds) {
   const adapter = eraAdapters[kind];
   if (adapter.metadata) await db.projects.update(P, { [adapter.metadata]: [metadata[kind]] });
   else { const root = { id: kind, projectId: P, title: kind, content: 'Original', fields: {}, relations: [], tags: [], status: 'draft', order: 0, createdAt: 1, updatedAt: 1, ...(kind === 'media' ? { blob: new Blob(['ABCD'], {type:'audio/wav'}), kind:'audio', mime:'audio/wav', size:4,notes:'',linkedEntryIds:[] } : {}) };
    await db.transaction('rw', db.tables, async () => { await db.table(adapter.table!).put(root); for (const [table,parent] of Object.entries(kind === 'writings' ? {} : adapter.children ?? {})) await db.table(table).put({id:table,projectId:P,[parent]:kind,content:'Original child',...(table==='boardNodes'?{richContent:`<div data-wh-codex-block="true" data-project-id="${P}" data-entry-id="codex"></div>`}:{})}); });
   }
  }
  assert(await db.documentHistory.where('projectId').equals(P).count() === 0, 'Creation captured partial aggregate');
  for (const kind of eraDocumentKinds) {
   const before = (await readHistoryPresent(P,kind,kind))!; assert(before, `Missing ${kind}`);
   const adapter = eraAdapters[kind];
   if (adapter.metadata) { const project = (await db.projects.get(P))!, rows = project[adapter.metadata] as EraRow[]; await db.projects.update(P,{[adapter.metadata]: rows.map(row=>({...row,...('name' in row?{name:'Edited'}:{title:'Edited'})}))}); }
   else await db.transaction('rw', db.tables, async () => { const child=Object.entries(kind === 'writings' ? {} : adapter.children ?? {})[0]; if(child) await db.table(child[0]).update(child[0],{content:'Edited child'}); await db.transaction('rw',db.table(adapter.table!),async()=>{ await db.table(adapter.table!).update(kind,{title:'Edited'}); }); });
   const history=await listDocumentHistory(P,kind,kind); assert(history.length===1,`Capture count ${kind}: ${history.length}`);
   const saved=await getDocumentHistory(P,kind,kind,history[0].id); assert(saved.version===before.version,`Preimage ${kind}`);
   const current=(await readHistoryPresent(P,kind,kind))!; const restored=await restoreDocumentHistory(P,kind,kind,history[0].id,current.version);
   assert(restored.undo,`Undo receipt ${kind}`); assert((await readHistoryPresent(P,kind,kind))!.document.root['name' in before.document.root?'name':'title']===before.document.root['name' in before.document.root?'name':'title'],`Restore ${kind}`);
   assert(JSON.stringify((await readHistoryPresent(P,kind,kind))!.document.children)===JSON.stringify(before.document.children),`Restored child content/identity ${kind}`);
   await undoDocumentHistory(restored.undo); assert((await readHistoryPresent(P,kind,kind))!.document.root['name' in before.document.root?'name':'title']==='Edited',`Undo ${kind}`);
  }
  passed.push('All16 Base kinds capture full preimages, browse, CAS restore and undo without identity loss');
  const count=await db.documentHistory.count(); await readHistoryPresent(P,'media','media'); await listDocumentHistory(P,'media','media');
  await db.transaction('r',db.codexEntries, async()=>{assert(Dexie.currentTransaction!.idbtrans.objectStoreNames.length===1,'Readonly broadened');await db.codexEntries.get('codex');});
  await db.codexEntries.update('codex',{updatedAt:Date.now()}); assert(await db.documentHistory.count()===count,'Read/timestamp creates history');
  const title=(await db.codexEntries.get('codex'))!.title;
  try {await db.transaction('rw',db.codexEntries,async()=>{await db.codexEntries.update('codex',{title:'Rollback'});throw Error('rollback');});}catch {/* intended */}
  assert((await db.codexEntries.get('codex'))!.title===title && await db.documentHistory.count()===count,'Rollback leaked');
  const assets=await db.worldEraAssets.where('projectId').equals(P).toArray(); assert(assets.length===2,'Binary payload duplicated by metadata versions');
  assert((await db.documentHistory.where('projectId').equals(P).toArray()).filter(row=>row.kind==='media').every(row=>!row.document.root.blob),'Blob embedded in preimages');
  passed.push('Readonly scopes, timestamp no-op, nested rollback and immutable media/model asset dedup');
  await updateWorkspaceLibrary(P,0,{kind:'create-folder',id:'history-folder',name:'Scenes and places'});await updateWorkspaceLibrary(P,1,{kind:'place',folderId:'history-folder',documents:[{engineId:'dialog-scene',entityId:'dialog-scene'},{engineId:'worldgen',entityId:'worldgen'}]});
  const portable=await exportProjectData(P);clone=await importProjectData(portable);
  assert((await db.projects.get(clone))!.workspacePlacements?.length===2,'Clone lost Conversation/Worldgen library placements');
  const clonedHistory=await db.documentHistory.where('projectId').equals(clone).toArray();assert(new Set(clonedHistory.map(row=>row.kind)).size===eraDocumentKinds.length,'Clone lost history kinds');
  assert(clonedHistory.every(row=>row.entityId!==row.kind && row.document.root.id===row.entityId),'Clone history identities not remapped');
  const clonedBoard=clonedHistory.find(row=>row.kind==='board')!,cardId=(await db.codexEntries.where('projectId').equals(clone).first())!.id;const markup=clonedBoard.document.children.boardNodes[0].richContent as string;assert(markup.includes(`data-project-id="${clone}"`)&&markup.includes(`data-entry-id="${cardId}"`),'History clone richContent retains source reference');
  for(const row of clonedHistory){const hydrated=await getDocumentHistory(clone,row.kind,row.entityId,row.id);assert(hydrated.document.root.projectId===undefined||hydrated.document.root.projectId===clone,'Clone leaked project');}
  const zip=await createProjectZipArchive(P);await importProjectZip(new File([zip.blob],'history.zip',{type:'application/zip'}),{replaceProjectIds:[P]});assert(await db.documentHistory.where('projectId').equals(P).count()===count,'ZIP generated/lost history');
  assert(await ((await getDocumentHistory(P,'media','media',(await listDocumentHistory(P,'media','media'))[0].id)).document.root.blob as Blob).text()==='ABCD','ZIP binary history hydration');
  const full=await exportFullDatabase();await importFullDatabase(full);assert(await db.documentHistory.where('projectId').equals(P).count()===count,'Full JSON lost history');
  const {documentHistory:_history,...legacy}=full;void _history;await importFullDatabase(legacy);assert(await db.documentHistory.where('projectId').equals(P).count()===count,'Legacy fullJSON erased history');assert(await ((await getDocumentHistory(P,'media','media',(await listDocumentHistory(P,'media','media'))[0].id)).document.root.blob as Blob).text()==='ABCD','Legacy fullJSON orphaned history assets');
  passed.push('Normal project clone, full JSON and project ZIP retain16 history kinds, identity remapping and binary payloads');

  await db.localMediaAssets.update('media',{voiceMemo:{recording:{state:'recording'}}} as never); const checkpoints=await listDocumentHistory(P,'media','media');
  for(let i=1;i<4;i++)await db.localMediaAssets.update('media',{blob:new Blob(['a'.repeat(i)]),voiceMemo:{recording:{state:'recording'}}} as never);
  await db.localMediaAssets.update('media',{voiceMemo:{recording:{state:'finished'}}} as never);assert((await listDocumentHistory(P,'media','media')).length===checkpoints.length,'Voice checkpoint version per chunk');
  passed.push('Voice stream checkpoints and finishing do not retain growing intermediate recordings');
  return passed;
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);assert(!await db.documentHistory.where('projectId').equals(P).count(),'Project cleanup history orphan');}
}
