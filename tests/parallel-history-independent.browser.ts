import '@/engines';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {createParallelDraft,deleteParallelDraft,loadPaneDocument,savePaneDocument,renameParallelDraft,restoreParallelDraftHistory} from '@/engines/writings/parallelDrafts';
import {listParallelDraftHistory,readParallelDraftHistory} from '@/engines/writings/parallelDraftHistory';
import {listSnapshots} from '@/engines/writings/snapshots';
import {preparePublishedEdition,commitPublishedEdition,publishEdition,getPublishedEdition} from '@/services/publishedEditions/store';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {undoAuditEntry} from '@/services/aiBridge/undo';
import {readWorldDocument} from '@/services/worldEras/store';
import {eraSnapshotOperations} from '@/services/worldEras/writings';
import type {Project,Writing} from '@/types';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function rejects(run:()=>Promise<unknown>){let failed=false;try{await run();}catch{failed=true;}check(failed,'Expected rejection');}
async function fixture(P:string){
 const project:Project={id:P,title:P,type:'standalone',mode:'custom',description:'',status:'draft',color:'#777777',enabledEngines:['writings'],engineOrder:[],worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1},{id:'future',name:'Future',description:'',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1};
 const writing:Writing={id:`${P}-chapter`,projectId:P,title:'Canonical chapter',content:'<p>Canonical protected prose.</p>',status:'draft',wordCount:3,tags:['canonical'],chapter:4,createdAt:1,updatedAt:1};
 await db.projects.put(project);await db.writings.put(writing);const canonical=await loadPaneDocument(P,{writingId:writing.id}),draft=await createParallelDraft(canonical,'Alternative');
 const load=(eraId?:string)=>loadPaneDocument(P,{writingId:writing.id,draftId:draft.id},eraId);
 return{writing,draft,canonical,load};
}

export async function testIndependentFailedDraftCasHistory(){
 const P='review-failed-draft-cas';try{
  const{draft,load}=await fixture(P),stale=await load();await savePaneDocument(stale,'<p>Winning replacement.</p>');const current=await load(),before=await listParallelDraftHistory(current);
  await rejects(()=>savePaneDocument(stale,'<p>Rejected unsaved text.</p>'));
  const after=await listParallelDraftHistory(current);
  check(after.length===before.length,`Failed CAS added own immutable history despite no successful replacement: before=${before.length}, after=${after.length}, rows=${JSON.stringify(await Promise.all(after.map(row=>readParallelDraftHistory(current,row.id))))}`);
  check((await load()).content==='<p>Winning replacement.</p>'&&(await db.writingSnapshots.get(draft.id))!.content==='<p>Winning replacement.</p>','Failed CAS changed winner');
  return ['A rejected parallel-draft CAS creates no own immutable history of a replacement that never happened'];
 }finally{await deleteProject(P);}
}

export async function testIndependentDraftScopeAndUndo(){
 const P='review-draft-scope-undo';try{
  const{writing,draft,load}=await fixture(P),base=await load();await savePaneDocument(base,'<p>Base alternative one.</p>');
  const past=await load('past');await savePaneDocument(past,'<p>Past alternative one.</p>');const pastCurrent=await load('past'),pastRows=await listParallelDraftHistory(pastCurrent),eraOnly=pastRows.find(row=>row.sourceDraftVersion===past.version)!;
  check(eraOnly,'Era history preimage missing');await rejects(async()=>readParallelDraftHistory(await load(),eraOnly.id));await rejects(async()=>readParallelDraftHistory(await load('future'),eraOnly.id));
  await rejects(()=>readParallelDraftHistory({...pastCurrent,writingId:'foreign-chapter'},eraOnly.id));await rejects(()=>readParallelDraftHistory({...pastCurrent,projectId:'foreign-project'},eraOnly.id));
  const beforeVersion=pastCurrent.version,beforeRows=await listParallelDraftHistory(pastCurrent);
  await rejects(()=>db.transaction('rw',db.tables,async()=>{await restoreParallelDraftHistory(pastCurrent,eraOnly.id);throw Error('synthetic outer rollback');}));
  check((await load('past')).version===beforeVersion&&(await listParallelDraftHistory(pastCurrent)).length===beforeRows.length,'Outer rollback split alternative/history');
  const saved=await runBridgeTool('wh_parallel_draft_save',{projectId:P,eraId:'past',writingId:writing.id,draftId:draft.id,expectedVersion:beforeVersion,content:'Audit changed era prose.'});check(saved.ok,JSON.stringify(saved));
  const audit=(saved.result as {__audit:Record<string,unknown>}).__audit,entry={...audit,tool:'wh_parallel_draft_save',eraId:'past'};
  const modified=await load('past');await rejects(()=>db.transaction('rw',db.tables,async()=>{await undoAuditEntry({entry});throw Error('synthetic audit undo rollback');}));
  check((await load('past')).version===modified.version,'Aborted audit Undo changed draft version');await undoAuditEntry({entry});await rejects(()=>undoAuditEntry({entry}));
  check((await load('past')).content===pastCurrent.content&&(await load()).content==='<p>Base alternative one.</p>'&&(await db.writings.get(writing.id))!.content===writing.content,'Era audit Undo escaped its draft scope');
  check((await listSnapshots(writing.id)).every(row=>row.kind===undefined),'Canonical history exposed an alternative or its immutable history');
  const source=await load(),created=await runBridgeTool('wh_parallel_draft_create',{projectId:P,writingId:writing.id,sourceDraftId:draft.id,expectedVersion:source.version,name:'Audit created child'});check(created.ok,JSON.stringify(created));
  const child=created.result as {id:string;__audit:Record<string,unknown>},childDoc=await loadPaneDocument(P,{writingId:writing.id,draftId:child.id});await renameParallelDraft(childDoc,'Author renamed child');
  await rejects(()=>undoAuditEntry({entry:{...child.__audit,tool:'wh_parallel_draft_create'}}));check(await db.writingSnapshots.get(child.id),'Stale creation Undo removed an author-renamed alternative');
  return ['Independent Base/two-era exact history identities; restore and audit-Undo outer rollback/retry; replay/stale creation Undo refused; canonical prose/history stay separate'];
 }finally{await deleteProject(P);}
}

export async function testIndependentDraftPublicationAndDeletedClone(){
 const P='review-draft-publication-clone';let clone:string|undefined;try{
  const{writing,draft,load}=await fixture(P);await savePaneDocument(await load(),'<p>Alternative selected publication.</p>');
  const before=(await db.writings.get(writing.id))!,input={projectId:P,chapterIds:[writing.id],chapterDraftIds:{[writing.id]:draft.id},title:'Alternative frozen edition',locale:'en' as const,expectedRevision:0};
  const prepared=await preparePublishedEdition(input);await renameParallelDraft(await load(),'Renamed during capture');await rejects(()=>commitPublishedEdition(prepared,0));check(!(await db.projects.get(P))!.publishedEditions?.length,'Renaming chosen source committed stale capture');
  const edition=(await publishEdition(input)).edition;check(edition.chapters[0].sourceDraftId===draft.id&&edition.reader.html.includes('Alternative selected publication.')&&!edition.reader.html.includes('Canonical protected prose.'),'Publication lost exact chosen draft');
  check(JSON.stringify(await db.writings.get(writing.id))===JSON.stringify(before),'Publication promoted/changed canonical row metadata');
  await savePaneDocument(await load('past'),'<p>Ancient alternative selected publication.</p>');
  const past=(await publishEdition({...input,eraId:'past',title:'Past frozen edition',expectedRevision:1})).edition;
  await deleteParallelDraft(await load());
  check((await getPublishedEdition(P,edition.id)).reader.html===edition.reader.html,'Deleting source changed frozen artifact');
  clone=await importProjectData(await exportProjectData(P));const cloneProject=(await db.projects.get(clone))!,baseEdition=cloneProject.publishedEditions!.find(row=>row.title===edition.title)!,pastEdition=cloneProject.publishedEditions!.find(row=>row.title===past.title)!;
  check(baseEdition.reader.html===edition.reader.html&&pastEdition.reader.html===past.reader.html,'Clone regenerated frozen bytes');
  const missingDraft=baseEdition.chapters[0].sourceDraftId!;check(missingDraft!==draft.id&&!await db.writingSnapshots.get(missingDraft),'Deleted source pointer was not remapped as a missing clone identity');
  const histories=await db.writingSnapshots.where('projectId').equals(clone).toArray();check(histories.some(row=>row.kind==='parallel-draft-history'&&row.sourceDraftId===missingDraft),'Deleted source draft history does not share the remapped edition pointer');
  const cloneEra=cloneProject.worldEras!.find(row=>row.name==='Past')!,eraDoc=(await readWorldDocument({projectId:clone,eraId:cloneEra.id},'writings',baseEdition.chapters[0].writing.id))!,eraDraft=eraDoc.document.children.writingSnapshots.find(row=>row.kind==='parallel-draft');
  check(eraDraft?.id===missingDraft&&pastEdition.chapters[0].sourceDraftId===missingDraft&&eraDoc.document.children.writingSnapshots.filter(row=>row.kind==='parallel-draft-history').every(row=>row.sourceDraftId===missingDraft),'Base deleted identity/own-era live draft/era history/editions diverged during clone');
  return ['Alternative publication capture rejects source rename, never promotes canonical text; Base deleted-source history and own-era source/edition identities clone consistently with frozen HTML bytes intact'];
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);}
}

export async function testIndependentCanonicalRestoreRejectsDraftHistory(){
 const P='review-canonical-restore-draft-history';try{
  const{writing,load}=await fixture(P);await savePaneDocument(await load(),'<p>Alternative only first prose.</p>');await savePaneDocument(await load(),'<p>Alternative only second prose.</p>');
  const document=await load(),histories=await listParallelDraftHistory(document),rows=await Promise.all(histories.map(row=>readParallelDraftHistory(document,row.id))),selected=rows.find(row=>row.content.includes('Alternative only first'))!;check(selected,'Alternative history control missing');
  const result=await runBridgeTool('wh_restore_writing_version',{projectId:P,snapshotId:selected.id});
  check(!result.ok&&(await db.writings.get(writing.id))!.content===writing.content,`Canonical history restore accepted an own-draft-history ID and promoted it: ok=${result.ok}, canonical=${(await db.writings.get(writing.id))!.content}`);
  return ['Ordinary canonical restore refuses a parallel-draft-history discriminator rather than promoting own alternative prose'];
 }finally{await deleteProject(P);}
}

export async function testIndependentDraftHistoryWriteFailure(){
 const P='review-draft-history-write-failure';try{
  const{load}=await fixture(P),initial=await load();
  const fail=(_key:unknown,row:Record<string,unknown>)=>{if(row.kind==='parallel-draft-history')throw Error('synthetic_history_write_failure');};
  db.writingSnapshots.hook('creating').subscribe(fail);
  try{await rejects(()=>savePaneDocument(initial,'<p>Must not persist without preimage.</p>'));}finally{db.writingSnapshots.hook('creating').unsubscribe(fail);}
  check((await load()).version===initial.version&&(await load()).content===initial.content&&(await listParallelDraftHistory(initial)).length===0,'History write failure changed draft or retained partial history');
  await savePaneDocument(initial,'');const empty=await load();await savePaneDocument(empty,'<p>After empty.</p>');const now=await load(),before=await listParallelDraftHistory(now);await savePaneDocument(now,now.content);
  const after=await listParallelDraftHistory(await load());check(after.length===before.length&&after.some(row=>row.wordCount===0)&&after.every(row=>!Object.hasOwn(row,'content')),'Empty preimage/no-op/metadata-only semantics broken');
  return ['Failed immutable-history insert rolls back draft; exact empty preimage retained, identical save adds no own history, metadata lists retain no bodies'];
 }finally{await deleteProject(P);}
}

export async function testIndependentEraCanonicalRestoreRejectsDraftHistory(){
 const P='review-era-canonical-restore-draft-history';try{
  const{writing,load}=await fixture(P);await savePaneDocument(await load('past'),'<p>Era alternative first.</p>');await savePaneDocument(await load('past'),'<p>Era alternative second.</p>');
  const document=await load('past'),histories=await listParallelDraftHistory(document),rows=await Promise.all(histories.map(row=>readParallelDraftHistory(document,row.id))),selected=rows.find(row=>row.content.includes('Era alternative first'))!;check(selected,'Era alternative history control missing');
  const result=await runBridgeTool('wh_restore_writing_version',{projectId:P,eraId:'past',snapshotId:selected.id}),canonical=(await readWorldDocument({projectId:P,eraId:'past'},'writings',writing.id))!;
  check(!result.ok&&canonical.document.root.content===writing.content&&(await db.writings.get(writing.id))!.content===writing.content,'Era canonical restore accepted own-draft history or touched Base');
  return ['Named-era canonical restore refuses own alternative history before any preimage/canonical write'];
 }finally{await deleteProject(P);}
}

export async function testIndependentRejectedDraftRecoveryPreserved(){
 const P='review-rejected-draft-recovery-preserved';try{
  const{load}=await fixture(P);
  for(const eraId of [undefined,'past']){
   const stale=await load(eraId);await savePaneDocument(stale,`<p>Winner in ${eraId??'Base'}.</p>`);const current=await load(eraId),before=await listParallelDraftHistory(current),rejected=`<p>Rejected recoverable text in ${eraId??'Base'}.</p>`;let receipt:string|undefined;
   try{await savePaneDocument(stale,rejected);}catch(error){receipt=(error as {rejectedSnapshotId:string}).rejectedSnapshotId;}
   check(receipt,'Rejected content lost its established recovery receipt');const row=await eraSnapshotOperations({projectId:P,eraId}).readSnapshot(receipt);
   check(row?.content===rejected&&row.kind===undefined&&row.reason==='manual','Legacy rejected-text recovery was removed or mislabeled as a saved alternative version');
   check((await listParallelDraftHistory(current)).length===before.length&&(await load(eraId)).content===current.content,'Rejected recovery changed the winner or its own version history');
  }
  return ['Base and era failed-CAS prose remains recoverable by its existing manual snapshot receipt without polluting saved alternative history'];
 }finally{await deleteProject(P);}
}
