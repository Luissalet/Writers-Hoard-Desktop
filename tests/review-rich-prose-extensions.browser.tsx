import {act,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Extension,Node,type AnyExtension,type Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,defineLocalToolBlock,LocalToolRichProseEditor,type LocalToolClient,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {createLocalToolClient} from '@/engines/local/storage';
import {useLocaleStore} from '@/stores/localeStore';
import TiptapEditor from '@/components/editor/TiptapEditor';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {saveCodexDraft} from '@/engines/codex/operations';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {findLocalToolBlocksInHtml,serializeLocalToolBlock} from '@/engines/local/blocks/types';
import {authorCard} from './fixtures/local-tools/author-data';
import {flushPendingWrites,getPendingWritesSnapshot} from '@/services/pendingWrites';

type Data={briefing:string;caption:string};
const initialState:Data={briefing:'<p>Marker67 words</p>',caption:'Unchanged sibling Élodie 李明'};
const codec={version:1 as const,fields:{briefing:{kind:'prose' as const,format:'rich' as const},caption:{kind:'scalar' as const}}};
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
async function until(check:()=>boolean|Promise<boolean>,message:string){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await act(async()=>{await pause();});}throw Error(message+' '+document.body.textContent?.slice(-800));}
const button=(text:string,scope:ParentNode=document)=>[...scope.querySelectorAll('button')].find(node=>node.textContent?.trim()===text);
async function click(node:Element|undefined|null){assert(node,'Missing control');await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));await pause();});}
const editorOf=(scope:ParentNode=document)=>(scope.querySelector('.tiptap') as HTMLElement&{editor:Editor})?.editor;

function authorFixture(suffix:string,customDoc=false,empty=false){
 const observed={creates:0,destroys:0,keys:0,clients:[] as LocalToolClient<Data>[],editors:[] as Editor[]};
 const observer=Extension.create({name:'ownReviewExtensions67',onCreate(){observed.creates++;observed.editors.push(this.editor);},onDestroy(){observed.destroys++;},addKeyboardShortcuts(){return {'Mod-Shift-y':()=>{observed.keys++;return this.editor.commands.toggleBold();}};}});
 const doc=Node.create({name:'doc',topNode:true,content:'paragraph+'});
 const extensions:AnyExtension[]=empty?[]:customDoc?[doc,observer]:[observer];
 function View({client,context}:LocalToolProps<Data>){
  const[count,setCount]=useState(0);observed.clients.push(client);
  return <><button onClick={()=>setCount(value=>value+1)}>Review rerender {count}</button><LocalToolRichProseEditor client={client} context={context} field="briefing" extensions={extensions}/></>;
 }
 const namespace='tests.review-rich-'+suffix;
 const definition=defineLocalTool({namespace,name:{en:'Review rich extensions',es:'Revisión rich extensiones'},description:{en:'Independent extension fixture',es:'Fixture independiente'},initialState,codec,document:{defaultTitle:{en:'Review',es:'Revisión'},embed:'interactive'},validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.briefing==='string'&&typeof value.caption==='string',component:View,blocks:[defineLocalToolBlock({key:'review',scope:'host',name:{en:'Review',es:'Revisión'},initialState,codec,validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.briefing==='string'&&typeof value.caption==='string',component:View})]});
 return {definition,extensions,observed};
}
async function setup(suffix:string,customDoc=false,empty=false){
 const fixture=authorFixture(suffix,customDoc,empty),projectId='review-rich-extensions-'+crypto.randomUUID();
 registerLocalToolModules({[`./installed/${fixture.definition.namespace}/module.tsx`]:{default:fixture.definition}});
 await db.projects.put({id:projectId,title:'Independent rich extension QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','local-tool-'+fixture.definition.namespace],engineOrder:[],createdAt:1,updatedAt:1});
 const row=await createSourceToolDocument({projectId},fixture.definition.namespace,'Independent briefing');
 return {...fixture,projectId,row,client:createLocalToolClient(projectId,fixture.definition,{documentId:row.id})};
}
async function chord(editor:Editor){
 await act(async()=>{editor.commands.setTextSelection({from:1,to:9});editor.commands.focus();await pause();});
 assert(editor.state.selection.from===1&&editor.state.selection.to===9,'Selection did not settle before component keyboard delivery');
 await act(async()=>{editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'y',code:'KeyY',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));await pause();});
}

export async function testReviewRichExtensionsSource(){
 const f=await setup('source'),root=createRoot(document.getElementById('root')!),pending=getPendingWritesSnapshot().dirty;useLocaleStore.setState({locale:'en',loaded:true});
 try{
  const render=async(readOnly=false)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={f.row.id} retainPresentation readOnly={readOnly}/></MemoryRouter></StrictMode>);await pause();});};
  await render();await until(()=>!!editorOf()&&f.observed.creates>0,'Public Source wrapper did not install extension');
  const editor=editorOf(),saved=JSON.stringify(await f.client.read());
  assert(!editor.schema.nodes.sourceToolBlock&&!editor.schema.nodes.prepCheck,'Rich profile gained full operational atoms');
  const createCount=f.observed.creates,destroyCount=f.observed.destroys;
  await chord(editor);assert(f.observed.keys===1&&editor.getHTML().includes('<strong>Marker67</strong>'),'Public SDK→host extension keyboard behavior absent');
  assert(JSON.stringify(await f.client.read())===saved,'Extension gesture saved without explicit Save');
  await click(button('Review rerender 0'));await click(button('Review rerender 1'));
  assert(editorOf()===editor&&f.observed.creates===createCount&&f.observed.destroys===destroyCount&&editor.getHTML().includes('<strong>Marker67</strong>'),'Stable array rerenders recreated editor or lost draft');
  await act(async()=>{assert(editor.commands.undo(),'Local history did not undo extension gesture');await pause();});
  assert(editor.getHTML()===initialState.briefing,'Local undo did not restore baseline HTML');
  await chord(editor);await click(button('Save briefing'));await until(async()=>(await f.client.read()).data.briefing.includes('<strong>Marker67</strong>'),'Normal Source Save did not persist extension HTML');
  await click(button('Undo'));await until(async()=>(await f.client.read()).data.briefing===initialState.briefing,'Same-session Source Undo lost baseline');
  await click(button('Redo'));await until(async()=>(await f.client.read()).data.briefing.includes('<strong>Marker67</strong>'),'Same-session Source Redo lost extension output');
  assert((await f.client.read()).data.caption===initialState.caption,'Save/Undo/Redo changed sibling');
  await act(async()=>{editor.commands.setContent('<p>Local retained extension draft</p>');await pause();});
  const peer=createLocalToolClient(f.projectId,f.definition,{documentId:f.row.id});
  await act(async()=>{await peer.state!.apply(await peer.read(),[{type:'set',field:'briefing',value:'<p>Independent peer wins</p>'}]);await pause();});
  await click(button('Save briefing'));await until(()=>!!document.querySelector('[data-sdk-rich-prose] [role="alert"]'),'Overlapping Source CAS failure missing');
  assert(editor.getText()==='Local retained extension draft'&&(await peer.read()).data.briefing==='<p>Independent peer wins</p>','CAS failure lost draft or overwrote peer');
  const oldClient=f.observed.clients.at(-1)!;await render(true);await until(()=>!editor.isEditable,'Read-only rebind did not disable actual editor');
  assert(editorOf()===editor&&!editor.isDestroyed&&editor.getText()==='Local retained extension draft','Revocation remounted or lost retained draft');
  let revoked=false;try{await oldClient.read();}catch{revoked=true;}assert(revoked,'Old normal Source client was not revoked');
  const beforeFlush=JSON.stringify(await peer.read()),flushed=await flushPendingWrites();
  assert(!flushed.ok&&JSON.stringify(await peer.read())===beforeFlush,'Readonly pending flush wrote Source or discarded draft');
  assert(button('Save briefing')?.matches(':disabled')&&button('Undo')?.matches(':disabled'),'Readonly draft left Source controls enabled');
  await click(button('Discard changes'));await until(()=>!document.querySelector('[data-sdk-prose-editor]'),'Discard did not resolve readonly draft');
  assert(JSON.stringify(await peer.read())===beforeFlush,'Readonly discard changed Source');
  return ['Independent public SDK Source extension behavior, stable-array lifecycle and local Undo; synthetic component keyboard delivery, not Brave input','Normal Source RW Save/Undo/Redo preserves sibling; overlapping peer CAS retains draft; real readonly lease revokes old client and blocks flush without writes'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);assert(getPendingWritesSnapshot().dirty===pending,'Independent Source cleanup retained pending owner');}
}

export async function testReviewRichExtensionsDefaultsAndDocument(){
 const root=createRoot(document.getElementById('root')!),f=await setup('document',true),empty=await setup('empty',false,true);useLocaleStore.setState({locale:'en',loaded:true});
 try{
  await act(async()=>{root.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={f.projectId} documentId={f.row.id}/></MemoryRouter></StrictMode>);await pause();});await until(()=>!!editorOf()&&f.observed.creates>0,'Custom document extension not installed');
  const editor=editorOf(),names=editor.extensionManager.extensions.map(extension=>extension.name),starter=editor.extensionManager.extensions.find(extension=>extension.name==='starterKit');
  assert(names.filter(name=>name==='doc').length===1&&starter?.options.document===false,'Custom doc duplicated StarterKit document');
  assert(editor.schema.topNodeType.name==='doc'&&editor.schema.topNodeType.spec.content==='paragraph+','Custom public doc schema not active');
  assert(JSON.stringify((await f.client.read()).data)===JSON.stringify(initialState),'Custom document mount wrote state');
  await act(async()=>{root.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={empty.projectId} documentId={empty.row.id}/></MemoryRouter></StrictMode>);await pause();});await until(()=>!!editorOf()&&editorOf()!==editor,'Empty extension array host not ready');
  assert(editorOf().getHTML()===initialState.briefing&&editorOf().extensionManager.extensions.filter(extension=>extension.name==='doc').length===1,'Empty array changed normal rich baseline');
  const plainRead=JSON.stringify(await empty.client.read());await act(async()=>{root.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={empty.projectId} documentId={empty.row.id} readOnly/></MemoryRouter></StrictMode>);await pause();});await until(()=>!document.querySelector('[contenteditable="true"]'),'Initial readonly mounted editable node');
  assert(JSON.stringify(await empty.client.read())===plainRead,'Readonly mount wrote normal Source');
  let ready:Editor|null=null;
  const baseRender=async(key:string,extensions?:AnyExtension[])=>{await act(async()=>{root.render(<StrictMode><MemoryRouter><TiptapEditor key={key} content="<p>Full editor unchanged</p>" extensions={extensions} onEditorReady={value=>{ready=value;}}/></MemoryRouter></StrictMode>);await pause();});await until(()=>!!ready,'Full-profile editor not ready');};
  await baseRender('none');const none=ready!,order=none.extensionManager.extensions.map(extension=>extension.name);
  await baseRender('empty',[]);assert(JSON.stringify(ready!.extensionManager.extensions.map(extension=>extension.name))===JSON.stringify(order),'Full-profile noProp/[] extension order differs');
  const custom=Extension.create({name:'ownReviewFullExtension67'});await baseRender('custom',[custom]);
  assert(JSON.stringify(ready!.extensionManager.extensions.map(extension=>extension.name))===JSON.stringify([...order,'ownReviewFullExtension67']),'Full-profile extension order/defaults changed');
  assert(ready!.getHTML()==='<p>Full editor unchanged</p>','Full editor baseline changed');
  return ['Public Node.create doc installs exactly once with StarterKit.document:false; [] and readonly Source mounts retain saved baseline','Additional component control: full-profile no prop and [] have identical extension order; custom extension follows all incumbent entries'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);await deleteProject(empty.projectId);}
}

export async function testReviewRichExtensionsOwned(){
 const f=await setup('owned'),root=createRoot(document.getElementById('root')!);let saves=0;useLocaleStore.setState({locale:'en',loaded:true});
 const card={...authorCard(f.projectId,'Independent Owned extension'),id:f.projectId+'-card',content:serializeLocalToolBlock(f.projectId,createLocalToolBlockEnvelope(f.definition.namespace,f.definition.blocks![0],'review-owned67'))};
 function Parent(){const[current,setCurrent]=useState(card);return <EnginePaneContext.Provider value={{instanceId:'review-extensions-owned',projectId:f.projectId,visible:true}}><CodexEntryForm key={current.updatedAt} projectId={f.projectId} entry={current} onSave={async(draft,base)=>{setCurrent(await saveCodexDraft(base??current,draft));saves++;}} onCancel={()=>{}}/></EnginePaneContext.Provider>;}
 try{
  await db.codexEntries.put(card);await act(async()=>{root.render(<StrictMode><MemoryRouter><Parent/></MemoryRouter></StrictMode>);await pause();});
  const own=()=>document.querySelector('[data-source-block-id="review-owned67"]')!;await until(()=>!!own()&&!!editorOf(own())&&f.observed.creates>0,'Real Owned extension host absent');
  await chord(editorOf(own()));assert(f.observed.keys===1&&editorOf(own()).getHTML().includes('<strong>Marker67</strong>'),'Owned public extension behavior missing');
  await click(button('Save briefing',own()));await until(()=>button('Save briefing',own())?.matches(':disabled')===true,'Owned child Save incomplete');
  const beforeParent=findLocalToolBlocksInHtml((await db.codexEntries.get(card.id))!.content)[0].envelope;
  const oldData=beforeParent.scope==='host'?beforeParent.data:undefined;
  assert(oldData&&typeof oldData==='object'&&!Array.isArray(oldData)&&oldData.briefing===initialState.briefing,'Owned child bypassed parent writer');
  await click(button('Save Changes')??button('Save changes'));await until(()=>saves===1,'Normal parent Save incomplete');await until(()=>!!own()&&!!editorOf(own()),'Owned parent did not reopen');
  const after=findLocalToolBlocksInHtml((await db.codexEntries.get(card.id))!.content)[0].envelope;
  const newData=after.scope==='host'?after.data:undefined;
  assert(newData&&typeof newData==='object'&&!Array.isArray(newData)&&String(newData.briefing).includes('<strong>Marker67</strong>')&&newData.caption===initialState.caption,'Owned parent persistence lost extension output or changed sibling');
  assert((await f.client.read()).data.briefing===initialState.briefing,'Owned changed independent Source document');
  return ['Real Codex Owned public extension edits only its atom; child Save does not write the parent table; normal parent Save persists/reopens markup and preserves sibling Source'];
 }finally{await act(async()=>root.unmount());await deleteProject(f.projectId);}
}
