import Dexie from 'dexie';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { eraDocumentVersion } from '@/services/worldEras/adapters';
import { readWorldDocument, saveEraDocument, saveWorldEra } from '@/services/worldEras/store';
import { getDocumentHistory, listDocumentHistory, readHistoryPresent, restoreDocumentHistory, saveDocumentHistory, undoDocumentHistory } from '@/services/documentHistory/store';
import type { Project } from '@/types';
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P='review-history-independent', Q='review-history-other';
const project=(id:string):Project=>({id,title:id,description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:1});
const root=(id:string)=>({id,projectId:P,title:id,createdAt:1,updatedAt:1});
export async function testIndependentHistory():Promise<string[]>{
 const passed:string[]=[];let clone:string|undefined;
 try{
  await db.projects.bulkPut([project(P),project(Q)]);
  await db.transaction('rw',db.worldMaps,db.mapPins,async()=>{await db.worldMaps.bulkPut([root('map-a'),root('map-b')] as never);await db.mapPins.put({id:'pin-moving',projectId:P,mapId:'map-a',label:'Original',x:0,y:0} as never);});
  const beforeA=(await readHistoryPresent(P,'maps','map-a'))!,beforeB=(await readHistoryPresent(P,'maps','map-b'))!;
  await db.mapPins.update('pin-moving',{mapId:'map-b',label:'Moved'});
  for(const [id,before]of [['map-a',beforeA],['map-b',beforeB]] as const){const rows=await listDocumentHistory(P,'maps',id);check(rows.length===1,`Moving child failed to capture ${id}`);check((await getDocumentHistory(P,'maps',id,rows[0].id)).version===before.version,`Moving child captured partial ${id}`);}
  const count=await db.documentHistory.count(),a=(await readHistoryPresent(P,'maps','map-a'))!.version;
  let collision=false;try{await restoreDocumentHistory(P,'maps','map-a',(await listDocumentHistory(P,'maps','map-a'))[0].id,a);}catch(e){collision=String(e).includes('child_identity_conflict');}
  check(collision&&await db.documentHistory.count()===count&&(await db.mapPins.get('pin-moving'))?.mapId==='map-b','Child identity collision failed atomically');
  passed.push('Moving a child captures both original aggregates; restoring across an occupied child ID rolls back all changes/history');

  await db.worldMaps.put({...root('parallel'),nested:{payload:new Blob([new Uint8Array(1024*1024).fill(91)])}} as never);
  await db.mapPins.put({id:'parallel-pin',projectId:P,mapId:'parallel',label:'Original',x:0,y:0} as never);
  for(let i=0;i<12;i++){
   const before=(await readHistoryPresent(P,'maps','parallel'))!,count=(await listDocumentHistory(P,'maps','parallel')).length;
   await db.transaction('rw',db.worldMaps,db.mapPins,async()=>{await Promise.all([db.worldMaps.update('parallel',{title:`Round ${i}`}),db.mapPins.update('parallel-pin',{label:`Round ${i}`}),db.mapPins.put({id:`new-pin-${i}`,projectId:P,mapId:'parallel',label:'Added',x:i,y:i} as never)]);});
   const rows=await listDocumentHistory(P,'maps','parallel');check(rows.length===count+1,`Parallel round ${i} count ${rows.length}/${count}`);
   check(rows.some(row=>row.version===before.version),`Parallel round ${i} missing full preimage`);
  }
  const beforeRollback=(await readHistoryPresent(P,'maps','parallel'))!.version,historyCount=await db.documentHistory.count(),assetCount=await db.worldEraAssets.count();
  try{await db.transaction('rw',db.worldMaps,db.mapPins,async()=>{await db.worldMaps.update('parallel',{nested:{payload:new Blob(['replacement'])}} as never);await db.transaction('rw',db.mapPins,async()=>{await db.mapPins.where('mapId').equals('parallel').delete();});throw Error('rollback');});}catch{/* expected */}
  check((await readHistoryPresent(P,'maps','parallel'))!.version===beforeRollback&&await db.documentHistory.count()===historyCount&&await db.worldEraAssets.count()===assetCount,'Nested blob rollback leaked source/history/assets');
  passed.push('Twelve parallel same-aggregate root/child/add rounds retain exactly one complete preimage; nested delete/blob rollback preserves source/history/assets');

  const era=await saveWorldEra(P,{id:'review-era',name:'Era',description:'',revision:0,createdAt:1,updatedAt:1},null),scope={projectId:P,eraId:era.id};
  const base=(await readHistoryPresent(P,'maps','parallel'))!,historyBeforeEra=await db.documentHistory.count();
  const eraRead=(await readWorldDocument(scope,'maps','parallel'))!;await saveEraDocument(scope,'maps',{...eraRead.document,root:{...eraRead.document.root,title:'Era title'}},eraRead.version);
  check(await db.documentHistory.count()===historyBeforeEra&&(await readHistoryPresent(P,'maps','parallel'))!.version===base.version,'Era write changed Base/history');
  const retained=await saveDocumentHistory(P,'maps','parallel',base.version);await db.worldMaps.update('parallel',{title:'Later Base'});
  const receipt=await restoreDocumentHistory(P,'maps','parallel',retained.id,(await readHistoryPresent(P,'maps','parallel'))!.version);
  check((await readWorldDocument(scope,'maps','parallel'))!.document.root.title==='Era title','Base restore overwrote own era');await undoDocumentHistory(receipt.undo!);
  check((await db.worldMaps.get('parallel'))!.title==='Later Base','Undo failed');
  const manual=await saveDocumentHistory(P,'maps','parallel',(await readHistoryPresent(P,'maps','parallel'))!.version);await db.worldMaps.delete('parallel');
  const missing=await restoreDocumentHistory(P,'maps','parallel',manual.id,null);check(missing.undo?.historyId===null,'Missing restore wrong receipt');await undoDocumentHistory(missing.undo!);check(!await db.worldMaps.get('parallel'),'Missing undo did not remove restored root');
  passed.push('Own era edits leave Base history untouched; Base restore/undo preserves own era; absent-root restore/undo uses null receipt');

  await db.worldMaps.put({...root('roundtrip'),nested:{payload:new Blob(['portable independent'],{type:'text/plain'})}} as never);await db.mapPins.put({id:'roundtrip-pin',projectId:P,mapId:'roundtrip',label:'Portable',x:1,y:1} as never);await db.worldMaps.update('roundtrip',{title:'Edited portable'});
  clone=await importProjectData(await exportProjectData(P));const rows=await db.documentHistory.where('projectId').equals(clone).toArray();const candidates=await Promise.all(rows.filter(row=>row.kind==='maps'&&row.title==='roundtrip').map(row=>getDocumentHistory(clone!,'maps',row.entityId,row.id)));const hydrated=candidates.find(row=>row.document.children.mapPins.some(pin=>pin.label==='Portable'));check(hydrated,'Clone history with portable child missing');const roundtrip=rows.find(row=>row.id===hydrated.id)!;
  check(hydrated.version===await eraDocumentVersion(hydrated.document)&&hydrated.document.root.projectId===clone&&hydrated.document.children.mapPins[0].projectId===clone&&hydrated.document.children.mapPins[0].mapId===roundtrip.entityId&&hydrated.document.children.mapPins[0].id!=='roundtrip-pin','Clone semantic identities/hash incorrect');
  check(await ((hydrated.document.root.nested as {payload:Blob}).payload).text()==='portable independent','Clone nested binary payload lost');
  await db.transaction('r',db.worldMaps,async()=>{check(Dexie.currentTransaction!.idbtrans.objectStoreNames.length===1,'Readonly scope expanded');});
  passed.push('Independent JSON clone preserves child scope/identities and nested binary hash; readonly scope stays narrow');
  return passed;
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);await deleteProject(Q);}
}

export async function testIndependentHistoryRichContent():Promise<string[]>{
 let clone:string|undefined;
 try{
  await db.projects.put(project(P));
  await db.codexEntries.put({id:'rich-card',projectId:P,title:'Referenced card',type:'custom',content:'Card',fields:{},relations:[],tags:[],createdAt:1,updatedAt:1});
  await db.transaction('rw',db.boards,db.boardNodes,async()=>{
   await db.boards.put({...root('rich-board'),description:''} as never);
   await db.boardNodes.put({...root('rich-node'),boardId:'rich-board',kind:'text',content:'Referenced card',richContent:`<p><span data-wh-codex-block="true" data-project-id="${P}" data-entry-id="rich-card">Referenced card</span></p>`,color:'#777777',position:{x:0,y:0},size:{width:200,height:100},zIndex:0,tags:[]} as never);
  });
  await db.boardNodes.update('rich-node',{content:'Changed prose',richContent:'<p>Changed prose</p>'});
  clone=await importProjectData(await exportProjectData(P));
  const version=(await db.documentHistory.where('projectId').equals(clone).toArray()).find(row=>row.kind==='board');check(version,'Cloned board history missing');
  const retained=await getDocumentHistory(clone,'board',version.entityId,version.id);
  await restoreDocumentHistory(clone,'board',version.entityId,version.id,(await readHistoryPresent(clone,'board',version.entityId))!.version);
  const restored=await db.boardNodes.get(retained.document.children.boardNodes[0].id),rich=String(restored!.richContent);
  const clonedCard=(await db.codexEntries.where('projectId').equals(clone).toArray())[0];
  check(rich.includes(`data-project-id="${clone}"`)&&rich.includes(`data-entry-id="${clonedCard.id}"`),`Cloned board history richContent retains source pointers: ${rich}; wanted project=${clone}, entry=${clonedCard.id}`);
  return ['Cloned history remaps Board richContent semantic pointers'];
 }finally{if(clone)await deleteProject(clone);await deleteProject(P);}
}
