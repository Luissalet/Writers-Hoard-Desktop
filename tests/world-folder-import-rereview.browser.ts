import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {base64FromBytes} from '@/services/documents/client';
import {inspectWorldFolderImport} from '@/services/worldFolderImport/plan';
import {applyWorldFolderImport,undoWorldFolderImport} from '@/services/worldFolderImport/persist';
import {updateLocalMedia} from '@/engines/media/operations';
import type {WorldFolderInput} from '@/services/worldFolderImport/types';
import {folderProject,worldFolderFixture} from './world-folder-import.browser';
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const file=(path:string,text:string)=>({path,dataBase64:base64FromBytes(new TextEncoder().encode(text))});
export async function testWorldFolderRereviewControls(){
 const results:string[]=[];let P=await folderProject();
 try{
  const pixel=worldFolderFixture().files.find(f=>f.path==='assets/pixel.png')!;
  const input:WorldFolderInput={format:'notion',files:[file('records.csv','Name,Body\nFirst,First prose'),file('records.csv#folder/records.csv','Name,Body\nSecond,![Own](pic.png)'),{...pixel,path:'records.csv#folder/pic.png'}],decisions:['records.csv','records.csv#folder/records.csv'].map(path=>({path,target:'codex' as const,csv:{mapping:{title:0,description:1}}}))};
  const plan=await inspectWorldFolderImport({projectId:P},input),second=plan.rows.find(r=>r.title==='Second')!;
  check(second.sourcePath==='records.csv#folder/records.csv'&&second.path.endsWith('#row=0')&&second.content?.includes('data:image/png;base64,'),'Virtual CSV record lost exact # source or relative raster');
  const created=await applyWorldFolderImport({projectId:P},input,plan.digest),receipt=(await db.projects.get(P))!.worldFolderImports!.find(r=>r.id===created.batchId)!;
  check(receipt.files.some(f=>f.path==='records.csv')&&receipt.files.some(f=>f.path==='records.csv#folder/records.csv')&&receipt.files.some(f=>f.path==='records.csv#folder/pic.png'),'Receipt did not retain both exact CSV source files and raster');
  check((await db.codexEntries.where('projectId').equals(P).toArray()).find(r=>r.title==='Second')!.content.includes('data:image/png;base64,'),'Apply lost exact CSV attachment association');
  results.push('Own CSV virtual-row control: raw # directory keeps exact sourcePath, relative raster and all receipt file hashes');
 }finally{await deleteProject(P);}
 P=await folderProject();
 try{
  const scope={projectId:P},audio=worldFolderFixture().files.find(f=>f.path==='assets/tone.wav')!,initial:WorldFolderInput={format:'obsidian',files:[audio],decisions:[{path:audio.path,include:true}]};
  const first=await applyWorldFolderImport(scope,initial,(await inspectWorldFolderImport(scope,initial)).digest),id=first.created[0].id;
  await updateLocalMedia(P,id,{title:'Later authored title',notes:'Later authored notes',tags:['preserve'],linkedEntryIds:[]});
  const before=(await db.localMediaAssets.get(id))!,input:WorldFolderInput={format:'obsidian',files:[audio,file('new.md','# New\n[Listen](assets/tone.wav)')]},plan=await inspectWorldFolderImport(scope,input);
  check(!plan.findings.some(f=>f.blocking),'Available duplicate media with later metadata was incorrectly blocked');
  const next=await applyWorldFolderImport(scope,input,plan.digest);check(next.created.length===1&&next.created[0].kind==='codex'&&await db.localMediaAssets.where('projectId').equals(P).count()===1,'Valid reuse duplicated or rewrote media');
  await undoWorldFolderImport(scope,next.receiptId!);const after=(await db.localMediaAssets.get(id))!;
  check(after.title===before.title&&after.notes===before.notes&&after.updatedAt===before.updatedAt&&after.blob.size===before.blob.size&&(await db.projects.get(P))!.worldFolderImports!.length===1,'Undo of new dependent note changed earlier media/receipt');
  results.push('Own live-target control: available duplicate audio accepts new dependent prose, preserves later metadata, and dependent batch Undo leaves original media intact');
 }finally{await deleteProject(P);}
 return results;
}
