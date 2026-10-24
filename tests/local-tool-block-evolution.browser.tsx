import {act,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {db} from '@/db';
import {deleteCodexEntry,deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {registerLocalToolModules} from '@/engines/local/registry';
import {pinLocalToolRelease} from '@/engines/local/releases';
import v1 from '@/engines/local/installed/examples.evolving-owned/versions/6e9497a1dc78416297de1001a7293ea70836553c42d7c8a30ad73d0ff2e1e78e/module';
import manifest1 from '@/engines/local/installed/examples.evolving-owned/versions/6e9497a1dc78416297de1001a7293ea70836553c42d7c8a30ad73d0ff2e1e78e/release.json';
import v2 from '@/engines/local/installed/examples.evolving-owned/versions/108a6673ba6f038994341dbf03078ef15797d74e937ad6d321aba3a5b98a782c/module';
import manifest2 from '@/engines/local/installed/examples.evolving-owned/versions/108a6673ba6f038994341dbf03078ef15797d74e937ad6d321aba3a5b98a782c/release.json';
import {createLocalToolBlockEnvelope,type LocalToolOwnedBlockDefinition} from '@/engines/local/blocks/definitions';
import {createOwnedBlockClient} from '@/engines/local/blocks/client';
import {SourceToolBlock} from '@/engines/local/blocks/SourceToolBlock';
import type {LocalToolDefinition,LocalToolJson} from '@/engines/local/sdk';
import {findLocalToolBlocksInHtml,serializeLocalToolBlock,type LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';
import {applyLocalToolBlockActions,readLocalToolBlock,reverseLocalToolBlock} from '@/engines/local/blocks/operations';
import {hideEraDocument,readWorldDocument,saveEraDocument,saveWorldEra} from '@/services/worldEras/store';
import {restoreArchivedDocument} from '@/services/documentArchive/store';
import {createFullZipArchive,createProjectZipArchive,importFullZip,importProjectZip} from '@/services/zipBackup';
import {previewProjectDuplicate,duplicateProject} from '@/services/projectDuplicate/service';
import {capturePublicationSnapshot,publicationReaderSource} from '@/services/publishedEditions/snapshot';
import {getPublishedEdition,publishEdition} from '@/services/publishedEditions/store';
import {remapPublishedEditionContent} from '@/services/publishedEditions/portability';
import {buildReaderHtml} from '@/engines/writings/readerExport';
import {safeReaderPresentation} from '@/engines/writings/readerPresentation';
import {buildWorldWiki,loadWorldWikiData} from '@/services/worldWikiExport';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {applyWritingToolDock,applyWritingToolDockBlock,readWritingToolDock,reverseWritingToolDock} from '@/engines/writings/toolDock/store';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {saveCodexDraft} from '@/engines/codex/operations';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {useLocaleStore} from '@/stores/localeStore';
import {authorCard} from './fixtures/local-tools/author-data';

const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const nativeOwner=(documentId:string)=>({kind:'codex' as const,documentId});
const installed=(hash:string)=>`./installed/${v1.namespace}/versions/${hash}/module.tsx`;
function register(){registerLocalToolModules({[installed(manifest1.contentHash)]:{default:v1},[installed(manifest2.contentHash)]:{default:v2}},{[installed(manifest1.contentHash).replace('module.tsx','release.json')]:manifest1,[installed(manifest2.contentHash).replace('module.tsx','release.json')]:manifest2});}
async function fixture(suffix:string,selectedV2=false){
 register();const projectId='owned-evolution-'+suffix+'-'+crypto.randomUUID();
 await db.projects.put({id:projectId,title:'Owned evolution QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','writings','local-tool-'+v1.namespace],createdAt:1,updatedAt:1});
 await pinLocalToolRelease(projectId,v1.namespace,selectedV2?manifest2.contentHash:manifest1.contentHash,null);
 const envelope=createLocalToolBlockEnvelope(v1.namespace,v1.blocks![0],'kept-owned') as LocalToolOwnedBlockEnvelope;
 const card={...authorCard(projectId,'Kept old notebook'),id:projectId+'-card',content:'<p>Before owned prose.</p>'+serializeLocalToolBlock(projectId,envelope)+'<p>After owned prose.</p>'};
 await db.codexEntries.put(card);
 return{projectId,scope:{projectId},card,envelope,owner:nativeOwner(card.id)};
}
const until=async(check:()=>boolean|Promise<boolean>,message:string)=>{const end=Date.now()+5000;while(Date.now()<end){if(await check())return;await act(async()=>{await pause();});}throw Error(message+' '+document.body.textContent?.slice(-800));};
const button=(label:string,scope:ParentNode=document)=>[...scope.querySelectorAll('button')].find(node=>node.textContent?.trim()===label);
const click=async(node:Element|undefined)=>{assert(node,'Actual control absent');await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await pause();});};
const own=()=>document.querySelector('[data-source-block-id="kept-owned"]')!;
const richEditor=()=>{const dom=own()?.querySelector('[data-sdk-prose-editor] .tiptap') as HTMLElement&{editor:Editor};return dom?.editor;};

export async function testOwnedEvolutionPin(){
 const f=await fixture('pin');try{const before=(await db.codexEntries.get(f.card.id))!.content,pinBefore=(await db.projects.get(f.projectId))!.localToolInstallations![v1.namespace];let error='';
  try{await pinLocalToolRelease(f.projectId,v1.namespace,manifest2.contentHash,pinBefore.revision);}catch(reason){error=String(reason);assert(equal((await db.projects.get(f.projectId))!.localToolInstallations![v1.namespace],pinBefore),'Rejected pin changed installation');}
  assert((await db.codexEntries.get(f.card.id))!.content===before,'Pin rewrote the saved block');
  assert(!error,'R2_PIN_RED: actual installed release pin rejects guard-compatible old Owned descriptor: '+error);
  assert((await db.projects.get(f.projectId))!.localToolInstallations![v1.namespace].contentHash===manifest2.contentHash,'Real pin did not select compiled v2');
  return['Real compiled two-release pin admits additive Owned and leaves persisted envelope/prose byte-exact; failed admission never changes the pin'];
 }finally{await deleteProject(f.projectId);}
}

export async function testOwnedEvolutionNative(){
 const f=await fixture('native',true);try{const baseline=await readLocalToolBlock(f.scope,f.owner,f.envelope.id);
  const result=await runBridgeTool('wh_local_tool_block_apply',{projectId:f.projectId,owner:f.owner,baseline,actions:[{type:'list-insert',field:'objectives',item:{id:'authored',text:'Actual goal'},afterId:null}]});
  assert(result.ok,'R2_NATIVE_RED: registered native block apply rejects compatible imported old descriptor/new list: '+JSON.stringify(result));
  const after=(await readLocalToolBlock(f.scope,f.owner,f.envelope.id)).envelope as LocalToolOwnedBlockEnvelope;
  assert(equal(after.codec,v2.blocks![0].scope==='host'?v2.blocks![0].codec:null)&&Array.isArray(after.data.objectives)&&after.data.objectives.length===1,'Native transition did not pair data/current codec');
  assert((after.data.objectives[0] as {id:string}).id==='authored'&&equal(after.data.labels,{}),'Native transition injected fresh list/map seeds');
  assert(typeof (result.result as {receiptId?:string}).receiptId==='string','Native contract lost its Undo receipt');
  return['Registered native block dispatcher consumes RAW baseline through one additive transition, inserts only authored list item and retains receipt shape'];
 }finally{await deleteProject(f.projectId);}
}

export async function testOwnedEvolutionHost(){
 const f=await fixture('host',true),root=createRoot(document.getElementById('root')!);let saves=0;
 function Parent(){const[current,setCurrent]=useState(f.card);return <EnginePaneContext.Provider value={{instanceId:'owned-evolution',projectId:f.projectId,visible:true}}><CodexEntryForm key={current.updatedAt} projectId={f.projectId} entry={current} onCancel={()=>{}} onSave={async(draft,base)=>{const saved=await saveCodexDraft(base??current,draft);setCurrent(saved);saves++;}}/></EnginePaneContext.Provider>;}
 try{useLocaleStore.setState({locale:'en',loaded:true});await act(async()=>{root.render(<StrictMode><MemoryRouter><Parent/></MemoryRouter></StrictMode>);await pause();});
  await until(()=>!!own(),'Actual parent did not mount old atom');
  await until(()=>!!richEditor(),'R2_HOST_RED: normal Codex Owned host cannot open the compatible new rich field');
  assert(richEditor().getHTML()==='<p>Declared initial briefing.</p>','Projected rich differs from declared visible default');
  assert(own().textContent?.includes('No objectives yet.')&&own().textContent?.includes('Labels: None yet.'),'New list/map view is not empty');
  assert(equal(findLocalToolBlocksInHtml((await db.codexEntries.get(f.card.id))!.content)[0].envelope,f.envelope),'Mount wrote a projected default');
  await act(async()=>{richEditor().commands.setContent('<p>Declared initial briefing.</p>');await pause();});await click(button('Save briefing',own()));await until(()=>button('Save briefing',own())?.matches(':disabled')===true,'Same-shown rich Save did not settle');
  await click(button('Save Changes')??button('Save changes'));await until(()=>saves===1&&!!richEditor(),'Parent Save did not reopen');
  assert(equal(findLocalToolBlocksInHtml((await db.codexEntries.get(f.card.id))!.content)[0].envelope,f.envelope),'Rich no-op adopted RAW descriptor/data/preview');
  await click(button('Append a note',own()));await until(()=>own().textContent?.includes('Kept prose Updated.')===true,'Actual old-field action failed');await click(button('Save Changes')??button('Save changes'));await until(()=>saves===2,'Parent Save did not persist evolved atom');
  const saved=findLocalToolBlocksInHtml((await db.codexEntries.get(f.card.id))!.content)[0].envelope as LocalToolOwnedBlockEnvelope;
  assert(saved.id===f.envelope.id&&equal(saved.data.objectives,[])&&equal(saved.data.labels,{})&&saved.data.briefing==='<p>Declared initial briefing.</p>','Old-field edit lost atomic defaults or injected fresh list/map seeds');
  assert(equal(saved.codec,v2.blocks![0].scope==='host'?v2.blocks![0].codec:null),'Parent persisted data without current codec');
  return['StrictMode normal Codex host shows coherent pending list/map/rich without writes; same-shown rich Save is no-op; actual old-field edit and parent Save persist one paired transition'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}

async function rejected(run:()=>unknown,message:string){let error:unknown;try{await run();}catch(reason){error=reason;}assert(error,message);return String(error);}
function editorClient(projectId:string,envelope:LocalToolOwnedBlockEnvelope){
 const editor=new Editor({extensions:[StarterKit,SourceToolBlock.configure({nodeView:false})],content:'<p>Outside.</p>'+serializeLocalToolBlock(projectId,envelope)});
 let active=true,failNext=false,commits=0;
 const position=()=>{let found:number|undefined;editor.state.doc.descendants((node,pos)=>{if(node.type.name==='sourceToolBlock'&&node.attrs.envelope.id===envelope.id)found=pos;});assert(found!==undefined,'Real atom removed');return found;};
 const read=()=>{if(!active||editor.isDestroyed||!editor.isEditable)throw Error('own_test_lease_expired');return structuredClone(editor.state.doc.nodeAt(position())!.attrs.envelope) as LocalToolOwnedBlockEnvelope;};
 const replace=(next:LocalToolOwnedBlockEnvelope)=>editor.view.dispatch(editor.state.tr.setNodeMarkup(position(),undefined,{...editor.state.doc.nodeAt(position())!.attrs,envelope:next}));
 const client=createOwnedBlockClient({projectId},v2 as unknown as LocalToolDefinition,v2.blocks![0] as LocalToolOwnedBlockDefinition,{kind:'codex',documentId:'actual-editor-owner'},{identity:'actual-editor-'+projectId,read,subscribe:changed=>{editor.on('transaction',changed);return()=>{editor.off('transaction',changed);};},commit:async(before,next)=>{read();if(failNext){failNext=false;throw Error('own_test_commit_abort');}assert(equal(read(),before),'Port CAS lost');replace(next);commits++;}});
 return{client,editor,read,replace,commits:()=>commits,fail:()=>{failNext=true;},revoke:()=>{active=false;},close:()=>{active=false;editor.destroy();}};
}

export async function testOwnedEvolutionClientUndo(){
 const f=await fixture('client',true),port=editorClient(f.projectId,f.envelope),state=port.client.state!;
 try{
  const rawBefore=port.read(),view=await port.client.read();assert(view.data.briefing==='<p>Declared initial briefing.</p>'&&equal(view.data.objectives,[])&&equal(view.data.labels,{}),'Client view is not shared');
  for(const actions of [
   [{type:'set' as const,field:'briefing',value:view.data.briefing}],
   [{type:'set' as const,field:'notes',value:'Temporary'},{type:'set' as const,field:'notes',value:view.data.notes}],
   [{type:'list-insert' as const,field:'objectives',item:{id:'temporary',text:'x'},afterId:null},{type:'list-delete' as const,field:'objectives',id:'temporary'}],
   [{type:'map-set' as const,field:'labels',key:'temporary',value:'x'},{type:'map-delete' as const,field:'labels',key:'temporary'}],
   [{type:'map-delete' as const,field:'labels',key:'absent'}],
  ]){const noop=await state.apply(view,actions);assert(noop.receiptId===null&&equal(noop.snapshot.data,view.data)&&equal(port.read(),rawBefore)&&port.commits()===0,'Pending logical no-op wrote or returned another view');}
  await port.client.save(view.data,view.revision,view.block!.version);assert(port.read().revision===rawBefore.revision+1&&equal(port.read().codec,rawBefore.codec)&&equal(port.read().data,rawBefore.data)&&equal(port.read().preview,rawBefore.preview),'Equal direct save adopted codec/defaults');
  const rawStart=port.read();const evolved=await state.apply(await port.client.read(),[{type:'list-insert',field:'objectives',item:{id:'authored',text:'Actual'},afterId:null}]);assert(evolved.receiptId,'First effect missing receipt');
  const evolvedRaw=port.read();assert(equal(evolvedRaw.codec,(v2.blocks![0] as LocalToolOwnedBlockDefinition).codec)&&equal(evolvedRaw.preview,(v2.blocks![0] as LocalToolOwnedBlockDefinition).preview),'Client effect not atomic metadata');
  const normal=await state.apply(evolved.snapshot,[{type:'set',field:'notes',value:'Later normal edit'}]);assert(normal.receiptId,'Normal action receipt absent');await state.undo(normal.receiptId);
  const restored=await state.undo(evolved.receiptId);assert(restored.receiptId,'Undo evolution missing Redo');const {revision:oldRevision,...oldBody}=rawStart,{revision:undoneRevision,...undoneBody}=port.read();assert(undoneRevision>oldRevision&&equal(oldBody,undoneBody),'Undo did not restore full RAW absence/preview/codec after normal edit Undo');assert(restored.snapshot.data.briefing==='<p>Declared initial briefing.</p>','Undo snapshot was calculated before restoring metadata');
  await state.redo(restored.receiptId);const {revision:redoRevision,...redoBody}=port.read(),{revision:evolvedRevision,...evolvedBody}=evolvedRaw;assert(redoRevision>evolvedRevision&&equal(redoBody,evolvedBody),'Redo evolution not exact');
  return['Real Editor port and public Owned client share logical reads/actions; all five pending net-noops write nothing, direct equal save retains RAW metadata','Evolution plus normal edit/Undo then evolution Undo/Redo restores complete RAW body/absence with increasing revision and fresh post-restore snapshots'];
 }finally{port.close();await deleteProject(f.projectId);}
}

export async function testOwnedEvolutionClientConflicts(){
 const f=await fixture('client-conflicts',true),port=editorClient(f.projectId,f.envelope),state=port.client.state!;
 try{
  const before=port.read(),baseline=await port.client.read();port.fail();await rejected(()=>state.apply(baseline,[{type:'set',field:'notes',value:'Aborted'}]),'Commit rejection accepted');assert(equal(port.read(),before),'Rejected client commit leaked RAW');
  const applied=await state.apply(baseline,[{type:'set',field:'notes',value:'Committed'}]);assert(applied.receiptId,'Retry missing receipt');const evolved=port.read(),snapshot=await port.client.read();
  port.replace({...port.read(),name:{en:'External name',es:'Nombre externo'}});await rejected(()=>port.client.save(snapshot.data,snapshot.revision,snapshot.block!.version),'Full envelope version ignored metadata-only change');await rejected(()=>state.undo(applied.receiptId!),'Evolution Undo ignored metadata-only change');
  port.replace({...evolved,revision:evolved.revision+1});port.fail();await rejected(()=>state.undo(applied.receiptId!),'Undo commit failure accepted');assert(equal(port.read().data,evolved.data),'Failed Undo changed data');
  const retried=await state.undo(applied.receiptId);assert(retried.receiptId&&equal(port.read().data,before.data)&&equal(port.read().codec,before.codec),'Undo receipt consumed before failed commit');
  const unset=await state.apply(await port.client.read(),[{type:'unset',field:'briefing'}]);assert(unset.receiptId&&!Object.hasOwn(port.read().data as object,'briefing')&&!Object.hasOwn((await port.client.read()).data as object,'briefing'),'Explicit unset was refilled after adoption');
  const captured=port.read();port.revoke();await rejected(()=>state.undo(unset.receiptId!),'Revoked owner used receipt');assert(equal(captured,findLocalToolBlocksInHtml(port.editor.getHTML())[0].envelope),'Revoked receipt changed atom');
  return['Client RAW envelope CAS rejects metadata-only stale saves/Undo; commit abort preserves state and receipt for retry; explicit unset remains absent and revoked owner cannot restore'];
 }finally{port.close();await deleteProject(f.projectId);}
}

export async function testOwnedEvolutionNativeTransactions(){
 const f=await fixture('native-tx',true);try{
  const initial=await readLocalToolBlock(f.scope,f.owner,f.envelope.id);
  const noop=await applyLocalToolBlockActions(f.scope,f.owner,initial,[{type:'set',field:'notes',value:f.envelope.data.notes}]);assert(typeof noop.receiptId==='string'&&noop.envelope?.scope==='host'&&noop.envelope.revision===f.envelope.revision+1,'Native pending no-op lost its historical receipt/revision contract');
  assert(equal(noop.envelope.data,f.envelope.data)&&equal(noop.envelope.codec,f.envelope.codec)&&equal(noop.envelope.preview,f.envelope.preview),'Native no-op adopted a descriptor/default');
  await reverseLocalToolBlock(f.scope,f.owner,noop.receiptId);assert(equal((await readLocalToolBlock(f.scope,f.owner,f.envelope.id)).envelope,f.envelope),'Native no-op Undo changed RAW body');
  const baseline=await readLocalToolBlock(f.scope,f.owner,f.envelope.id);let abortedReceipt='';await rejected(()=>db.transaction('rw',db.tables,async()=>{const result=await applyLocalToolBlockActions(f.scope,f.owner,baseline,[{type:'set',field:'briefing',value:'<h2>Abort</h2>'}]);abortedReceipt=result.receiptId;await rejected(()=>reverseLocalToolBlock(f.scope,f.owner,abortedReceipt),'Receipt usable before outer commit');throw Error('Outer abort');}),'Outer mutation did not abort');
  assert((await readLocalToolBlock(f.scope,f.owner,f.envelope.id)).ownerVersion===baseline.ownerVersion,'Outer abort leaked adoption');await rejected(()=>reverseLocalToolBlock(f.scope,f.owner,abortedReceipt),'Aborted receipt became available');
  await saveWorldEra(f.projectId,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);const era={projectId:f.projectId,eraId:'past'},eraBaseline=await readLocalToolBlock(era,f.owner,f.envelope.id),baseBefore=(await db.codexEntries.get(f.card.id))!.content;
  const eraEdit=await applyLocalToolBlockActions(era,f.owner,eraBaseline,[{type:'map-set',field:'labels',key:'authored',value:'Era label'}]);assert(eraEdit.envelope?.scope==='host'&&equal(eraEdit.envelope.data.labels,{authored:'Era label'}),'Era transition lost map action');assert((await db.codexEntries.get(f.card.id))!.content===baseBefore,'Era transition mutated Base');
  const reverse=await reverseLocalToolBlock(era,f.owner,eraEdit.receiptId);assert(equal((await readLocalToolBlock(era,f.owner,f.envelope.id)).envelope,f.envelope),'Era Undo did not restore RAW envelope');await reverseLocalToolBlock(era,f.owner,reverse.receiptId,'redo');await rejected(()=>applyLocalToolBlockActions(era,f.owner,eraBaseline,[{type:'set',field:'notes',value:'Stale'}]),'Native owner CAS relaxed');
  return['Native pending no-op preserves receipt/revision without adoption; outer mutation abort rolls back complete envelope and withholds receipts until commit','Era map adoption and exact Undo/Redo preserve Base and reject stale owner baseline'];
 }finally{await deleteProject(f.projectId);}
}

export async function testOwnedEvolutionDock(){
 const f=await fixture('dock'),owner={kind:'project' as const},chapterId=f.projectId+'-chapter',chapter={kind:'writings' as const,documentId:chapterId};try{
  await db.writings.put({id:chapterId,projectId:f.projectId,title:'Dock chapter',content:'<p>Kept chapter prose.</p>',wordCount:3,status:'draft',tags:[],createdAt:1,updatedAt:1});
  const empty=await readWritingToolDock(f.scope,owner);await applyWritingToolDock(f.scope,owner,empty.version,[{type:'add-source',id:'dock-notebook',namespace:v1.namespace,key:'notebook'}]);const before=await readWritingToolDock(f.scope,owner),beforeProject=JSON.stringify((await db.projects.get(f.projectId))!.writingToolDock);
  await pinLocalToolRelease(f.projectId,v1.namespace,manifest2.contentHash,1);assert(JSON.stringify((await db.projects.get(f.projectId))!.writingToolDock)===beforeProject,'Pin materialized dock fields');
  const inherited=await readWritingToolDock(f.scope,chapter),inheritedBlock=inherited.layout!.blocks[0];assert(inherited.inherited&&inheritedBlock.kind==='owned','Expected inherited old block');await rejected(()=>applyWritingToolDockBlock(f.scope,chapter,inherited.version,(inheritedBlock as {envelope:LocalToolOwnedBlockEnvelope}).envelope,[{type:'set',field:'notes',value:'Not owned'}]),'Inherited dock became writable');
  const customized=await applyWritingToolDock(f.scope,chapter,inherited.version,[{type:'customize'}]),block=customized.layout!.blocks[0];assert(block.kind==='owned','Customized block absent');
  const changed=await applyWritingToolDockBlock(f.scope,chapter,customized.version,block.envelope,[{type:'list-insert',field:'objectives',item:{id:'authored',text:'Chapter goal'},afterId:null}]);assert(changed.layout!.blocks[0].kind==='owned'&&equal(changed.layout!.blocks[0].envelope.codec,(v2.blocks![0] as LocalToolOwnedBlockDefinition).codec),'Dock failed to adopt current descriptor');
  assert(equal((await readWritingToolDock(f.scope,owner)).layout,before.layout),'Chapter transition changed inherited default');const undone=await reverseWritingToolDock(f.scope,chapter,changed.receiptId);assert(undone.layout!.blocks[0].kind==='owned'&&equal(undone.layout!.blocks[0].envelope,block.envelope),'Dock Undo lost old descriptor/absence');await reverseWritingToolDock(f.scope,chapter,undone.receiptId,'redo');
  assert((await db.writings.get(chapterId))!.content==='<p>Kept chapter prose.</p>','Dock modified chapter body');
  return['Real dock pin/read preserves inherited RAW; explicit customization/adoption and layout Undo/Redo use current codec without changing default or chapter prose'];
 }finally{await deleteProject(f.projectId);}
}

export async function testOwnedEvolutionRetainedPin(){
 for(const location of ['history','archive','hidden-era']as const){const f=await fixture('retained-'+location);try{
  if(location==='history')await saveCodexDraft(f.card,{...f.card,content:'<p>Current without block.</p>'});
  if(location==='archive')await deleteCodexEntry(f.card.id);
  if(location==='hidden-era'){await saveWorldEra(f.projectId,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);const scope={projectId:f.projectId,eraId:'past'},read=(await readWorldDocument(scope,'codex',f.card.id))!;await saveEraDocument(scope,'codex',read.document,read.version);const saved=(await readWorldDocument(scope,'codex',f.card.id))!;await hideEraDocument(scope,'codex',f.card.id,saved.version);await db.codexEntries.update(f.card.id,{content:'<p>Base without block.</p>'});await db.documentHistory.where('projectId').equals(f.projectId).delete();}
  const histories=JSON.stringify(await db.documentHistory.where('projectId').equals(f.projectId).toArray()),archives=JSON.stringify(await db.documentArchives.where('projectId').equals(f.projectId).toArray()),variants=JSON.stringify(await db.worldEraVariants.where('projectId').equals(f.projectId).toArray());
  await pinLocalToolRelease(f.projectId,v1.namespace,manifest2.contentHash,1);assert(JSON.stringify(await db.documentHistory.where('projectId').equals(f.projectId).toArray())===histories&&JSON.stringify(await db.documentArchives.where('projectId').equals(f.projectId).toArray())===archives&&JSON.stringify(await db.worldEraVariants.where('projectId').equals(f.projectId).toArray())===variants,'Pin rewrote retained '+location);
  if(location==='archive'){const archived=(await db.documentArchives.where('projectId').equals(f.projectId).toArray()).find(row=>row.kind==='codex')!;await restoreArchivedDocument(f.projectId,archived.id);assert(equal(findLocalToolBlocksInHtml((await db.codexEntries.get(f.card.id))!.content)[0].envelope,f.envelope),'Archive restore adopted live definition');}
 }finally{await deleteProject(f.projectId);}}
 return['Actual pin validates and preserves normal Base history, archived/deleted card and hidden era old envelopes; normal Archive restore retains RAW descriptor and absence'];
}

export async function testOwnedEvolutionPortability(){
 const f=await fixture('portable',true),copies:string[]=[];try{
  const historicalPlain:LocalToolOwnedBlockEnvelope={...f.envelope,codec:{version:1,fields:{notes:{kind:'prose'},linked:{kind:'reference'},asset:{kind:'asset-reference'}}},data:{notes:'Opaque shared',linked:{kind:'codex',documentId:'shared'},asset:{kind:'image',id:'shared'}}};
  const remapped=remapPublishedEditionContent(f.projectId,'new-owner',serializeLocalToolBlock(f.projectId,historicalPlain),(id,prefix)=>prefix+'-'+id),plainSpan=findLocalToolBlocksInHtml(remapped)[0];
  assert(plainSpan.projectId==='new-owner'&&plainSpan.envelope.scope==='host'&&equal(plainSpan.envelope.codec,historicalPlain.codec)&&equal(plainSpan.envelope.preview,historicalPlain.preview),'Historical plain remap changed descriptor/preview or retained old owner');
  assert((plainSpan.envelope.data.linked as {documentId:string}).documentId==='codex-shared'&&(plainSpan.envelope.data.asset as {id:string}).id==='img-shared'&&plainSpan.envelope.data.notes==='Opaque shared','Historical plain captured refs/opaque bytes not remapped by contract');
  const source=await createSourceToolDocument(f.scope,v1.namespace,'Unchanged source'),sourceBefore=JSON.stringify(source),chapterId=f.projectId+'-chapter';
  await db.writings.put({id:chapterId,projectId:f.projectId,title:'Owned captured chapter',content:f.card.content,wordCount:6,status:'draft',tags:[],chapter:1,createdAt:1,updatedAt:1});
  const {edition}=await publishEdition({projectId:f.projectId,chapterIds:[chapterId],title:'Old frozen notebook',locale:'en',expectedRevision:0});const frozenReader=structuredClone(edition.reader);
  const previous=await readLocalToolBlock(f.scope,f.owner,f.envelope.id),changed=await applyLocalToolBlockActions(f.scope,f.owner,previous,[{type:'set',field:'briefing',value:'<h2>Authored evolved briefing</h2><ul><li>Kept clue</li></ul>'}]),evolved=changed.envelope as LocalToolOwnedBlockEnvelope;
  await db.writings.update(chapterId,{content:serializeLocalToolBlock(f.projectId,evolved)});
  const captured=publicationReaderSource(await capturePublicationSnapshot(f.scope));db.close({disableAutoOpen:true});try{
   const reader=await buildReaderHtml(captured.project,captured.writings,safeReaderPresentation(),'en',f.scope,captured);assert(reader.html.includes('Authored evolved briefing')&&reader.html.includes('Kept clue'),'Closed DB Reader lost evolved RAW preview');
   const options={locale:'en' as const,includeMedia:false,includeImages:false},data=await loadWorldWikiData(f.projectId,options,{...captured,images:captured.capturedImages!()}),wiki=buildWorldWiki(data,options);assert(wiki.html.includes('Authored evolved briefing'),'Closed DB wiki lost evolved stored preview');
  }finally{await db.open();}
  assert(equal((await getPublishedEdition(f.projectId,edition.id)).reader,frozenReader),'Live adoption rewrote published reader artifact');
  const copy=await importProjectData(await exportProjectData(f.projectId));copies.push(copy);const cloned=(await db.codexEntries.where('projectId').equals(copy).toArray()).find(row=>row.title===f.card.title)!,clonedEnvelope=findLocalToolBlocksInHtml(cloned.content)[0].envelope as LocalToolOwnedBlockEnvelope;
  assert(equal(clonedEnvelope.codec,evolved.codec)&&equal(clonedEnvelope.data,evolved.data)&&equal(clonedEnvelope.preview,evolved.preview)&&clonedEnvelope.id!==evolved.id,'JSON clone separated codec/data/preview');assert(equal((await db.projects.get(copy))!.publishedEditions![0].reader,frozenReader),'JSON clone changed frozen reader bytes/hash');
  const preview=await previewProjectDuplicate({projectId:f.projectId}),duplicated=await duplicateProject({projectId:f.projectId,title:'Duplicate evolved notebook',operationId:crypto.randomUUID(),expectedSourceVersion:preview.sourceVersion});copies.push(duplicated.projectId);const duplicate=(await db.codexEntries.where('projectId').equals(duplicated.projectId).toArray()).find(row=>row.title===f.card.title)!,duplicateEnvelope=findLocalToolBlocksInHtml(duplicate.content)[0].envelope as LocalToolOwnedBlockEnvelope;assert(equal(duplicateEnvelope.codec,evolved.codec)&&equal(duplicateEnvelope.data,evolved.data)&&equal(duplicateEnvelope.preview,evolved.preview),'Real Duplicate lost evolved metadata');
  const zip=await createProjectZipArchive(f.projectId);await db.codexEntries.update(f.card.id,{content:'<p>Temporary.</p>'});await importProjectZip(new File([zip.blob],zip.fileName),{replaceProjectIds:[f.projectId]});assert(equal(findLocalToolBlocksInHtml((await db.codexEntries.get(f.card.id))!.content)[0].envelope,evolved),'Project ZIP did not restore full envelope');
  for(const id of copies){const copiedProject=await db.projects.get(id);const scan=(value:unknown,path:string)=>{if(Array.isArray(value)){value.forEach((child,index)=>scan(child,path+'.'+index));return;}if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(['data','localToolStates'].includes(key))continue;if(['content','html','body','richContent'].includes(key)&&typeof child==='string'&&child.includes('data-wh-source-block')){const spans=findLocalToolBlocksInHtml(child);for(const span of spans)if(span.projectId!==id)console.error('PORTABLE_SCOPE_PATH',JSON.stringify({path:path+'.'+key,expected:id,actual:span.projectId}));}else if(child&&typeof child==='object')scan(child,path+'.'+key);}};scan(copiedProject,'project');}
  const full=await createFullZipArchive().catch(error=>{console.error('Owned evolution full-ZIP diagnostic',JSON.stringify(error));throw error;});await db.codexEntries.update(f.card.id,{content:'<p>Temporary full.</p>'});await importFullZip(new File([full.blob],full.fileName));assert(equal(findLocalToolBlocksInHtml((await db.codexEntries.get(f.card.id))!.content)[0].envelope,evolved),'Full ZIP did not restore full envelope');
  assert(JSON.stringify((await db.projects.get(f.projectId))!.sourceToolDocuments!.find(row=>row.id===source.id))===sourceBefore,'Owned evolution changed standalone Source contract');
  return['Captured Reader/wiki with DB closed consume stored evolved preview; old published reader bytes/hash stay frozen after adoption','JSON clone, actual Duplicate and both ZIP flows preserve evolved codec/data/preview pairing and standalone Source state'];
 }finally{if(!db.isOpen())await db.open();for(const id of copies)await deleteProject(id);await deleteProject(f.projectId);}
}
