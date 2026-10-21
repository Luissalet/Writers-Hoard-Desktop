import Dexie from 'dexie';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { getDocumentHistory, listDocumentHistory, readHistoryPresent, restoreDocumentHistory, undoDocumentHistory } from '@/services/documentHistory/store';
import { subscribeDocumentHistory } from '@/services/documentHistory/events';
import type { Project } from '@/types';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
export async function testDocumentHistoryLargeBinary():Promise<string[]> {
 const P='synthetic-history-large',project:Project={id:P,title:'Large history',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:1};
 let notifications=0;const unsubscribe=subscribeDocumentHistory(P,()=>{assert(!Dexie.currentTransaction,'History event leaked closing transaction');notifications++;});
 try {
  await db.projects.put(project);const bytes=new Uint8Array(50*1024*1024);bytes.fill(37);const blob=new Blob([bytes],{type:'audio/wav'});
  await db.localMediaAssets.add({id:'large-audio',projectId:P,title:'Long recording',kind:'audio',mime:'audio/wav',blob,size:blob.size,notes:'Before',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  await db.localMediaAssets.update('large-audio',{notes:'First annotation'});await db.localMediaAssets.update('large-audio',{notes:'Second annotation'});
  let history=await listDocumentHistory(P,'media','large-audio');assert(history.length===2,'Large history missing');assert(await db.worldEraAssets.where('projectId').equals(P).count()===1,'50MiB metadata revisions duplicate bytes');
  const stored=await db.documentHistory.where('projectId').equals(P).toArray();assert(stored.every(row=>!row.document.root.blob && row.assetIds.length===1 && row.version.length===71),'Large body/token includes payload');
  const selected=await getDocumentHistory(P,'media','large-audio',history[0].id),hydrated=selected.document.root.blob as Blob;assert(hydrated.size===bytes.length && new Uint8Array(await hydrated.slice(-1).arrayBuffer())[0]===37,'Large retained bytes changed');
  await db.worldMaps.put({id:'nested-map',projectId:P,title:'Map',createdAt:1,updatedAt:1,nested:{sound:blob,image:'data:image/png;base64,AQID'}} as never);await db.worldMaps.update('nested-map',{title:'Map edited'});
  assert(await db.worldEraAssets.where('projectId').equals(P).count()===2,'Nested audio duplicates existing50MiB payload');
  const mapVersion=(await listDocumentHistory(P,'maps','nested-map'))[0],map=(await getDocumentHistory(P,'maps','nested-map',mapVersion.id)).document.root;
  assert(((map.nested as {sound:Blob}).sound).size===blob.size && (map.nested as {image:string}).image==='data:image/png;base64,AQID','Nested Blob/image did not hydrate');
  const current=(await readHistoryPresent(P,'media','large-audio'))!;const restored=await restoreDocumentHistory(P,'media','large-audio',history[0].id,current.version);assert(restored.undo,'Missing receipt');await db.localMediaAssets.update('large-audio',{notes:'Newer prose'});
  let refused=false;try{await undoDocumentHistory(restored.undo);}catch{refused=true;}assert(refused&&(await db.localMediaAssets.get('large-audio'))?.notes==='Newer prose','Undo overwrote later prose');
  const committed=notifications,count=await db.documentHistory.where('projectId').equals(P).count();try{await db.transaction('rw',db.localMediaAssets,async()=>{await db.localMediaAssets.update('large-audio',{notes:'Rollback candidate'});throw Error('rollback');});}catch{/* intended */}
  assert(await db.documentHistory.where('projectId').equals(P).count()===count&&notifications===committed,'Rollback history/event leaked');
  await db.transaction('rw',db.settings,async()=>{assert(Dexie.currentTransaction!.idbtrans.objectStoreNames.length===1,'Unrelated rw broadened');await db.settings.put({id:'synthetic-history-large',value:true} as never);});
  const extraBlob=new Blob(['First capture while implicitly deleting'],{type:'audio/wav'});
  await db.localMediaAssets.put({id:'implicit-delete',projectId:P,title:'Implicit',kind:'audio',mime:'audio/wav',blob:extraBlob,size:extraBlob.size,notes:'Before',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  await db.localMediaAssets.where('projectId').equals(P).and(row=>row.id==='implicit-delete').delete();
  const deletion=(await listDocumentHistory(P,'media','implicit-delete'))[0];assert(deletion&&await ((await getDocumentHistory(P,'media','implicit-delete',deletion.id)).document.root.blob as Blob).text()==='First capture while implicitly deleting','Implicit collection delete lost async Blob preimage');
  const sharedBlob=new Blob(['Shared concurrent captures'],{type:'audio/wav'}),assetCount=await db.worldEraAssets.where('projectId').equals(P).count();
  for(const id of ['parallel-one','parallel-two'])await db.localMediaAssets.put({id,projectId:P,title:id,kind:'audio',mime:'audio/wav',blob:sharedBlob,size:sharedBlob.size,notes:'Before',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  await db.transaction('rw',db.localMediaAssets,async()=>{await Promise.all(['parallel-one','parallel-two'].map(id=>db.localMediaAssets.update(id,{notes:'After'})));});assert(await db.worldEraAssets.where('projectId').equals(P).count()===assetCount+1,'Concurrent aggregate captures duplicate shared bytes');
  const row={id:'chapter',projectId:P,title:'Chapter',content:'Prose',status:'draft',wordCount:1,tags:[],createdAt:1,updatedAt:1};await db.writings.put(row);const previous=await db.documentHistory.count();await db.writingSnapshots.put({id:'opening-snapshot',projectId:P,writingId:row.id,content:'Prose',kind:'auto',createdAt:1} as never);assert(await db.documentHistory.count()===previous,'Opening snapshot creates general history');
  history=await listDocumentHistory(P,'media','large-audio');assert(history.every(item=>!('document' in item)&&!('assetIds'in item)),'List returns bodies');
  return ['50MiB immutable audio is stored once across metadata edits; selected bytes hydrate intact and CAS tokens stay71characters','Undo refuses later edits; rollback emits no history notification; unrelated rw and writing-opening snapshots do not capture'];
 }finally{unsubscribe();await deleteProject(P);await db.settings.delete('synthetic-history-large');}
}
