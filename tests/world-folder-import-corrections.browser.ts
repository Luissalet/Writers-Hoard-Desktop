import '@/engines';
import '@/services/aiBridge/dispatch';
import Dexie from 'dexie';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {base64FromBytes} from '@/services/documents/client';
import {inspectWorldFolderImport} from '@/services/worldFolderImport/plan';
import {applyWorldFolderImport} from '@/services/worldFolderImport/persist';
import {deleteLocalMedia} from '@/engines/media/operations';
import {readWorldDocument} from '@/services/worldEras/store';
import type {WorldFolderInput} from '@/services/worldFolderImport/types';
import {folderProject,worldFolderFixture} from './world-folder-import.browser';
const file=(path:string,text:string)=>({path,dataBase64:base64FromBytes(new TextEncoder().encode(text))});
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}

export async function testWorldFolderDeletedMediaRace(){
 const out:string[]=[];
 for(const eraId of [undefined,'past']){
  const projectId=await folderProject(),scope={projectId,eraId};
  const database=db as unknown as {transaction:(...args:unknown[])=>Promise<unknown>},original=database.transaction;
  try{
   const audio=worldFolderFixture().files.find(source=>source.path==='assets/tone.wav')!,initial:WorldFolderInput={format:'obsidian',files:[audio],decisions:[{path:audio.path,include:true}]},first=await inspectWorldFolderImport(scope,initial),created=await applyWorldFolderImport(scope,initial,first.digest),assetId=created.created[0].id;
   const input:WorldFolderInput={format:'obsidian',files:[audio,file('New.md','# New\n\n[Listen](assets/tone.wav)')]},plan=await inspectWorldFolderImport(scope,input);
   check(!plan.findings.some(finding=>finding.blocking)&&plan.assets.some(asset=>asset.used&&asset.status==='duplicate'),'pre-race media was not available');
   let armed=true,deleted=false;
   // Phase injection only: both deletion and Apply still use their actual DB
   // operations. Delete after preparation and immediately before Apply's RW.
   database.transaction=(...args:unknown[])=>{
    if(armed&&args[0]==='rw'){
     armed=false;
     return Dexie.ignoreTransaction(async()=>{await deleteLocalMedia(projectId,assetId,eraId);deleted=true;return original.apply(db,args);});
    }
    return original.apply(db,args);
   };
   let reason='';try{await applyWorldFolderImport(scope,input,plan.digest);}catch(error){reason=error instanceof Error?error.message:String(error);}finally{database.transaction=original;}
   check(deleted&&reason==='world_folder_attachment_missing',`${eraId??'Base'}: race did not reach RW duplicate-media preflight: ${reason}`);
   check(!await readWorldDocument(scope,'media',assetId)&&!await db.codexEntries.where('projectId').equals(projectId).count()&&(await db.projects.get(projectId))!.worldFolderImports!.length===1,'race created dependent prose, resurrected media or appended a receipt');
   if(eraId)check(!(await db.worldEraVariants.where('projectId').equals(projectId).toArray()).some(row=>row.kind==='codex'),'race leaked own-era prose');
   out.push(`${eraId??'Base'} real deletion after preparation is rejected by RW media-existence check, with no note/receipt creation or resurrection`);
  }finally{database.transaction=original;await deleteProject(projectId);}
 }
 return out;
}

export async function testWorldFolderExactSourceAssociation(){
 const projectId=await folderProject(),scope={projectId,eraId:'past'};let clone:string|undefined;
 try{
  const second=file('a.md#folder/second.md','# Second\nOwn original Café 🧭\n\n![Own](pic.png)'),pixel=worldFolderFixture().files.find(source=>source.path==='assets/pixel.png')!;
  const input:WorldFolderInput={format:'notion',files:[file('a.md','# First\nOriginal first'),second,{...pixel,path:'a.md#folder/pic.png'}],decisions:[{path:'a.md',target:'writings'},{path:second.path,target:'writings'}]},plan=await inspectWorldFolderImport(scope,input);
  check(!plan.findings.some(finding=>finding.blocking)&&plan.rows.find(row=>row.path===second.path)?.content?.includes('data:image/png;base64,'),'exact source path did not supply its own relative attachment directory');
  const applied=await applyWorldFolderImport(scope,input,plan.digest),ref=applied.created.find(ref=>ref.path===second.path)!,writing=(await readWorldDocument(scope,'writings',ref.id))!.document.root;
  const source=await db.manuscriptSources.get((writing.manuscriptSource as {sourceId:string}).sourceId);check(source?.name===second.path&&base64FromBytes(new Uint8Array(await source.original.arrayBuffer()))===second.dataBase64,'named-era original bytes mismatch');
  const receipt=(await db.projects.get(projectId))!.worldFolderImports![0];check(receipt.files.some(file=>file.path===second.path),'receipt omitted exact # source file');
  clone=await importProjectData(await exportProjectData(projectId));const copied=await db.manuscriptSources.where('projectId').equals(clone).toArray(),original=copied.find(source=>source.name===second.path);check(original&&base64FromBytes(new Uint8Array(await original.original.arrayBuffer()))===second.dataBase64,'clone lost exact original bytes');
  return ['Named-era # filename uses its exact source for original bytes, relative raster directory and receipt membership, surviving real JSON clone'];
 }finally{if(clone)await deleteProject(clone);await deleteProject(projectId);}
}

export async function testWorldFolderCorrectionsNative(){
 const projectId=await folderProject(),scope={projectId},native=(window as unknown as {qaNative:{call(name:string,args:unknown):Promise<{ok:boolean;result:any}>}}).qaNative;
 try{
  const audio=worldFolderFixture().files.find(source=>source.path==='assets/tone.wav')!,initial:WorldFolderInput={format:'obsidian',files:[audio],decisions:[{path:audio.path,include:true}]};
  const first=await native.call('wh_world_folder_import_preview',{...scope,...initial});check(first.ok,'native initial media preview');const created=await native.call('wh_world_folder_import_apply',{...scope,...initial,expectedDigest:first.result.digest});check(created.ok,'native media import');await deleteLocalMedia(projectId,created.result.created[0].id);
  const followup:WorldFolderInput={format:'obsidian',files:[audio,file('new.md','# New\n[Listen](assets/tone.wav)')]},preview=await native.call('wh_world_folder_import_preview',{...scope,...followup});check(preview.ok&&preview.result.findings.some((finding:{code:string;blocking:boolean})=>finding.code==='imported_attachment_missing'&&finding.blocking),'native preview omitted missing-media finding');const refused=await native.call('wh_world_folder_import_apply',{...scope,...followup,expectedDigest:preview.result.digest});check(!refused.ok&&JSON.stringify(refused.result).includes('world_folder_plan_has_findings')&&!await db.codexEntries.where('projectId').equals(projectId).count(),'native Apply created dependent prose');
  const era={projectId,eraId:'past'},firstChapter=file('a.md','# First\nOriginal first'),secondChapter=file('a.md#second.md','# Second\nDistinct original Café 🧭'),input:WorldFolderInput={format:'notion',files:[firstChapter,secondChapter],decisions:[{path:firstChapter.path,target:'writings'},{path:secondChapter.path,target:'writings'}]},planned=await native.call('wh_world_folder_import_preview',{...era,...input});check(planned.ok,'native exact-path plan');const applied=await native.call('wh_world_folder_import_apply',{...era,...input,expectedDigest:planned.result.digest});check(applied.ok,'native exact-path Apply');
  for(const ref of applied.result.created as {kind:string;id:string;path:string}[]){const read=await readWorldDocument(era,'writings',ref.id);check(read,'native era writing absent');const sourceId=(read.document.root.manuscriptSource as {sourceId:string}).sourceId,exported=await native.call('wh_manuscript_source_export',{...era,sourceId}),expected=input.files.find(source=>source.path===ref.path)!;check(exported.ok&&exported.result.dataBase64===expected.dataBase64,'native original export is not its exact source bytes');}
  return ['Actual external stdio/HTTP/IPC reports/refuses deleted imported media; named-era # chapter sources export byte-exact through normal manuscript API'];
 }finally{await deleteProject(projectId);}
}

export async function testWorldFolderMissingMediaUi(){
 const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{default:Panel}=await import('@/components/import/WorldFolderImportPanel'),{EnginePaneContext}=await import('@/engines/_shared/EnginePaneContext');
 const projectId=await folderProject(),scope={projectId},host=document.getElementById('root')!,root=createRoot(host);
 const pause=()=>new Promise(resolve=>setTimeout(resolve,20)),until=async(check:()=>boolean)=>{for(let index=0;index<250;index++){if(check())return;await act(async()=>{await pause();});}throw Error('Missing-media normal panel did not settle: '+host.textContent);};
 try{
  const audio=worldFolderFixture().files.find(source=>source.path==='assets/tone.wav')!,initial:WorldFolderInput={format:'obsidian',files:[audio],decisions:[{path:audio.path,include:true}]},plan=await inspectWorldFolderImport(scope,initial),created=await applyWorldFolderImport(scope,initial,plan.digest);await deleteLocalMedia(projectId,created.created[0].id);
  await act(async()=>{root.render(createElement(EnginePaneContext.Provider,{value:{instanceId:'missing-media',projectId,visible:true,primary:true}},createElement(Panel,{projectId,onChanged:()=>undefined})));await pause();});
  const transfer=new DataTransfer();for(const source of [audio,file('new.md','# New\n[Listen](assets/tone.wav)')]){const content=new File([Uint8Array.from(atob(source.dataBase64),char=>char.charCodeAt(0))],source.path.split('/').at(-1)!);Object.defineProperty(content,'webkitRelativePath',{value:source.path});transfer.items.add(content);}
  await act(async()=>{const input=host.querySelector<HTMLInputElement>('[data-testid=world-folder-files]')!;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});await until(()=>!host.querySelector<HTMLButtonElement>('[data-testid=world-folder-preview]')!.disabled);await act(async()=>{host.querySelector<HTMLButtonElement>('[data-testid=world-folder-preview]')!.click();});
  await until(()=>host.textContent?.includes('imported_attachment_missing')===true);check(host.querySelector<HTMLButtonElement>('[data-testid=world-folder-apply]')?.disabled&&Array.from(host.querySelectorAll('details[open]')).some(details=>details.textContent?.includes('imported_attachment_missing'))&&!await db.codexEntries.where('projectId').equals(projectId).count(),'normal visible finding did not block creation');
  return ['Normal panel displays the deleted-media blocking finding in its open findings disclosure and disables Apply without writing a note'];
 }finally{await act(async()=>root.unmount());await deleteProject(projectId);}
}
