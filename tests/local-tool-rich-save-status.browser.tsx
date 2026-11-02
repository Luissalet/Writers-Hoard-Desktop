import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,type Editor} from '@tiptap/core';
import assert from './local-tool-collaborative-rich.assert';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps,type RichDocument} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {flushPendingWrites,getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
import {runBridgeTool} from '@/services/aiBridge/dispatch';

/** Keep the real Source host mounted while checking the shared save ledger. */
export async function testRichSaveStatus(){
 const P='own1920-'+crypto.randomUUID(),NS='tests.rich-save-status1920',element=document.getElementById('root')!,checks:string[]=[],locale=useLocaleStore.getState().locale,baseline=getPendingWritesSnapshot();let root=createRoot(element),editor:Editor|undefined;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);},tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));}),wait=async(fn:()=>boolean,label:string)=>{for(let i=0;i<160;i++){if(fn())return;await tick();}throw Error(label+' timeout '+element.textContent);};
 const counts=()=>{const s=getPendingWritesSnapshot();return[s.dirty,s.pending,s.failed];},expected=[baseline.dirty,baseline.pending,baseline.failed];
 const extensions=[Extension.create({name:'observeRichSaveStatus1920',onCreate(){editor=this.editor;}})];
 function Fixture({client,context}:LocalToolProps<LocalToolJson>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" extensions={extensions}/>;}
 const data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'base'}]}]}} as LocalToolJson;
 const definition=defineLocalTool({namespace:NS,name:{en:'Save status',es:'Estado de guardado'},description:{en:'Mounted Source save status',es:'Estado de guardado con Source abierto'},document:{defaultTitle:{en:'Status',es:'Estado'}},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:Fixture});
 const button=(name:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!,click=async(name:string)=>{await act(async()=>button(name).click());await tick();};
 try{
  eq('health private89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0)&&db.tables.length===89,true);useLocaleStore.setState({locale:'en'});registerLocalToolModules({['./installed/'+NS+'/module.tsx']:{default:definition}});
  await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+NS],createdAt:1,updatedAt:1});const D=(await createSourceToolDocument({projectId:P},NS,'Status')).id,client=createLocalToolClient(P,definition,{documentId:D});
  const savedText=async()=>{const state=(await client.read()).data as Record<string,LocalToolJson>;return(state.body as unknown as RichDocument).content.map(n=>n.content.map(t=>t.text).join('')).join('\n');};
  const mount=async()=>{await act(async()=>root.render(<MemoryRouter><LocalToolDocumentHost projectId={P} documentId={D} namespace={NS}/></MemoryRouter>));};
  await mount();await wait(()=>!!button('Activate shared editing'),'passive Source');await click('Activate shared editing');await wait(()=>!!editor?.isEditable,'active Source');await tick();
  eq('health pristine Source text',editor!.state.doc.textContent,'base');eq('health pristine Save disabled',button('Save changes').disabled,true);eq('pristine mounted editor has no pending work',counts(),expected);
  await act(async()=>{editor!.commands.setTextSelection(5);editor!.commands.insertContent('X');});await tick();eq('edit is pending',getPendingWritesSnapshot().dirty>baseline.dirty,true);eq('draft not saved yet',await savedText(),'base');
  let flushed:Awaited<ReturnType<typeof flushPendingWrites>>|undefined;await act(async()=>{flushed=await flushPendingWrites();});await tick();eq('normal flush succeeds',flushed?.ok,true);eq('normal flush saved content',await savedText(),'baseX');eq('saved mounted editor has no pending work',counts(),expected);eq('saved button disabled',button('Save changes').disabled,true);
  await click('Undo');eq('Undo after Save is pending',getPendingWritesSnapshot().dirty>baseline.dirty,true);eq('Undo keeps saved Source until next Save',await savedText(),'baseX');
  editor=undefined;await click('Discard and reload');await wait(()=>!!editor?.isEditable,'discard editor');await tick();eq('Discard restores saved content',editor!.state.doc.textContent,'baseX');eq('Discard leaves mounted ledger clean',counts(),expected);
  await act(async()=>root.unmount());editor=undefined;root=createRoot(element);await mount();await wait(()=>!!editor?.isEditable,'reopened Source');await tick();eq('reopened content exact',editor!.state.doc.textContent,'baseX');eq('reopened mounted ledger clean',counts(),expected);
  // A real archived draft remains pending and copyable; a failed flush is truthful.
  await act(async()=>{editor!.commands.setTextSelection(6);editor!.commands.insertContent('R');});await tick();const draftText=editor!.state.doc.textContent,current=await readSourceToolDocument({projectId:P},D,NS);eq('recovery starts with actual draft',draftText,'baseXR');
  const archive=await runBridgeTool('wh_local_tool_document_archive',{projectId:P,documentId:D,namespace:NS,expectedRevision:current!.document.revision,expectedVersion:current!.version});eq('normal MCP archive succeeds',archive.ok,true);await wait(()=>!!editor&&!editor.isEditable,'readonly recovery');
  eq('readonly recovery preserves draft',editor!.state.doc.textContent,draftText);eq('readonly recovery stays pending',getPendingWritesSnapshot().dirty>baseline.dirty,true);const archived=JSON.stringify(await db.documentArchives.toArray());
  await act(async()=>{flushed=await flushPendingWrites();});await tick();eq('recovery flush refuses false success',flushed?.ok,false);eq('recovery flush keeps draft',editor!.state.doc.textContent,draftText);eq('recovery flush preserves archive',JSON.stringify(await db.documentArchives.toArray()),archived);eq('recovery remains pending after flush',getPendingWritesSnapshot().dirty>baseline.dirty,true);
 }finally{await act(async()=>root.unmount());if(await db.projects.get(P))await deleteProject(P);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);eq('cleanup ledger',counts(),expected);useLocaleStore.setState({locale});console.error('SAVE_STATUS1920_CLEANUP '+JSON.stringify({zero:true,checks:checks.length}));}
 return checks;
}
