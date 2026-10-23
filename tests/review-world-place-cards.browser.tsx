import '@/engines/worldgen/index';
import { db } from '@/db';
import type { Project } from '@/types';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createPlaceCard, undoPlaceCard } from '@/engines/worldgen/placeCards';
import { listWorldLinks, saveWorldLink } from '@/engines/worldgen/era';
import { saveWorldEra } from '@/services/worldEras/store';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';

const P='review-world-place-atomic',W=P+'-world';
function assert(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
async function refused(action:()=>Promise<unknown>,message:string){let error:unknown;try{await action();}catch(caught){error=caught;}assert(error,message);}
export async function reviewWorldPlaceCards():Promise<string[]>{
 const passed:string[]=[];
 try{
  await db.projects.put({id:P,title:'Atomic fixture',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['worldgen','codex'],createdAt:1,updatedAt:1} as Project);
  const params={...DEFAULT_PARAMS,width:128,erosion:0,seed:P},data=generateWorld(params);data.elevation.fill(.25);
  await saveSnapshot(W,paramsKey(params),data);
  const paint=new PaintSession(data,[]);paint.pushMany([{kind:'marker',marker:'settlement',x:16,y:12,rank:'village',name:'Review port'}]);
  await db.generatedWorlds.put({id:W,projectId:P,title:'Review world',params,edits:paint.serialize(),createdAt:1,updatedAt:1});
  const receipt=await createPlaceCard({projectId:P},W,{key:'settlement:16,12',name:'Review port'},'character');

  const exported=await exportProjectData(P),projectsBefore=await db.projects.count(),cardsBefore=await db.codexEntries.count(),worldsBefore=await db.generatedWorlds.count(),linksBefore=await db.entityLinks.count();
  const failImport=()=>{throw Error('independent imported-link persistence failure');};db.entityLinks.hook('creating',failImport);
  try{await refused(()=>importProjectData(exported),'Import must propagate late link write failure');}finally{db.entityLinks.hook('creating').unsubscribe(failImport);}
  assert(await db.projects.count()===projectsBefore&&await db.codexEntries.count()===cardsBefore&&await db.generatedWorlds.count()===worldsBefore&&await db.entityLinks.count()===linksBefore,'Late import failure stranded partial cloned project/documents/links');
  passed.push('Late entityLink import storage failure rolls back cloned project, card, world and link together');

  const failDelete=()=>{throw Error('independent Codex delete failure');};db.codexEntries.hook('deleting',failDelete);
  try{await refused(()=>undoPlaceCard({projectId:P},receipt),'Undo must propagate late card deletion failure');}finally{db.codexEntries.hook('deleting').unsubscribe(failDelete);}
  assert(!!await db.codexEntries.get(receipt.card.id)&&!!await db.entityLinks.get(receipt.link.id),'Late Undo failure partly removed card or link');
  passed.push('Undo failure after deleting the atlas link rolls the link and source card back atomically');

  await db.annotationReferences.put({id:P+'-annotation-ref',annotationId:P+'-note',targetEngineId:'codex',targetEntityId:receipt.card.id,createdAt:2});
  await refused(()=>undoPlaceCard({projectId:P},receipt),'Undo must preserve later annotation reference without projectId index');
  assert(!!await db.annotationReferences.get(P+'-annotation-ref')&&!!await db.codexEntries.get(receipt.card.id)&&!!await db.entityLinks.get(receipt.link.id),'Refused Undo changed annotation/card/link');
  await db.annotationReferences.delete(P+'-annotation-ref');
  await saveWorldEra(P,{id:'future',name:'Future',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const siblingLink={...receipt.link,id:P+'-sibling-link',sourceTitle:'Future place'};
  await saveWorldLink({projectId:P,eraId:'future'},W,siblingLink);
  await refused(()=>undoPlaceCard({projectId:P},receipt),'Base Undo must preserve later sibling-era reference');
  assert((await listWorldLinks({projectId:P,eraId:'future'},W)).some(link=>link.id===siblingLink.id)&&!!await db.codexEntries.get(receipt.card.id)&&!!await db.entityLinks.get(receipt.link.id),'Refused Base Undo changed sibling-era reference or source pair');
  passed.push('Later annotation and sibling-era links block Base Undo without partial changes');
  return passed;
 }finally{
  await db.annotationReferences.delete(P+'-annotation-ref');
  for(const table of db.tables)if(table.name!=='projects'&&table.schema.idxByName.projectId)await table.where('projectId').equals(P).delete();
  await db.projects.delete(P);await db.worldSnapshots.delete(W);
 }
}
