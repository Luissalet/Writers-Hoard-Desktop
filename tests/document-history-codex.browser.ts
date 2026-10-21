import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { saveCodexTemplate, deleteCodexTemplate } from '@/engines/codex/templates';
import { projectCodexEntry } from '@/engines/codex/properties';
import { getDocumentHistory,listDocumentHistory,readHistoryPresent,restoreDocumentHistory } from '@/services/documentHistory/store';
import type { Project } from '@/types';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
export async function testDocumentHistoryCodexDependencies(){const P='synthetic-history-type',project:Project={id:P,title:'History type',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:1};try{
 await db.projects.put(project);const template=await saveCodexTemplate(P,{id:'cargo-type',name:'Cargo',category:'custom',fields:{crates:'3',total:''},content:'',propertyDefinitions:[{id:'crates',key:'crates',label:'Crates',kind:'number'},{id:'total',key:'total',label:'Total',kind:'number',formula:'=@[Crates]*7'}],revision:0,createdAt:1,updatedAt:1},null);
 await db.codexEntries.put({id:'cargo-history',projectId:P,title:'Cargo',type:'custom',templateId:template.id,fields:{crates:'3'},content:'',tags:[],relations:[],createdAt:1,updatedAt:1});await db.codexEntries.update('cargo-history',{fields:{crates:'4'}});const original=(await listDocumentHistory(P,'codex','cargo-history'))[0];const raw=(await getDocumentHistory(P,'codex','cargo-history',original.id)).version;
 await deleteCodexTemplate(P,template.id,template.revision);await restoreDocumentHistory(P,'codex','cargo-history',original.id,(await readHistoryPresent(P,'codex','cargo-history'))!.version);
 const restored=(await db.codexEntries.get('cargo-history'))!;assert(projectCodexEntry(restored,[]).fields.total==='21','Retired type lost formula in restored Base history');assert((await getDocumentHistory(P,'codex','cargo-history',original.id)).version===raw,'Dependency retention rewrote authored preimage');await db.codexEntries.update(restored.id,{fields:{crates:'5'}});assert(projectCodexEntry((await db.codexEntries.get(restored.id))!,[]).fields.total==='35','Restored formula became stale snapshot');return['Base history restores live formula definitions after type retirement without rewriting its authored preimage'];
 }finally{await deleteProject(P);}}
