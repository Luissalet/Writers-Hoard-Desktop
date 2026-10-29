// Permanent oracle promoted from the frozen archive1808 R3 causal; real Source storage and hosts.
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import type {Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {getEngine} from '@/engines/_registry';
import {registerLocalToolModules} from '@/engines/local/registry';
import definition from '@/engines/local/installed/examples.rich-prose/module';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {flushPendingWrites,getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';

const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function until(check:()=>boolean|Promise<boolean>,message:string){const deadline=Date.now()+7000;while(Date.now()<deadline){if(await check())return;await act(async()=>{await pause();});}throw Error(message+' '+document.body.textContent?.slice(-1300));}
const button=(text:string)=>[...document.querySelectorAll('button')].find(row=>row.textContent?.trim()===text);
async function click(text:string){const node=button(text);assert(node,'Control missing: '+text);await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await pause();});}
function editorOf(){return (document.querySelector('[data-sdk-prose-editor] .tiptap') as (HTMLElement&{editor:Editor})|null)?.editor;}
const json=(value:unknown)=>JSON.stringify(value);

export async function testReviewSourceRemoteArchive(){
 const projectId='remote-archive1808-'+crypto.randomUUID(),scope={projectId},root=createRoot(document.getElementById('root')!),checks:string[]=[];
 Object.assign(globalThis,{__archive1808Checks:checks});
 const existingProjects=(await db.projects.toArray()).map(row=>row.id).sort(),pendingBefore=getPendingWritesSnapshot().dirty;
 let archivedId:string|undefined,sourceId:string|undefined;
 useLocaleStore.setState({locale:'en',loaded:true});
 try{
  registerLocalToolModules({'./installed/examples.rich-prose/module.tsx':{default:definition}});
  await db.projects.put({id:projectId,title:'Own remote archive1808',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['archive','local-tool-'+definition.namespace],engineOrder:[],createdAt:1,updatedAt:1});
  const source=await createSourceToolDocument(scope,definition.namespace,'Own archive1808'),sibling=await createSourceToolDocument(scope,definition.namespace,'Untouched sibling1808');sourceId=source.id;
  const read=()=>readSourceToolDocument(scope,source.id,definition.namespace),siblingBefore=json(await readSourceToolDocument(scope,sibling.id,definition.namespace)),b=createLocalToolClient(projectId,definition,{documentId:source.id});
  const Engine=getEngine('local-tool-'+definition.namespace)?.component;assert(Engine,'Normal registered engine absent');
  const mountBaseline=json(await read());
  await act(async()=>{root.render(<StrictMode><MemoryRouter initialEntries={[`/project/${projectId}/local-tool-${definition.namespace}?document=${source.id}`]}><EnginePaneContext.Provider value={{instanceId:'archive1808-pane',projectId,visible:true}}><Engine projectId={projectId}/></EnginePaneContext.Provider></MemoryRouter></StrictMode>);await pause();});
  await until(()=>!!editorOf(),'Normal engine → workspace → Source host did not mount');
  assert(json(await read())===mountBaseline,'Mount wrote Source');
  checks.push('Normal Source engine mounts readonly with respect to persistence');
  const editor=editorOf()!;
  await act(async()=>{editor.commands.setContent('<p>Saved1808 Élodie 李明 🙂</p>');await pause();});
  await click('Save briefing');await until(async()=>(await b.read()).data.briefing.includes('Saved1808'),'Normal Save control failed');
  const saved=await b.read();assert(saved.data.caption===definition.initialState.caption,'Healthy Save changed sibling field');
  checks.push('Normal rich Save health passes before the causal boundary');
  await act(async()=>{editor.commands.setContent('<p><strong>DraftA1808</strong> Élodie 李明 🙂</p>');editor.commands.setTextSelection({from:1,to:11});await pause();});
  const draftHtml=editor.getHTML(),draftText=editor.getText();assert((await b.read()).data.briefing===saved.data.briefing,'Editing autosaved the draft');
  await b.save({...saved.data,briefing:'<p>RemoteB1808 Élodie 李明 🙂</p>'},saved.revision,saved.document?.version);
  const remote=await b.read();await click('Save briefing');
  await until(()=>!!document.querySelector('[data-sdk-rich-prose] [role="alert"]'),'CAS rejection was not visible');
  assert(editorOf()===editor&&editor.getHTML()===draftHtml,'CAS rejected Save lost the original draft');
  assert(json(await b.read())===json(remote),'Rejected Save overwrote remote data');
  assert(getPendingWritesSnapshot().dirty>pendingBefore,'Actual draft owner not registered');
  checks.push('Second normal client saves; stale UI Save rejects and preserves draft before archive');

  for(const [name,writes] of [['wh_local_tool_document_archive',true],['wh_archive_list',false],['wh_archive_restore',true]] as const)assert(getBridgeTool(name)?.writes===writes,'Normal registered MCP tool/catalog missing: '+name);
  const archive=async()=>{const current=await read();assert(current,'Current Source missing before normal archive');const reply=await runBridgeTool('wh_local_tool_document_archive',{...scope,documentId:source.id,namespace:definition.namespace,expectedRevision:current.document.revision,expectedVersion:current.version});assert(reply.ok&&(reply.result as {archived?:boolean})?.archived===true,'Registered MCP archive failed: '+json(reply));const listed=await runBridgeTool('wh_archive_list',scope);assert(listed.ok,'Registered MCP archive list failed: '+json(listed));const rows=await db.documentArchives.where('projectId').equals(projectId).toArray();const row=rows.find(value=>value.sourceId===source.id&&value.kind==='local-tool');assert(row,'Normal recoverable archive row absent');assert((listed.result as {archived:{id:string;kind:string}[]}).archived.some(value=>value.id===row.id&&value.kind==='local-tool'),'MCP list omitted scoped Source archive');archivedId=row.id;return row;};
  const restore=async(id:string)=>{const reply=await runBridgeTool('wh_archive_restore',{...scope,ids:[id]});assert(reply.ok,'Registered MCP restore failed: '+json(reply));const result=reply.result as {projectId:string;restored:{id:string}[];conflicts:unknown[]};assert(result.projectId===projectId&&result.restored.length===1&&result.restored[0].id===id&&result.conflicts.length===0,'MCP restore did not consume exactly its scoped archive: '+json(reply));};
  const firstArchive=await archive(),archiveBytes=json(firstArchive),projectAfterArchive=json(await db.projects.get(projectId));
  assert(!await read(),'Archive left Source active');
  assert(json(firstArchive.metadata?.item.data)===json(remote.data),'Archive did not preserve saved remote data');
  let oldReadRejected=false;try{await b.read();}catch{oldReadRejected=true;}assert(oldReadRejected,'Archived Source remained readable through old normal client');
  await until(()=>document.body.textContent?.includes('This document is unavailable.')===true,'Workspace did not observe remote archive');
  // Causal boundary: unmodified workspace unmounts this editor and destroys the RAM draft.
  assert(editorOf()===editor&&!editor.isDestroyed&&editor.getHTML()===draftHtml,'REMOTE_ARCHIVE_DISCARDED_PENDING_DRAFT');
  await until(()=>!editor.isEditable,'Retained archived draft kept editable authority');
  assert(editor.getText()===draftText&&document.querySelector('.tiptap')?.textContent===draftText,'Readonly draft is no longer available to copy');
  assert(button('Save briefing')?.disabled&&button('Undo')?.disabled&&button('Redo')?.disabled,'Archived draft left Source write controls enabled');
  assert(!(await flushPendingWrites()).ok,'Pending flush reported archived draft saved');
  assert(!await read()&&json(await db.documentArchives.get(firstArchive.id))===archiveBytes&&json(await db.projects.get(projectId))===projectAfterArchive,'Retained readonly/flush changed archived data');
  assert(json(await readSourceToolDocument(scope,sibling.id,definition.namespace))===siblingBefore,'Archive retention changed sibling document');
  checks.push('Registered MCP remote archive retains exact copyable editor draft readonly without restoring Source or clearing pending');

  await restore(firstArchive.id);
  await until(async()=>!!await read()&&button('Save briefing')?.disabled===false,'Normal restore did not issue a fresh writable binding');
  const restoredClient=createLocalToolClient(projectId,definition,{documentId:source.id}),restored=await restoredClient.read(),restoredBytes=json(await read());
  assert(restored.document?.lineage!==remote.document?.lineage,'Restore did not renew Source generation');
  assert(editorOf()===editor&&editor.getHTML()===draftHtml,'Restore discarded pending draft');
  await click('Save briefing');
  await until(()=>!!document.querySelector('[data-sdk-rich-prose] [role="alert"]'),'Old draft baseline unexpectedly saved across restore generation');
  assert(json(await read())===restoredBytes&&editor.getHTML()===draftHtml,'Stale pre-archive baseline resurrected data or lost draft');
  await click('Discard changes');
  await until(()=>editorOf()?.getText().includes('RemoteB1808')===true&&getPendingWritesSnapshot().dirty===pendingBefore,'Explicit discard did not show restored saved data and clear only its pending owner');
  assert(json(await read())===restoredBytes&&!await db.documentArchives.get(firstArchive.id),'Discard changed restored Source or archive was not consumed');
  checks.push('Registered MCP restore renews generation; old draft baseline still conflicts, explicit discard reloads restored data');

  const secondEditor=editorOf()!;await act(async()=>{secondEditor.commands.setContent('<p>DiscardWhileArchived1808 🙂</p>');await pause();});
  const secondArchive=await archive(),secondArchiveBytes=json(secondArchive);
  await until(()=>editorOf()===secondEditor&&!secondEditor.isEditable,'Second archive did not retain readonly draft');
  await click('Discard changes');
  await until(()=>!editorOf()&&getPendingWritesSnapshot().dirty===pendingBefore,'Explicit discard while archived kept an orphan editor or pending owner');
  assert(!await read()&&json(await db.documentArchives.get(secondArchive.id))===secondArchiveBytes,'Discard resurrected archived data or altered its saved recovery payload');
  const unavailableAlerts=[...document.querySelectorAll('[role="alert"]')].filter(node=>node.textContent?.includes('This document is unavailable'));
  assert(unavailableAlerts.length===1,'Archived workspace must show exactly one unavailable alert after explicit discard; got '+unavailableAlerts.length);
  await restore(secondArchive.id);
  await until(()=>editorOf()?.getText().includes('RemoteB1808')===true,'Clean archived host did not recover normally after restore');
  const secondRestoredClient=createLocalToolClient(projectId,definition,{documentId:source.id});
  assert(json((await secondRestoredClient.read()).data)===json(restored.data),'Second restore changed saved data');
  assert(json(await readSourceToolDocument(scope,sibling.id,definition.namespace))===siblingBefore,'Recovery changed untouched sibling');
  checks.push('Explicit discard while archived releases presentation, preserves Archive; later registered MCP restore opens saved content');
  void sourceId;void archivedId;return checks;
 }finally{
  await act(async()=>root.unmount());await deleteProject(projectId);
  assert(!await db.projects.get(projectId)&&!(await db.documentArchives.where('projectId').equals(projectId).count()),'Own fixture cleanup left project/archive data');
  assert(json((await db.projects.toArray()).map(row=>row.id).sort())===json(existingProjects),'Fixture altered another project');
  assert(getPendingWritesSnapshot().dirty===pendingBefore,'Fixture left its pending owner registered');
  checks.push('Own project/archive cleanup and pending-owner cleanup verified; other projects preserved');
 }
}
