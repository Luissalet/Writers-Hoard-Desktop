import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import type {CodexEntry,Project} from '@/types';
import {createLibraryCodex,undoLibraryCodexCreation} from '@/components/project/workspace/library/createCodex';
import {readWorkspaceLibrary} from '@/components/project/workspace/library/model';
import {updateWorkspaceLibrary} from '@/components/project/workspace/library/store';
import {getEraProject,readWorldDocument,saveWorldEra} from '@/services/worldEras/store';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {undoAuditEntry} from '@/services/aiBridge/undo';
import {saveCodexTemplate} from '@/engines/codex/templates';
import {registerLocalToolModules} from '@/engines/local/registry';
import initiative from '@/engines/local/examples/initiativeDefinition';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock,findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import {readLocalToolBlock,applyLocalToolBlockActions} from '@/engines/local/blocks/operations';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function rejects(run:()=>Promise<unknown>){let failed=false;try{await run();}catch{failed=true;}check(failed,'Expected conflict');}
const project=(id:string):Project=>({id,title:id,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','local-tool-'+initiative.namespace],engineOrder:['codex'],createdAt:1,updatedAt:1,workspaceRevision:0,workspaceFolders:[{id:'parent',name:'People',order:0},{id:'child',name:'Friends',parentId:'parent',order:0}],workspacePlacements:[]});
const card=(projectId:string,id:string):CodexEntry=>({id,projectId,title:id,type:'character',fields:{Alias:'Keep me'},content:'<p>Exact authored prose.</p>',tags:['keep'],relations:[],createdAt:1,updatedAt:1});

export async function testLibraryCreate(){
 const P='library-create-synthetic',F='library-create-foreign',results:string[]=[];registerLocalToolModules({'./installed/examples.initiative/module.tsx':{default:initiative}});
 try{
  await db.projects.bulkPut([project(P),project(F)]);
  const base={projectId:P},created=await createLibraryCodex(base,card(P,'first'),0,'child');check((await db.codexEntries.get('first'))!.content==='<p>Exact authored prose.</p>'&&created.placement.folderId==='child','Card/placement not saved together');
  await createLibraryCodex(base,card(P,'second'),1,'child');const library=readWorkspaceLibrary((await db.projects.get(P))!);check(library.placements.find(row=>row.entityId==='second')!.order>library.placements.find(row=>row.entityId==='first')!.order,'Creation did not append after existing folder sibling');
  await rejects(()=>createLibraryCodex(base,card(P,'stale'),0,'child'));check(!await db.codexEntries.get('stale'),'Stale library created orphan');
  await rejects(()=>createLibraryCodex(base,card(P,'missing'),library.revision,'removed'));check(!await db.codexEntries.get('missing'),'Removed folder created orphan');
  await rejects(()=>db.transaction('rw',db.tables,async()=>{await createLibraryCodex(base,card(P,'abort'),library.revision,'child');throw Error('Outer abort');}));check(!await db.codexEntries.get('abort')&&readWorkspaceLibrary((await db.projects.get(P))!).revision===library.revision,'Outer abort leaked card or placement');
  await db.codexEntries.put(card(F,'foreign-id'));await rejects(()=>createLibraryCodex(base,card(P,'foreign-id'),library.revision,'child'));check((await db.codexEntries.get('foreign-id'))!.projectId===F,'Foreign card stolen');
  await db.projects.update(P,{enabledEngines:[]});await rejects(()=>createLibraryCodex(base,card(P,'disabled'),library.revision,'child'));check(!await db.codexEntries.get('disabled'),'Disabled engine accepted create');await db.projects.update(P,{enabledEngines:project(P).enabledEngines});
  results.push('Base card+placement atomic, append order, stale/removed destination/foreign ID/outer abort/engine-disabled create no orphan or overwritten card');

  await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);const era={projectId:P,eraId:'past'},eraRevision=readWorkspaceLibrary(await getEraProject(era)).revision;
  const own=await createLibraryCodex(era,card(P,'era-only'),eraRevision,'child');check(!await db.codexEntries.get('era-only')&&await readWorldDocument(era,'codex','era-only'),'Era creation touched Base/missing variant');check(!readWorkspaceLibrary((await db.projects.get(P))!).placements.some(row=>row.entityId==='era-only'),'Era placement leaked Base');
  await undoLibraryCodexCreation(era,own);check(!await readWorldDocument(era,'codex','era-only')&&!readWorkspaceLibrary(await getEraProject(era)).placements.some(row=>row.entityId==='era-only'),'Era Undo left effective card/placement');await rejects(()=>undoLibraryCodexCreation(era,own));
  results.push('Named-era card and placement stay in overlay, real Undo removes only effective creation and consumes its current state once');

  const current=readWorkspaceLibrary((await db.projects.get(P))!).revision,call=await runBridgeTool('wh_create_codex_entry',{projectId:P,title:'MCP folder card',folderId:'child',expectedLibraryRevision:current,fields:{Role:'Friend'}});check(call.ok,'MCP composite create failed');const audit=(call.result as any).__audit;check(audit.before.__workspaceCodexCreation,'Composite audit missing');await updateWorkspaceLibrary(P,current+1,{kind:'create-folder',id:'unrelated',name:'Keep unrelated'});await db.projects.update(P,{enabledEngines:[]});await undoAuditEntry({entry:{...audit,tool:'wh_create_codex_entry'}});check(!await db.codexEntries.get((call.result as any).id)&&readWorkspaceLibrary((await db.projects.get(P))!).folders.some(row=>row.id==='unrelated'),'Global Undo lost unrelated folder or kept card');
  await db.projects.update(P,{enabledEngines:project(P).enabledEngines});const edited=await createLibraryCodex(base,card(P,'edited'),readWorkspaceLibrary((await db.projects.get(P))!).revision,'child');await db.codexEntries.update('edited',{title:'Do not remove my edit'});await rejects(()=>undoLibraryCodexCreation(base,edited));check((await db.codexEntries.get('edited'))!.title==='Do not remove my edit','Undo removed edited card');
  results.push('Normal registered MCP create+audit Undo remove card and placement after engine disable, preserve unrelated library edits and refuse to erase a later card edit');

  const envelope=createLocalToolBlockEnvelope(initiative.namespace,initiative.blocks!.find(block=>block.key==='initiative')!);const template=await saveCodexTemplate(P,{id:'independent-block-template',name:'Reusable own block',category:'character',fields:{Role:'Friend'},content:'<p>Template prose.</p>'+serializeLocalToolBlock(P,envelope),revision:0,createdAt:1,updatedAt:1},null);
  const ids:string[]=[];for(let i=0;i<2;i++){const created=await runBridgeTool('wh_create_codex_entry',{projectId:P,title:'Template '+i,templateId:template.id,folderId:'child',expectedLibraryRevision:readWorkspaceLibrary((await db.projects.get(P))!).revision});check(created.ok,'Template create failed');ids.push((created.result as any).id);}
  const untouched=(await db.codexEntries.get(ids[1]))!.content,owner={kind:'codex' as const,documentId:ids[0]},baseline=await readLocalToolBlock(base,owner,envelope.id);await applyLocalToolBlockActions(base,owner,baseline,[{type:'set',field:'round',value:12}]);check((findLocalToolBlocksInHtml((await db.codexEntries.get(ids[0]))!.content)[0].envelope as any).data.round===12&&(await db.codexEntries.get(ids[1]))!.content===untouched&&(await db.projects.get(P))!.codexTemplates!.find(row=>row.id===template.id)!.content===template.content,'Template source-owned blocks share mutable state');
  results.push('Two normal template-created cards own independent persisted block state; editing one by the real source action leaves the other card and reusable template byte-identical');
  return results;
 }finally{await deleteProject(P);await deleteProject(F);}
}

export async function testLibraryCreateNative(){
 const qa=(window as any).qaNative,P='library-create-native';check(qa?.call&&qa?.undo,'Real external MCP/HTTP Undo harness missing');const results:string[]=[];
 try{
  await db.projects.put(project(P));await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
  for(const eraId of [undefined,'past']){
   const scope={projectId:P,eraId},read=await qa.call('wh_workspace_library_get',scope);check(read.ok&&read.result.folders.some((row:any)=>row.id==='child'),'External Library discovery missing');const revision=read.result.revision;
   const result=await qa.call('wh_create_codex_entry',{...scope,title:'Native folder card',folderId:'child',expectedLibraryRevision:revision});check(result.ok&&Number.isInteger(result.result._undo?.audit_index),'Native create/audit failed');const id=result.result.id;
   check(await readWorldDocument(scope,'codex',id)&&readWorkspaceLibrary(await getEraProject(scope)).placements.some(row=>row.entityId===id&&row.folderId==='child'),'Native create did not persist card+folder');
   const stale=await qa.call('wh_create_codex_entry',{...scope,title:'Stale native card',folderId:'child',expectedLibraryRevision:revision});check(!stale.ok,'Stale external create accepted');
   await db.projects.update(P,{enabledEngines:[]});const undone=await qa.undo(result.result._undo.audit_index);check(undone.ok&&!await readWorldDocument(scope,'codex',id)&&!readWorkspaceLibrary(await getEraProject(scope)).placements.some(row=>row.entityId===id),'HTTP audit Undo left card/placement');check(!(await qa.undo(result.result._undo.audit_index)).ok,'External Undo reused receipt');await db.projects.update(P,{enabledEngines:project(P).enabledEngines});
   results.push(`Real MCP stdio→HTTP→executor→IPC normal create+placement and HTTP audit Undo/one-use with engine disabled, stale refusal: ${eraId??'Base'}`);
  }
  return results;
 }finally{await deleteProject(P);}
}
