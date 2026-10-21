import '@/engines';
import JSZip from 'jszip';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData,exportFullDatabase,importFullDatabase} from '@/db/operations';
import {createProjectZipArchive,importProjectZip,createFullZipArchive,importFullZip} from '@/services/zipBackup';
import {saveWorldEra,getEraProject,readWorldDocument,saveEraDocument,restoreEraVersion} from '@/services/worldEras/store';
import {readHistoryPresent,saveDocumentHistory,restoreDocumentHistory} from '@/services/documentHistory/store';
import {restoreArchivedDocument} from '@/services/documentArchive/store';
import {deleteWriting} from '@/engines/writings/operations';
import type {ToolDockLayout} from '@/engines/writings/toolDock/types';
import {readWritingToolDock,applyWritingToolDock} from '@/engines/writings/toolDock/store';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {undoAuditEntry} from '@/services/aiBridge/undo';
import {getProjectsVersion} from '@/db/operations';
import {createLocalDraftStore} from '@/hooks/localDraftStore';
import {preserveLegacyEraWritingToolDock,preserveLegacyProjectMetadata} from '@/services/projectArchiveMetadata';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function rejects(run:()=>Promise<unknown>){let failed=false;try{await run();}catch{failed=true;}check(failed,'Malformed or stale operation was accepted');}
const literal='Exact opaque bytes p-source/card-source <p>do not remap</p>';
function layout(generation:string):ToolDockLayout{return{version:1,revision:4,generation,blocks:[
 {kind:'document',id:'slot-document',height:230,target:{kind:'codex',documentId:'card-source',label:'Literal card-source label'},presentation:'preview'},
 {kind:'owned',id:'owned-slot',height:280,envelope:{version:1,id:'owned-slot',namespace:'tests.dock-unavailable',key:'owned',name:{en:'Owned',es:'Propio'},scope:'host',revision:3,codec:{version:1,fields:{prose:{kind:'prose'},linked:{kind:'reference'}}},data:{prose:literal,linked:{kind:'codex',documentId:'card-source'}}}},
 {kind:'world',id:'world-slot',envelope:{version:1,id:'world-slot',namespace:'tests.dock-unavailable',key:'global',name:{en:'World',es:'Mundo'},scope:'world',world:{kind:'codex',fields:['title']}}},
]};}
async function amendZip(blob:Blob,edit:(row:Record<string,unknown>,path:string)=>void){const zip=await JSZip.loadAsync(await blob.arrayBuffer());for(const path of Object.keys(zip.files)){if(!path.endsWith('.json')||zip.files[path].dir)continue;const row=JSON.parse(await zip.file(path)!.async('string'));if(row&&typeof row==='object'){edit(row,path);zip.file(path,JSON.stringify(row));}}return new File([await zip.generateAsync({type:'uint8array'})],'dock.zip',{type:'application/zip'});}

export async function testToolDockPortability(){
 const P='p-source',W='writing-source',clones:string[]=[],results:string[]=[];
 try{
  await db.projects.put({id:P,title:'Portable dock',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','writings'],engineOrder:['codex','writings'],createdAt:1,updatedAt:1,writingToolDock:layout('project-generation')});
  await db.codexEntries.put({id:'card-source',projectId:P,type:'character',title:'Card source',content:'<p>Card prose.</p>',tags:[],relations:[],createdAt:1,updatedAt:1});
  await db.writings.put({id:W,projectId:P,title:'Writing source',content:'<p>Authored prose stays exact.</p>',wordCount:4,status:'draft',tags:[],createdAt:1,updatedAt:1,toolDock:layout('chapter-generation')});
  await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1,defaults:{writingToolDock:null}},null);
  check((await getEraProject({projectId:P,eraId:'past'})).writingToolDock?.generation==='project-generation','Era explicit null must inherit Base default');
  const base=await readWorldDocument({projectId:P,eraId:'past'},'writings',W);check(base,'Era document missing');const own=structuredClone(base.document);own.root.toolDock=layout('era-generation');await saveEraDocument({projectId:P,eraId:'past'},'writings',own,base.version);
  const clone=await importProjectData(await exportProjectData(P));clones.push(clone);const copiedProject=(await db.projects.get(clone))!,copiedWriting=(await db.writings.where('projectId').equals(clone).first())!,copiedCard=(await db.codexEntries.where('projectId').equals(clone).first())!;
  const verifyClone=(dock:ToolDockLayout|undefined|null)=>{check(dock&&dock.revision===0&&!['project-generation','chapter-generation','era-generation'].includes(dock.generation),'Clone retained dock CAS identity');const reference=dock.blocks[0];check(reference.kind==='document'&&reference.id!=='slot-document'&&reference.target.documentId===copiedCard.id&&reference.target.label==='Literal card-source label','Document slot identity/reference/label remap wrong');const owned=dock.blocks[1];check(owned.kind==='owned'&&owned.id===owned.envelope.id&&owned.id!=='owned-slot'&&owned.envelope.revision===0,'Owned identity/revision wrong');check((owned.envelope.data as any).prose===literal&&(owned.envelope.data as any).linked.documentId===copiedCard.id,'Opaque prose or declared reference remap wrong');check(dock.blocks[2].kind==='world'&&JSON.stringify(dock.blocks[2].envelope.world)===JSON.stringify({kind:'codex',fields:['title']}),'World query changed');};
  verifyClone(copiedProject.writingToolDock);verifyClone(copiedWriting.toolDock);check(copiedWriting.content==='<p>Authored prose stays exact.</p>','Clone changed prose');const clonedEra=(await db.worldEraVariants.where('projectId').equals(clone).first())!;verifyClone(clonedEra.document!.root.toolDock as ToolDockLayout);
  results.push('Project/chapter/era clone remaps all three block classes, declared references, slots and generation; opaque payload, label and prose remain exact; null era default inherits Base');

  const full=await exportFullDatabase();delete full.projects.find(p=>p.id===P)!.writingToolDock;delete full.writings.find(w=>w.id===W)!.toolDock;await importFullDatabase(full);check((await db.projects.get(P))!.writingToolDock?.generation==='project-generation'&&(await db.writings.get(W))!.toolDock?.generation==='chapter-generation','Legacy full JSON erased sidecars');
  const projectZip=await createProjectZipArchive(P),legacy=await amendZip(projectZip.blob,row=>{delete row.writingToolDock;delete row.toolDock;});await importProjectZip(legacy,{replaceProjectIds:[P]});check((await db.projects.get(P))!.writingToolDock?.generation==='project-generation'&&(await db.writings.get(W))!.toolDock?.generation==='chapter-generation','Legacy project ZIP erased sidecars');
  const fullZip=await createFullZipArchive();await importFullZip(await amendZip(fullZip.blob,row=>{delete row.writingToolDock;delete row.toolDock;}));check((await db.projects.get(P))!.writingToolDock?.generation==='project-generation'&&(await db.writings.get(W))!.toolDock?.generation==='chapter-generation','Legacy full ZIP erased sidecars');
  const explicit=await exportFullDatabase();explicit.projects.find(p=>p.id===P)!.writingToolDock=null;explicit.writings.find(w=>w.id===W)!.toolDock=null;await importFullDatabase(explicit);check((await db.projects.get(P))!.writingToolDock===null&&(await db.writings.get(W))!.toolDock===null,'Explicit null did not clear');
  await db.projects.update(P,{writingToolDock:layout('project-generation')});await db.writings.update(W,{toolDock:layout('chapter-generation')});
  results.push('Actual legacy same-ID full JSON/project ZIP/full ZIP preserve absent sidecars; explicit null clears without changing authored prose');

  const before=JSON.stringify(await db.writings.get(W)),invalid=await exportFullDatabase();(invalid.writings.find(w=>w.id===W) as any).toolDock={version:1,revision:0,generation:'bad',blocks:[{kind:'document',id:'slot',target:{kind:'local-tool',documentId:'bad'}}]};await rejects(()=>importFullDatabase(invalid));check(JSON.stringify(await db.writings.get(W))===before,'Invalid full JSON changed data');
  await rejects(async()=>importProjectData({...(await exportProjectData(P)),writings:invalid.writings.filter(w=>w.projectId===P)}));
  const invalidZip=await amendZip((await createProjectZipArchive(P)).blob,(row,path)=>{if(path.includes('/writings/')&&row.id===W)row.toolDock={version:1,revision:0,generation:'bad',blocks:[{kind:'owned',id:'mismatch',envelope:layout('x').blocks[1].kind==='owned'?(layout('x').blocks[1] as any).envelope:undefined}]};});await rejects(()=>importProjectZip(invalidZip,{replaceProjectIds:[P]}));check(JSON.stringify(await db.writings.get(W))===before,'Invalid ZIP changed data');
  results.push('Malformed chapter metadata rejects before clone, destructive full JSON and replacement ZIP; original bytes remain current');

  const present=(await readHistoryPresent(P,'writings',W))!,saved=await saveDocumentHistory(P,'writings',W,present.version);const oldToken=await readWritingToolDock({projectId:P},{kind:'writings',documentId:W});await db.writings.update(W,{title:'Later'});await restoreDocumentHistory(P,'writings',W,saved.id,(await readHistoryPresent(P,'writings',W))!.version);check((await db.writings.get(W))!.toolDock!.generation!=='chapter-generation','History reused dock generation');await rejects(()=>applyWritingToolDock({projectId:P},{kind:'writings',documentId:W},oldToken.version,[{type:'resize',blockId:'slot-document',height:500}]));
  const scope={projectId:P,eraId:'past'},earlier=(await readWorldDocument(scope,'writings',W))!,edited=structuredClone(earlier.document);edited.root.title='Later era';await saveEraDocument(scope,'writings',edited,earlier.version);const row=(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([P,'past','writings',W]).first())!;await restoreEraVersion(scope,'writings',W,row.revision,row.history![0].revision);check((await readWorldDocument(scope,'writings',W))!.document.root.toolDock&&((await readWorldDocument(scope,'writings',W))!.document.root.toolDock as ToolDockLayout).generation!=='era-generation','Era restore reused generation');
  const dockBeforeDelete=(await db.writings.get(W))!.toolDock!;await deleteWriting(W);const archived=(await db.documentArchives.where('projectId').equals(P).toArray()).find(row=>row.kind==='writings'&&row.sourceId===W)!;check(archived,'Normal writing delete made no archive');await restoreArchivedDocument(P,archived.id);check((await db.writings.get(W))!.toolDock!.generation!==dockBeforeDelete.generation,'Archive restore reused generation');
  results.push('Normal Base history, own-era history and archived document restores renew dock generations; pre-restore layout token cannot write');
  return results;
 }finally{for(const id of clones)await deleteProject(id);await deleteProject(P);}
}

export async function testToolDockGlobalUndo(){
 const P='dock-global-undo',owner={kind:'project' as const};
 try{
  await db.projects.put({id:P,title:P,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1,writingToolDock:layout('global-undo')});
  const read=await runBridgeTool('wh_writing_tool_dock_read',{projectId:P,owner});check(read.ok,'Dock read not registered');
  const changed=await runBridgeTool('wh_writing_tool_dock_apply',{projectId:P,owner,expectedVersion:(read.result as any).version,actions:[{type:'resize',blockId:'slot-document',height:420}]});check(changed.ok,'Dock apply not registered');
  const audit=(changed.result as any).__audit;check(audit?.before.__writingToolDockReceipt&&audit.entityId===P,'Project dock audit owner missing');
  await db.projects.update(P,{enabledEngines:[]});await undoAuditEntry({entry:{...audit,tool:'wh_writing_tool_dock_apply'}});check((await db.projects.get(P))!.writingToolDock?.blocks[0].height===230,'Global Undo did not restore Project dock with engine disabled');await rejects(()=>undoAuditEntry({entry:{...audit,tool:'wh_writing_tool_dock_apply'}}));
  return['Normal registered MCP Project-dock read/apply and audit Undo preserve real Project owner, work after engine disable, consume receipt once'];
 }finally{await deleteProject(P);}
}

export async function testNestedProjectDeleteCommit(){
 const P='delete-project-outer-commit',drafts=createLocalDraftStore<{text:string}>(`wh.codex-drafts.v1.${P}`,(value):value is {text:string}=>!!value&&typeof value==='object');
 try{
  await db.projects.put({id:P,title:P,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:[],engineOrder:[],createdAt:1,updatedAt:1});drafts.set('pending',{text:'Exact unsaved draft'});await Promise.resolve();const before=getProjectsVersion();
  await rejects(()=>db.transaction('rw',db.tables,async()=>{await deleteProject(P);check(getProjectsVersion()===before&&drafts.get('pending')?.text==='Exact unsaved draft','Nested delete published or cleared draft before commit');throw Error('Outer abort');}));
  check(await db.projects.get(P)&&getProjectsVersion()===before&&drafts.has('pending'),'Outer abort leaked delete side effects');
  await db.transaction('rw',db.tables,async()=>{await deleteProject(P);check(getProjectsVersion()===before&&drafts.has('pending'),'Successful nested delete announced prematurely');});await Promise.resolve();
  check(!await db.projects.get(P)&&getProjectsVersion()===before+1&&!drafts.size,'Committed nested deletion did not publish/clear exactly once');
  return['Normal nested project delete clears draft recovery and announces exactly once after outer commit; outer abort retains database, draft bytes and notification version'];
 }finally{await deleteProject(P);}
}

export async function testToolDockLegacyEraSidecars(){
 const P='legacy-era-dock',W='legacy-era-chapter',scope={projectId:P,eraId:'past'};
 try{
  await db.projects.put({id:P,title:P,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1,writingToolDock:layout('base-default')});
  await db.writings.put({id:W,projectId:P,title:'Era chapter',content:'<p>Exact old prose.</p>',wordCount:3,status:'draft',tags:[],createdAt:1,updatedAt:1});
  await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1,defaults:{writingToolDock:layout('era-default')}},null);
  const base=(await readWorldDocument(scope,'writings',W))!,own=structuredClone(base.document);own.root.toolDock=layout('era-chapter');await saveEraDocument(scope,'writings',own,base.version);
  const full=await exportFullDatabase();delete full.projects.find(row=>row.id===P)!.worldEras![0].defaults!.writingToolDock;const variant=(full.worldEraVariants as any[]).find(row=>row.projectId===P);delete variant.document.root.toolDock;
  await importFullDatabase(full);
  const defaultKept=(await getEraProject(scope)).writingToolDock?.generation==='era-default',chapterKept=((await readWorldDocument(scope,'writings',W))!.document.root.toolDock as ToolDockLayout|undefined)?.generation==='era-chapter';
  check(defaultKept&&chapterKept,`Legacy era sidecars lost: default=${defaultKept}, chapter=${chapterKept}`);
  const strip=(row:Record<string,unknown>)=>{const walk=(value:unknown):void=>{if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object'){const record=value as Record<string,unknown>;delete record.writingToolDock;delete record.toolDock;Object.values(record).forEach(walk);}};walk(row);};
  const zip=await createProjectZipArchive(P);const legacyZip=await amendZip(zip.blob,strip);await importProjectZip(legacyZip,{replaceProjectIds:[P]});
  check((await getEraProject(scope)).writingToolDock?.generation==='era-default'&&((await readWorldDocument(scope,'writings',W))!.document.root.toolDock as ToolDockLayout).generation==='era-chapter','Legacy project ZIP erased era sidecars');
  await importFullZip(await amendZip((await createFullZipArchive()).blob,strip));
  check((await getEraProject(scope)).writingToolDock?.generation==='era-default'&&((await readWorldDocument(scope,'writings',W))!.document.root.toolDock as ToolDockLayout).generation==='era-chapter','Legacy full ZIP erased era sidecars');
  const previous=(await db.worldEraVariants.where('projectId').equals(P).first())!,missing=structuredClone(previous);delete missing.document!.root.toolDock;
  for(const field of ['projectId','eraId','entityId'] as const){const foreign={...previous,[field]:`foreign-${field}`};check(preserveLegacyEraWritingToolDock(missing,foreign).document!.root.toolDock===undefined,`Borrowed sidecar from foreign ${field}`);}
  const retained=structuredClone(missing);retained.history=[{revision:previous.revision,document:structuredClone(missing.document!),hidden:false,updatedAt:1}];
  check((preserveLegacyEraWritingToolDock(retained,previous).history![0].document!.root.toolDock as ToolDockLayout)?.generation==='era-chapter','Exact retained revision lost its sidecar');
  retained.history![0].revision=previous.revision+100;check(preserveLegacyEraWritingToolDock(retained,previous).history![0].document!.root.toolDock===undefined,'Borrowed sidecar across retained revisions');
  const existingProject=(await db.projects.get(P))!;check(preserveLegacyProjectMetadata({...existingProject,worldEras:[]},existingProject).worldEras?.length===0,'Absent era was resurrected');
  const explicit=await exportFullDatabase();explicit.projects.find(row=>row.id===P)!.worldEras![0].defaults!.writingToolDock=null;const explicitVariant=(explicit.worldEraVariants as any[]).find(row=>row.projectId===P);explicitVariant.document.root.toolDock=null;await importFullDatabase(explicit);
  check((await getEraProject(scope)).writingToolDock?.generation==='base-default'&&(await readWorldDocument(scope,'writings',W))!.document.root.toolDock===null,'Explicit era null failed to inherit/clear');
  return['Legacy same-ID full JSON, project ZIP and full ZIP preserve absent named-era default and own chapter sidecars; explicit null inherits Base and clears chapter override; no borrowing across scope/history revision or resurrecting absent eras'];
 }finally{await deleteProject(P);}
}
