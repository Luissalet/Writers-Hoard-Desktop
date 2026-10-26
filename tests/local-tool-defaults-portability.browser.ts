import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {createProjectZipArchive,importProjectZip,previewProjectZipImport} from '@/services/zipBackup';
import {previewProjectDuplicate,duplicateProject} from '@/services/projectDuplicate/service';
import {createLocalToolClient} from '@/engines/local/storage';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import definition from '@/engines/local/examples/iconNotebookDefinition';
const internal='@writers/tool-defaults',key='opaque-favorite';
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const equal=(a:unknown,b:unknown,message:string)=>check(JSON.stringify(canonical(a))===JSON.stringify(canonical(b)),message);
const all=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
export async function testLocalToolDefaultsPortability(){
 registerLocalToolModules({'./installed/examples.icon-notebook/module.tsx':{default:definition}});
 const id='defaults-portable-'+crypto.randomUUID(),control=id+'-control',copies:string[]=[];
 const project=(id:string)=>({id,title:'Defaults portable fixture',description:'Own synthetic data',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#777777',enabledEngines:['local-tool-'+definition.namespace],engineOrder:['local-tool-'+definition.namespace],worldEras:[{id:'past',name:'Past',description:'Synthetic',revision:1,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});
 try{
  await db.projects.bulkPut([project(id),project(control)]);const doc=await createSourceToolDocument({projectId:id},definition.namespace,'Portable notebook');
  const client=createLocalToolClient(id,definition,{documentId:doc.id}),service=client.defaults;check(service,'Defaults missing');const sourceBefore=await client.read(),controlBefore=await db.projects.get(control);
  const opaque={projectId:id,documentId:doc.id,reference:{kind:'local-tool',documentId:doc.id},path:'/project/'+id+'/local-tool-'+definition.namespace+'?document='+doc.id,nested:[null,false,0,'',doc.id]};
  await service.set(key,opaque,await service.get(key));await service.set('present-null',null,await service.get('present-null'));const transient=await service.set('absent-after-undo',0,await service.get('absent-after-undo'));check(transient.receiptId,'Missing first-set receipt');await service.undo('absent-after-undo',transient.receiptId);
  const original=(await db.projects.get(id))!,record=structuredClone(original.localToolStates![internal]);check(record,'Internal defaults record missing');check(!Object.hasOwn(original.localToolContracts??{},internal),'Internal codec leaked into author contracts');
  async function copied(target:string){const row=(await db.projects.get(target))!;check(row&&row.id!==id,'Copy identity did not change');check(row.sourceToolDocuments?.[0].id!==doc.id,'Copy did not remap real Source ID');equal(row.localToolStates?.[internal],{...record,revision:0},'Copy changed opaque values/tokens/timestamp or failed revision0');check(!Object.hasOwn(row.localToolContracts??{},internal),'Copy persisted invalid codec');
   const base=createLocalToolClient(target,definition),era=createLocalToolClient(target,definition,{eraId:row.worldEras![0].id});const expected={projectId:target,namespace:definition.namespace,key,revision:0,entry:{present:true,value:opaque}};equal(await base.defaults!.get(key),expected,'Copied public preference changed');equal(await era.defaults!.get(key),expected,'Copied era preference differs');equal((await base.defaults!.get('present-null')).entry,{present:true,value:null},'Present null lost');equal(await base.defaults!.get('absent-after-undo'),{projectId:target,namespace:definition.namespace,key:'absent-after-undo',revision:0,entry:{present:false}},'Copied absence/revision differs');
   await base.defaults!.set(key,'Independent copied preference',await base.defaults!.get(key));equal((await service!.get(key)).entry,{present:true,value:opaque},'Copy write changed original');
  }
  const exported=await exportProjectData(id),jsonCopy=await importProjectData(JSON.parse(JSON.stringify(exported)));copies.push(jsonCopy);await copied(jsonCopy);
  const preview=await previewProjectDuplicate({projectId:id});check(preview.canDuplicate,'Duplicate unavailable');const duplicated=await duplicateProject({projectId:id,title:'Defaults copied through normal Duplicate',operationId:crypto.randomUUID(),expectedSourceVersion:preview.sourceVersion});copies.push(duplicated.projectId);check(duplicated.complete&&duplicated.unfinished.length===0,'Duplicate incomplete');await copied(duplicated.projectId);
  const archive=await createProjectZipArchive(id),file=new File([archive.blob],archive.fileName,{type:'application/zip'});await previewProjectZipImport(file);await service.set(key,'Temporary value after backup',await service.get(key));check((await service.get(key)).entry.present,'Temporary mutation missing');const imported=await importProjectZip(file,{replaceProjectIds:[id]});check(imported.includes(id),'ZIP did not replace own fixture');equal((await db.projects.get(id))?.localToolStates?.[internal],record,'ZIP did not restore exact record including revision/time');equal((await service.get(key)).entry,{present:true,value:opaque},'ZIP lost opaque JSON');equal(await client.read(),sourceBefore,'Preference/portability changed original Source');equal(await db.projects.get(control),controlBefore,'Portability changed control project');
  const beforeReads=await all();await service.get(key);await createLocalToolClient(id,definition,{eraId:'past'}).defaults!.get(key);equal(await all(),beforeReads,'Reopened preference reads wrote data');
  return['real JSON clone and complete Duplicate remap actual Source IDs while defaults stay opaque with revision0 and independent writes; real ZIP restores exact Base record, null/absence and write-free Base/era reads'];
 }finally{for(const target of copies)await deleteProject(target);await deleteProject(id);await deleteProject(control);}
}
