import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {base64FromBytes} from '@/services/documents/client';
import {inspectWorldFolderImport} from '@/services/worldFolderImport/plan';
import {applyWorldFolderImport,undoWorldFolderImport} from '@/services/worldFolderImport/persist';
import type {WorldFolderInput} from '@/services/worldFolderImport/types';
import {deleteLocalMedia} from '@/engines/media/operations';
import {readWorldDocument} from '@/services/worldEras/store';
import {folderProject,worldFolderFixture} from './world-folder-import.browser';
const file=(path:string,text:string)=>({path,dataBase64:base64FromBytes(new TextEncoder().encode(text))});
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}

export async function testWorldFolderIndependentSafety(){
 const P=await folderProject(),scope={projectId:P},results:string[]=[];
 try{
  const input=worldFolderFixture(),plan=await inspectWorldFolderImport(scope,input),before=JSON.stringify(await db.projects.get(P));
  const failReceipt=(changes:Record<string,unknown>)=>{if('worldFolderImports'in changes)throw Error('Own late receipt write failure');};
  db.projects.hook('updating',failReceipt);
  let failed=false;try{await applyWorldFolderImport(scope,input,plan.digest);}catch(error){failed=String(error).includes('Own late receipt');}finally{db.projects.hook('updating').unsubscribe(failReceipt);}
  check(failed&&JSON.stringify(await db.projects.get(P))===before,'Late receipt failure changed project');
  for(const table of [db.codexEntries,db.writings,db.manuscriptSources,db.localMediaAssets,db.timelines,db.timelineEvents,db.documentHistory,db.worldEraVariants])check(await table.where('projectId').equals(P).count()===0,'Late receipt failure leaked '+table.name);
  const applied=await applyWorldFolderImport(scope,input,plan.digest);check(applied.created.length===7,'Retry after late failure failed');await undoWorldFolderImport(scope,applied.receiptId!);
  const source=await db.manuscriptSources.where('projectId').equals(P).first(),original=input.files.find(f=>f.path==='Book/Start.md')!;
  check(source&&base64FromBytes(new Uint8Array(await source.original.arrayBuffer()))===original.dataBase64,'Undo did not preserve exact immutable chapter original');
  results.push('Independent late receipt-write failure rolls back every destination/source/history and unchanged project; retry works and Undo retains exact chapter bytes');
  const changed={...input,decisions:input.decisions?.map(d=>d.path==='data/events.csv'?{...d,csv:{mapping:{title:0,start:99}}}:d)},bad=await inspectWorldFolderImport(scope,changed);
  check(bad.findings.some(f=>f.blocking),'Out-of-range mapping lacks blocking finding');const snapshot=JSON.stringify(await db.projects.get(P));let refused=false;try{await applyWorldFolderImport(scope,changed,bad.digest);}catch{refused=true;}check(refused&&JSON.stringify(await db.projects.get(P))===snapshot&&!await db.codexEntries.where('projectId').equals(P).count(),'Invalid mapping wrote partial destinations');
  results.push('Out-of-range timeline mapping is a blocking plan and applies zero mixed writes');
  return results;
 }finally{await deleteProject(P);}
}

export async function testWorldFolderIndependentDeletedMedia(){
 const results:string[]=[];
 for(const eraId of [undefined,'past']){
  const P=await folderProject(),scope={projectId:P,eraId};
  try{
   const audio=worldFolderFixture().files.find(f=>f.path==='assets/tone.wav')!,initial:WorldFolderInput={format:'obsidian',files:[audio],decisions:[{path:audio.path,include:true}]};
   const first=await inspectWorldFolderImport(scope,initial),created=await applyWorldFolderImport(scope,initial,first.digest),id=created.created[0].id;
   await deleteLocalMedia(P,id,eraId);check(!await readWorldDocument(scope,'media',id),'Normal media deletion did not remove target');
   const followup:WorldFolderInput={format:'obsidian',files:[audio,file('New note.md','# New note\n\n[Listen](assets/tone.wav)')]},plan=await inspectWorldFolderImport(scope,followup);
   const refused=plan.findings.some(f=>f.blocking);let applied:any;
   if(!refused)applied=await applyWorldFolderImport(scope,followup,plan.digest);
   const note=applied?.created.find((r:any)=>r.kind==='codex'),content=note?(await readWorldDocument(scope,'codex',note.id))!.document.root.content:'';
   check(refused,`${eraId??'Base'}: missing prior media was accepted as duplicate; created dangling note=${note?.id}; targetExists=${!!await readWorldDocument(scope,'media',id)}; HTML=${content}; findings=${JSON.stringify(plan.findings)}`);
   results.push(`${eraId??'Base'}: new note cannot reference deleted imported media without an explicit blocking finding`);
  }finally{await deleteProject(P);}
 }
 return results;
}

export async function testWorldFolderIndependentSourcePaths(){
 const P=await folderProject(),scope={projectId:P};
 try{
  const input:WorldFolderInput={format:'notion',files:[file('a.md','# First\nOriginal first'),file('a.md#second.md','# Second\nDistinct original Café 🧭')],decisions:[{path:'a.md',target:'writings'},{path:'a.md#second.md',target:'writings'}]},plan=await inspectWorldFolderImport(scope,input);
  check(!plan.findings.some(f=>f.blocking),'Valid distinct filenames were rejected');const result=await applyWorldFolderImport(scope,input,plan.digest);
  for(const ref of result.created){const row=(await db.writings.get(ref.id))!,source=await db.manuscriptSources.get(row.manuscriptSource!.sourceId),expected=input.files.find(f=>f.path===ref.path)!;
   check(source&&base64FromBytes(new Uint8Array(await source.original.arrayBuffer()))===expected.dataBase64,`Exact chapter source mismatch for ${ref.path}; storedName=${source?.name}; original=${source?await source.original.text():''}`);
  }
  return ['Distinct filenames containing # preserve their own immutable chapter source bytes'];
 }finally{await deleteProject(P);}
}
