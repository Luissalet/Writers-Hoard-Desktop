import '@/engines';
import Dexie from 'dexie';
import {db} from '@/db';
import {deleteProject,subscribeProjects} from '@/db/operations';
import {createSharedCanonEntity} from '@/services/sharedUniverse/repository';
import {duplicateProject,previewProjectDuplicate,undoProjectDuplicate} from '@/services/projectDuplicate/service';
import {readProjectDuplicate,duplicateSnapshotVersion} from '@/services/projectDuplicate/capture';
import {seedDuplicateCore} from './project-duplicate.browser';

const assert:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
export async function testProjectDuplicateIndependent(){
 const out:string[]=[];
 // A real book binding belongs to the *parent* saga, unlike the author's saga-owned fixture.
 {
  const{id,parent}=await seedDuplicateCore(),copies:string[]=[];
  try{
   const shared=await createSharedCanonEntity({seriesId:parent,projectId:id,kind:'character',title:'Iria shared',source:{engineId:'codex',entityType:'codex-entry',entityId:'same'}});
   const original=await db.sharedCanonEntities.get(shared.entity.id),sourceBinding=await db.sharedEntityBindings.get(shared.binding.id);
   const preview=await previewProjectDuplicate({projectId:id}),operationId=crypto.randomUUID(),input={projectId:id,title:'Shared sibling',operationId,expectedSourceVersion:preview.sourceVersion};
   const [one,two]=await Promise.all([duplicateProject(input),duplicateProject({...input})]);copies.push(one.projectId);
   assert(one.projectId===two.projectId&&await db.projects.where('parentId').equals(parent).count()===2,'simultaneous same operation created two siblings');
   const card=(await db.codexEntries.where('projectId').equals(one.projectId).first())!,binding=(await db.sharedEntityBindings.where('projectId').equals(one.projectId).first())!;
   assert(binding.id!==sourceBinding!.id&&binding.seriesId===parent&&binding.sharedEntityId===shared.entity.id&&binding.local?.entityId===card.id,'external saga ownership/local book binding split');
   assert(await db.sharedCanonEntities.where('seriesId').equals(one.projectId).count()===0&&JSON.stringify(await db.sharedCanonEntities.get(shared.entity.id))===JSON.stringify(original),'copy appropriated global saga identity');
   let rejected=false;try{await duplicateProject({...input,title:'Different operation content'});}catch(error){rejected=String(error).includes('operation_conflict');}assert(rejected,'same operation accepted changed arguments');
   await db.projects.update(parent,{description:'New independent saga note'});await undoProjectDuplicate(operationId);
   assert((await db.projects.get(parent))!.description==='New independent saga note'&&JSON.stringify(await db.sharedEntityBindings.get(shared.binding.id))===JSON.stringify(sourceBinding)&&JSON.stringify(await db.sharedCanonEntities.get(shared.entity.id))===JSON.stringify(original),'Undo removed shared original or unrelated parent edit');
   out.push('Normal shared-universe creation → sibling duplicate: existing parent identity retained, local Codex remapped, two concurrent same-operation calls create one copy, conflicting replay refused, Undo keeps original binding and later parent prose');
  }finally{for(const copy of copies)await deleteProject(copy);await deleteProject(id);await deleteProject(parent);}
 }
 // Row-set canonicalization must never canonicalize an authored nested ordering.
 {
  const{id,parent}=await seedDuplicateCore();let target='';
  try{
   const table=(await db.projects.get(id))!.dataTables![0];await db.projects.update(id,{dataTables:[{...table,rows:[...table.rows,{id:'second',cells:{character:''}}]}]});
   const before=await duplicateSnapshotVersion({...await readProjectDuplicate(id),parent:undefined}),preview=await previewProjectDuplicate({projectId:id}),operationId=crypto.randomUUID();
   target=(await duplicateProject({projectId:id,title:'Nested authored order',operationId,expectedSourceVersion:preview.sourceVersion})).projectId;
   const copy=(await db.projects.get(target))!;await db.projects.update(target,{dataTables:copy.dataTables!.map(item=>({...item,rows:[...item.rows].reverse()}))});
   let rejected=false;try{await undoProjectDuplicate(operationId);}catch(error){rejected=String(error).includes('undo_changed');}
   assert(rejected&&await db.projects.get(target),'Undo ignored authored nested row order');
   assert(await duplicateSnapshotVersion({...await readProjectDuplicate(id),parent:undefined})===before,'target reorder altered source');
   out.push('Reordering only nested table rows after duplicate is an authored edit: normal Undo refuses; source canonical bytes remain exact');
  }finally{if(target)await deleteProject(target);await deleteProject(id);await deleteProject(parent);}
 }
 // Test the shared deleteProject seam against an actual outer transaction abort.
 {
  const{id,parent}=await seedDuplicateCore();let notices=0;const stop=subscribeProjects(()=>notices++);
  try{
   try{await db.transaction('rw',db.tables,async()=>{await deleteProject(id);throw Error('own_outer_abort');});}catch(error){assert(String(error).includes('own_outer_abort'),'unexpected transaction failure');}
   await Dexie.Promise.resolve();assert(await db.projects.get(id)&&await db.writings.get('same')&&notices===0,'outer rollback leaked deletion or notification');
   assert((await db.projects.get(parent))!.children!.join(',')===id,'outer rollback leaked sibling removal');
   out.push('Normal deleteProject inside aborted outer transaction keeps project, chapter and parent children and emits zero project notifications');
  }finally{stop();await deleteProject(id);await deleteProject(parent);}
 }
 return out;
}
