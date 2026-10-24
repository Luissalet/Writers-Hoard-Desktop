import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData,exportFullDatabase,importFullDatabase} from '@/db/operations';
import {previewProjectDuplicate,duplicateProject} from '@/services/projectDuplicate/service';
import {createProjectZipArchive,importProjectZip,createFullZipArchive,importFullZip} from '@/services/zipBackup';
import {saveWorldEra,readWorldDocument,saveEraDocument,hideEraDocument,resetEraDocument} from '@/services/worldEras/store';
import {serializeEdits,deserializeEdits} from '@/engines/worldgen/core/edits';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {placeIconFixture,placeIconPng,assertPlaceImage} from './worldgen-place-icons.browser';

export async function testWorldgenPlaceIconsPortability(){
 const f=await placeIconFixture('portable'),copies:string[]=[],image={dataUrl:placeIconPng(),mode:'colour'};
 try{
  const changed=await runBridgeTool('wh_style_place',{worldId:f.worldId,key:f.key,style:{model:'cabin',icon:'HQ',iconImage:image}});assertPlaceImage(changed.ok,'Portable fixture image could not be saved');const expected=(await db.generatedWorlds.get(f.worldId))!.edits;
  const scope={projectId:f.projectId,eraId:'past'};await saveWorldEra(f.projectId,{id:'past',name:'Past icons',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const inherited=(await readWorldDocument(scope,'worldgen',f.worldId))!;let variant=await saveEraDocument(scope,'worldgen',{...inherited.document,root:{...inherited.document.root,edits:serializeEdits([...deserializeEdits(expected!),{kind:'style',target:'settlement',key:f.key,style:{iconImage:{...image,mode:'inked'}}}])}},inherited.version);
  variant=await saveEraDocument(scope,'worldgen',{...variant.document,root:{...variant.document.root,title:'Past marker title'}},variant.version);await hideEraDocument(scope,'worldgen',f.worldId,variant.version);const hidden=(await db.worldEraVariants.where('projectId').equals(f.projectId).first())!;await resetEraDocument(scope,'worldgen',f.worldId,hidden.revision);
  const originalVariant=JSON.stringify((await db.worldEraVariants.where('projectId').equals(f.projectId).toArray()).map(row=>({archived:row.archived,hidden:row.hidden,document:row.document,history:row.history})));
  assertPlaceImage((await db.generatedWorlds.get(f.worldId))!.edits===expected,'Era/history/archive changed Base copied image');
  const assertCopy=async(projectId:string,exactVariant=false)=>{
   const rows=await db.generatedWorlds.where('projectId').equals(projectId).toArray(),world=rows.find(row=>row.title==='Own marker world');assertPlaceImage(world?.edits===expected,'Roundtrip changed copied bytes, mode, key, model or symbol');
   const variants=await db.worldEraVariants.where('projectId').equals(projectId).toArray();assertPlaceImage(variants.length===1&&variants[0].archived&&variants[0].history?.some(row=>row.hidden),'Variant archive/hidden history disappeared');
   const text=JSON.stringify(variants);assertPlaceImage(text.includes(image.dataUrl)&&text.includes('inked'),'Era history lost copied image/mode');assertPlaceImage(variants[0].entityId===world.id,'Variant retained source world ID');if(exactVariant)assertPlaceImage(JSON.stringify(variants.map(row=>({archived:row.archived,hidden:row.hidden,document:row.document,history:row.history})))===originalVariant,'Same-project restore changed historical payload');
  };
  let copy=await importProjectData(await exportProjectData(f.projectId));copies.push(copy);await assertCopy(copy);await deleteProject(copy);copies.pop();
  const preview=await previewProjectDuplicate({projectId:f.projectId}),duplicate=await duplicateProject({projectId:f.projectId,title:'Duplicate markers',operationId:crypto.randomUUID(),expectedSourceVersion:preview.sourceVersion});copies.push(duplicate.projectId);await assertCopy(duplicate.projectId);await deleteProject(duplicate.projectId);copies.pop();
  const projectZip=await createProjectZipArchive(f.projectId);await db.generatedWorlds.update(f.worldId,{edits:'[]'});await importProjectZip(new File([projectZip.blob],projectZip.fileName),{replaceProjectIds:[f.projectId]});await assertCopy(f.projectId,true);
  const fullZip=await createFullZipArchive();await db.generatedWorlds.update(f.worldId,{edits:'[]'});await importFullZip(new File([fullZip.blob],fullZip.fileName));await assertCopy(f.projectId,true);
  const fullJson=await exportFullDatabase();await db.generatedWorlds.update(f.worldId,{edits:'[]'});await importFullDatabase(fullJson);await assertCopy(f.projectId,true);
  return ['Native Project JSON/Full JSON, Duplicate, Project ZIP/Full ZIP preserve exact image/mode/source key/model/symbol and Base/era hidden/history/archive payloads without a schema or remapper change'];
 }finally{for(const id of copies)await deleteProject(id);await f.cleanup();}
}
