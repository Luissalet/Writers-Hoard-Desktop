import '@/engines';
import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { deleteProject, subscribeProjects } from '@/db/operations';
import { previewProjectDuplicate, duplicateProject, undoProjectDuplicate, pendingProjectDuplicate, resumeProjectDuplicate } from '@/services/projectDuplicate/service';
import { duplicateSchemaCoverage, readProjectDuplicate, duplicateSnapshotVersion } from '@/services/projectDuplicate/capture';
import { saveEraDocument, readWorldDocument } from '@/services/worldEras/store';
import { importLocalMedia } from '@/engines/media/operations';
import type { Project, Writing } from '@/types';

const assert:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
export async function seedDuplicateCore(){
 const id=`duplicate-${crypto.randomUUID()}`,parent=id+'-saga',now=1;
 const project:Project={id,title:'Local synthetic world',mode:'custom',type:'standalone',color:'#cab57d',description:'Owned duplicate fixture',status:'draft',enabledEngines:[],engineOrder:[],parentId:parent,createdAt:now,updatedAt:now,worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}],
  sourceToolDocuments:[{id:'source-doc',namespace:'missing.synthetic',title:'Opaque notebook',revision:2,createdAt:1,updatedAt:2,data:{opaque:{id:'same',projectId:id,content:`<div data-wh-codex-block="true" data-project-id="${id}" data-entry-id="same"></div>`},link:{kind:'codex',documentId:'same'}},codec:{version:1,fields:{link:{kind:'reference'}}}}],
  dataTables:[{id:'table',title:'Reference table',mode:'table',columns:[{id:'character',name:'Character',kind:'reference'}],rows:[{id:'row',cells:{character:'same'}}]}]};
 const writing:Writing={id:'same',projectId:id,title:'First chapter',content:`<p>Literal same ${id} \uE000wh-author-1\uE001</p><div data-wh-codex-block="true" data-project-id="${id}" data-entry-id="same"></div>`,wordCount:5,status:'draft',tags:[],createdAt:1,updatedAt:1};
 await db.projects.bulkAdd([{...project,id:parent,title:'Parent saga',type:'saga',parentId:undefined,worldEras:[],sourceToolDocuments:[],dataTables:[],children:[id]},project]);
 await db.codexEntries.add({id:'same',projectId:id,title:'Iria',type:'character',fields:{STR:'50'},tags:[],relations:[],content:'<p>Literal same</p>',createdAt:1,updatedAt:1});
 await db.writings.add(writing);
 await db.boards.add({id:'board',projectId:id,title:'Live board',surface:'slate',createdAt:1,updatedAt:1});
 await db.boardNodes.add({id:'node',projectId:id,boardId:'board',kind:'entity',title:'Iria',content:'',ref:{engineId:'codex',entityType:'codex-entry',entityId:'same',title:'Iria'},color:'#cab57d',position:{x:0,y:0},size:{width:200,height:120},zIndex:0,tags:[],createdAt:1,updatedAt:1});
 await importLocalMedia(id,new File([new Uint8Array([1,2,3,4])],'Local audio.wav',{type:'audio/wav'}),undefined,{id:'audio'});
 await db.localMediaAssets.update('audio',{linkedEntryIds:['same']});
 await saveEraDocument({projectId:id,eraId:'past'},'writings',{root:{...writing,title:'Past chapter',updatedAt:2},children:{writingSnapshots:[]}},(await readWorldDocument({projectId:id,eraId:'past'},'writings','same'))!.version);
 return{id,parent};
}
async function cleanup(id:string,parent:string,clones:string[]){for(const clone of clones)await deleteProject(clone);await deleteProject(id);await deleteProject(parent);}
export async function testProjectDuplicateCore(){
 const {id,parent}=await seedDuplicateCore(),clones:string[]=[],out:string[]=[];
 try{
  const coverage=duplicateSchemaCoverage();assert(coverage.declared.length===88&&!coverage.missing.length&&!coverage.obsolete.length,'88-table classification mismatch '+JSON.stringify(coverage));out.push('All88 live schema tables have an explicit copy/global/cache/parent/key policy;64 engine tables are not confused with complete DB coverage');
  const unordered=await readProjectDuplicate(id),reversed={...unordered,tables:Object.fromEntries(Object.entries(unordered.tables).map(([table,rows])=>[table,[...rows].reverse()]))};assert(await duplicateSnapshotVersion(unordered)===await duplicateSnapshotVersion(reversed),'row-set scan order changes pristine version');
  const before=await duplicateSnapshotVersion({...await readProjectDuplicate(id),parent:undefined}),preview=await previewProjectDuplicate({projectId:id}),operationId=crypto.randomUUID();
  let notifications=0;const stop=subscribeProjects(()=>notifications++);let result;try{result=await duplicateProject({projectId:id,title:'Independent copy',operationId,expectedSourceVersion:preview.sourceVersion});}finally{stop();}
  clones.push(result.projectId);assert(result.complete&&notifications===1,'atomic copy status/notification '+JSON.stringify(result));
  const copy=(await db.projects.get(result.projectId))!,card=(await db.codexEntries.where('projectId').equals(copy.id).first())!,chapter=(await db.writings.where('projectId').equals(copy.id).first())!,node=(await db.boardNodes.where('projectId').equals(copy.id).first())!;
  assert(copy.parentId===parent&&(await db.projects.get(parent))!.children!.includes(copy.id)&&!copy.children?.length,'book sibling policy');
  assert(card.id!==chapter.id&&card.id!=='same'&&chapter.id!=='same','different tables with identical old ids conflated');
  assert(node.ref?.entityId===card.id&&node.boardId===(await db.boards.where('projectId').equals(copy.id).first())!.id,'live Board reference escaped copy');
  assert(chapter.content.includes(`data-entry-id="${card.id}"`)&&chapter.content.includes(`Literal same ${id} \uE000wh-author-1\uE001`),'semantic block or literal prose damaged');
  const source=copy.sourceToolDocuments![0],original=(await db.projects.get(id))!.sourceToolDocuments![0];assert(JSON.stringify((source.data as Record<string,unknown>).opaque)===JSON.stringify((original.data as Record<string,unknown>).opaque),'opaque local JSON changed');
  assert((source.data as Record<string,{documentId:string}>).link.documentId===card.id,'declared source-tool ref wrong');
  const table=copy.dataTables![0];assert(table.rows[0].cells[table.columns[0].id]===card.id,'metadata reference table escaped');
  const era=copy.worldEras![0],past=await readWorldDocument({projectId:copy.id,eraId:era.id},'writings',chapter.id);assert(past?.document.root.title==='Past chapter'&&past.document.root.projectId===copy.id,'named era lost');
  const audio=(await db.localMediaAssets.where('projectId').equals(copy.id).first())!;assert([...new Uint8Array(await audio.blob.arrayBuffer())].join(',')==='1,2,3,4'&&audio.linkedEntryIds[0]===card.id,'owned media bytes/ref wrong');
  out.push('Real duplicate: engine-off records, same-ID different tables, live Board/Card, semantic block vs authored private Unicode, opaque source data, metadata refs, named era and audio bytes');
  const again=await duplicateProject({projectId:id,title:'Independent copy',operationId,expectedSourceVersion:preview.sourceVersion});assert(again.projectId===copy.id&&(await db.projects.get(parent))!.children!.filter(value=>value===copy.id).length===1,'retry created another copy');
  const undone=await undoProjectDuplicate(operationId);assert(undone.undone&&!await db.projects.get(copy.id)&&(await db.projects.get(parent))!.children!.join(',')===id,'pristine Undo or saga cleanup wrong');
  assert(await duplicateSnapshotVersion({...await readProjectDuplicate(id),parent:undefined})===before,'source authored data changed after duplicate+Undo');out.push('Stable operation replay reuses one project; pristine normal Undo removes only copy and sibling placement, source authored hash unchanged');
  return out;
 }finally{await cleanup(id,parent,clones);}
}
export async function testProjectDuplicateConflicts(){
 const {id,parent}=await seedDuplicateCore(),clones:string[]=[],out:string[]=[];
 try{
  const stale=await previewProjectDuplicate({projectId:id});await db.codexEntries.update('same',{title:'Later edit'});let rejected=false;try{await duplicateProject({projectId:id,title:'Stale',operationId:crypto.randomUUID(),expectedSourceVersion:stale.sourceVersion});}catch(error){rejected=String(error).includes('source_conflict');}assert(rejected&&(await db.projects.get(parent))!.children!.length===1,'stale source wrote copy');out.push('Stale source rejects with no destination project or saga writes');
  const preview=await previewProjectDuplicate({projectId:id}),operationId=crypto.randomUUID(),copy=await duplicateProject({projectId:id,title:'Edited target',operationId,expectedSourceVersion:preview.sourceVersion});clones.push(copy.projectId);
  const chapter=(await db.writings.where('projectId').equals(copy.projectId).first())!;await db.writings.update(chapter.id,{content:'<p>New authored copy prose</p>'});let conflict=false;try{await undoProjectDuplicate(operationId);}catch(error){conflict=String(error).includes('undo_changed');}assert(conflict&&(await db.writings.get(chapter.id))!.content.includes('New authored copy prose'),'edited copy was deleted by Undo');out.push('Full target CAS refuses Undo after an actual copy edit, retaining authored text');return out;
 }finally{await cleanup(id,parent,clones);}
}
export async function testProjectDuplicateRollback(){
 const{id,parent}=await seedDuplicateCore(),operationId=crypto.randomUUID(),target=`proj_copy_${operationId}`;
 const fail=(_key:unknown,row:Writing)=>{if(row.projectId===target)throw Error('private_late_writing_failure');};
 let notifications=0;const stop=subscribeProjects(()=>notifications++);
 try{
  const preview=await previewProjectDuplicate({projectId:id});db.writings.hook('creating',fail);
  let rejected=false;try{await duplicateProject({projectId:id,title:'Rollback fixture',operationId,expectedSourceVersion:preview.sourceVersion});}catch(error){rejected=String(error).includes('private_late_writing_failure');}finally{db.writings.hook('creating').unsubscribe(fail);}
  assert(rejected&&!await db.projects.get(target)&&!await db.settings.get(`projectDuplicate.operation.${operationId}`)&&!await db.codexEntries.where('projectId').equals(target).count()&&notifications===0,'late failure leaked authored rows/receipt/notification');
  assert((await db.projects.get(parent))!.children!.join(',')===id,'late failure changed source saga');
  const retry=await duplicateProject({projectId:id,title:'Rollback fixture',operationId,expectedSourceVersion:preview.sourceVersion});assert(retry.complete&&retry.projectId===target&&notifications===1,'same operation cannot recover after transaction rollback');
  await undoProjectDuplicate(operationId);
  return['Actual late writing-add failure rolls back project/Card/receipt/saga and emits zero notifications; same operation retry commits one copy and normal Undo succeeds'];
 }finally{db.writings.hook('creating').unsubscribe(fail);stop();await cleanup(id,parent,[target]);}
}
export async function testProjectDuplicateNative(){
 const qa=(window as unknown as {qaNative:{call(name:string,args:unknown):Promise<{ok:boolean;result:any}>;duplicateFixture(input:unknown):Promise<unknown>;undo(index:number):Promise<any>}}).qaNative;
 const {id,parent}=await seedDuplicateCore(),clones:string[]=[],paths=[`${id}/clip.wav`,`${id}/carousel/picture.png`,`${id}/capture.html`];
 try{
  const files=paths.map((path,index)=>({path,base64:btoa(['AUDIO owned bytes','RASTER owned bytes','<!doctype html><p>Frozen local capture</p>'][index])}));
  await qa.duplicateFixture({projectId:id,files,binding:true});
  await db.snapshots.add({id:'clip',projectId:id,url:'https://example.invalid/reference',title:'Managed source',source:'manual',status:'success',notes:'',tags:[],createdAt:1,preservedAt:1,localMediaPath:paths[0],mediaItems:[{relPath:paths[1],kind:'image'}],captureHtmlPath:paths[2],captureState:'done',downloadState:'done'});
  await qa.duplicateFixture({projectId:id,files:[files[0]],remove:true});const missing=await previewProjectDuplicate({projectId:id});assert(!missing.canDuplicate&&missing.findings.some(finding=>finding.includes(paths[0])),'missing managed bytes were silently skipped');await qa.duplicateFixture({projectId:id,files:[files[0]]});
  const preview=await qa.call('wh_project_duplicate_preview',{projectId:id});assert(preview.ok&&preview.result.files.length===3&&preview.result.shared.nativeBindings===1,'external preview source files/native references '+JSON.stringify(preview));
  const operationId=crypto.randomUUID(),args={projectId:id,title:'Native private copy',operationId,expectedSourceVersion:preview.result.sourceVersion},target=`proj_copy_${operationId}`;
  await qa.duplicateFixture({projectId:id,failTarget:target,fail:true});
  const first=await qa.call('wh_project_duplicate',args);assert(first.ok&&first.result.projectId===target&&!first.result.complete&&first.result.unfinished.some((reason:string)=>reason.includes('private_binding_insert_failure')),'real SQLite insertion fault must expose one created target and unfinished work '+JSON.stringify(first));clones.push(target);
  const total=await db.projects.count(),pending=await pendingProjectDuplicate(id);assert(pending?.operationId===operationId&&pending.title===args.title,'durable pending operation not discoverable after dialog close');await qa.duplicateFixture({projectId:id,failTarget:target,fail:false});
  const resumed=await resumeProjectDuplicate(pending.operationId);assert(resumed.complete&&resumed.projectId===target&&await db.projects.count()===total,'normal recovery resumed a different destination');
  const retry=await qa.call('wh_project_duplicate',args);assert(retry.ok&&retry.result.complete&&retry.result.projectId===target&&await db.projects.count()===total&&!await pendingProjectDuplicate(id),'native completion replay created another copy or left pending operation '+JSON.stringify(retry));
  const snapshot=(await db.snapshots.where('projectId').equals(target).first())!,copiedPaths=[snapshot.localMediaPath!,snapshot.mediaItems![0].relPath,snapshot.captureHtmlPath!];
  assert(copiedPaths.every(path=>path.startsWith(target+'/')),'managed paths still owned by source');
  const bridge=window.electronAPI as unknown as {projectDuplicate:import('@/services/projectDuplicate/types').ProjectDuplicateNative};
  const sourceFiles=await bridge.projectDuplicate.inspect({projectId:id,paths}),copyFiles=await bridge.projectDuplicate.inspect({projectId:target,paths:copiedPaths});
  assert(copyFiles.files.every((file,index)=>file.sha256===sourceFiles.files[index].sha256)&&copyFiles.bindings.length===1&&copyFiles.bindings[0].object_id==='global-native-object','real copied bytes/shared native identity mismatch');
  await qa.duplicateFixture({projectId:id,files,remove:true});await deleteProject(id);
  const offline=await bridge.projectDuplicate.inspect({projectId:target,paths:copiedPaths});assert(offline.files.length===3&&!offline.missing.length&&offline.bindings.length===1,'source deletion broke owned clone files/native refs');
  assert(Number.isInteger(retry.result._undo?.audit_index),'normal duplicate audit absent');const undo=await qa.undo(retry.result._undo.audit_index);assert(undo.ok&&!await db.projects.get(target),'actual HTTP audit Undo '+JSON.stringify(undo));assert(!(await qa.undo(retry.result._undo.audit_index)).ok,'HTTP audit receipt replay accepted');
  const empty=await bridge.projectDuplicate.inspect({projectId:target,paths:copiedPaths}),global=await bridge.projectDuplicate.inspect({projectId:id,paths:[]});assert(empty.missing.length===3&&!empty.bindings.length&&global.bindings[0].object_id==='global-native-object','Undo deleted shared native original or left copy resources');
  return['Actual external stdio→HTTP→executor→IPC→renderer: missing-file finding, preview/copy3managed byte assets and shared native SQLite reference; real SQLite trigger fault reports unfinished created target, durable normal recovery/replay completes one project; source files/DB removed while copy remains offline; actual HTTP audit Undo removes only copied files/bindings and refuses receipt replay'];
 }finally{await cleanup(id,parent,clones);}
}
export async function testProjectDuplicateNativeBindingConflict(){
 const qa=(window as unknown as {qaNative:{duplicateFixture(input:unknown):Promise<unknown>}}).qaNative,bridge=(window.electronAPI as unknown as {projectDuplicate:import('@/services/projectDuplicate/types').ProjectDuplicateNative}).projectDuplicate;
 const id=`duplicate-${crypto.randomUUID()}`,operationId=crypto.randomUUID(),target=`proj_copy_${operationId}`;
 try{
  const source=await bridge.inspect({projectId:id,paths:[]});assert(!source.bindings.length,'source binding fixture must be empty');await bridge.stage({operationId,sourceProjectId:id,targetProjectId:target,paths:[],expectedExternalVersion:source.version});
  await qa.duplicateFixture({projectId:id,bindingTarget:target});const result=await bridge.finalize({operationId,projectId:target});assert(!result.complete&&result.unfinished.includes('project_duplicate_binding_conflict'),'zero-source-binding completion silently adopted later authored target binding');
  await bridge.discard({operationId});assert((await bridge.inspect({projectId:target,paths:[]})).bindings[0]?.object_id==='later-native-object','uncommitted staging cleanup removed later authored binding');
  return['Real native IPC zero-binding stage refuses a later authored target SQLite binding; cleanup preserves that unrelated binding instead of adopting/deleting it'];
 }finally{await qa.duplicateFixture({projectId:id,bindingTarget:target,removeBinding:true});await bridge.discard({operationId});}
}
