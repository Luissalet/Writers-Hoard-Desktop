import {db} from '@/db';
import {exportProjectData,importProjectData} from '@/db/operations';
import {archiveSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import type {Project} from '@/types';
import type {SourceToolDocument} from '@/engines/local/documents/types';
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
export async function testLocalAppArchives(){
 const marker='own-source-archive-json-'+crypto.randomUUID(),owned=new Set<string>(),projectId=crypto.randomUUID(),childId=crypto.randomUUID(),parentId=crypto.randomUUID();owned.add(projectId);
 const source=(id:string,title:string,data:SourceToolDocument['data'],codec:SourceToolDocument['codec']):SourceToolDocument=>({id,title,namespace:'qa.archive',generation:crypto.randomUUID(),revision:0,createdAt:1,updatedAt:1,data,codec,preview:{version:1,fields:[{key:'notes'}]}});
 const child=source(childId,'Own shared child',{notes:'Own child prose'},{version:1,fields:{notes:{kind:'prose'}}}),parent=source(parentId,'Own archived parent',{notes:'Opaque source-tool:never-rewrite',children:[{id:'entry/α%2F',document:{kind:'local-tool',documentId:childId},variant:'panel'}]},{version:1,fields:{notes:{kind:'prose'},children:{kind:'list',idKey:'id',referenceKey:'document'}}});
 const project={id:projectId,title:marker,description:marker,mode:'novelist',type:'standalone',color:'#303030',status:'draft',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:1,sourceToolDocuments:[child,parent]} as Project;
 const counts=async()=>Object.fromEntries(await Promise.all(db.tables.map(async table=>[table.name,await table.count()])));
 try{
  await db.projects.add(project);const read=await readSourceToolDocument({projectId},parentId);assert(read,'Normal archive baseline unavailable');await archiveSourceToolDocument({projectId},parentId,'qa.archive',0,read!.version);
  const payload=await exportProjectData(projectId);assert(Array.isArray(payload.sourceToolArchives)&&payload.sourceToolArchives.length===1,'SOURCE_ARCHIVE_JSON_OMITTED');
  const copy=await importProjectData(payload);owned.add(copy);const p=await db.projects.get(copy),archives=await db.documentArchives.where('projectId').equals(copy).toArray(),archived=archives[0],item=archived?.metadata?.item as unknown as SourceToolDocument;
  assert(archives.length===1&&archived.sourceId===item.id&&item.id!==parentId&&archived.id!==(payload.sourceToolArchives as {id:string}[])[0].id,'Source archive identity coherence lost');
  assert(!p?.sourceToolDocuments?.some(row=>row.id===item.id),'Archive was reinserted into Base');
  const data=item.data as {notes:string;children:{id:string;document:{documentId:string};variant:string}[]};assert(data.notes==='Opaque source-tool:never-rewrite'&&data.children[0].id==='entry/α%2F'&&data.children[0].variant==='panel'&&data.children[0].document.documentId===p?.sourceToolDocuments?.[0].id,'Source archive semantic remap/prose changed');
  const legacy={...payload};delete legacy.sourceToolArchives;const old=await importProjectData(legacy);owned.add(old);assert(await db.documentArchives.where('projectId').equals(old).count()===0,'Legacy absence created archive records');
  const before=await counts(),invalid=structuredClone(payload),rows=invalid.sourceToolArchives as {projectId:string}[];rows[0].projectId=crypto.randomUUID();let rejected=false;try{await importProjectData(invalid);}catch{rejected=true;}assert(rejected,'Invalid Source archive scope was accepted');assert(JSON.stringify(await counts())===JSON.stringify(before),'Invalid import partially changed the database');
  let rolledBackId:string|undefined;
  try{await db.transaction('rw',db.tables,async()=>{rolledBackId=await importProjectData(payload);assert(await db.documentArchives.where('projectId').equals(rolledBackId).count()===1,'Normal nested import omitted archive before rollback');throw Error('OWN_ABORT_SOURCE_ARCHIVE_IMPORT');});}catch(error){assert(String(error).includes('OWN_ABORT_SOURCE_ARCHIVE_IMPORT'),'Unexpected outer transaction failure');}
  assert(!!rolledBackId&&!await db.projects.get(rolledBackId!)&&await db.documentArchives.where('projectId').equals(rolledBackId!).count()===0,'Outer rollback retained imported project/archive');assert(JSON.stringify(await counts())===JSON.stringify(before),'Outer rollback changed another table');
  return {cases:4,normalSourceArchiveJSON:true,legacyAbsence:true,invalidScopeBeforeWrites:true,outerTransactionRollback:true};
 }finally{
  await db.transaction('rw',db.tables,async()=>{for(const id of owned){for(const table of db.tables)if(table.name!=='projects'&&table.schema.indexes.some(index=>index.name==='projectId'))await table.where('projectId').equals(id).delete();await db.projects.delete(id);}});
  for(const id of owned)assert(!await db.projects.get(id)&&await db.documentArchives.where('projectId').equals(id).count()===0,'Own archive QA cleanup incomplete');
 }
}
