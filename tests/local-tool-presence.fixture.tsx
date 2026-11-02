import {LocalDocumentPresenceHost} from '@/engines/local/presence/host';
import {readLocalPresenceProfiles} from '@/engines/local/presence/profile';
import {saveWorldEra} from '@/services/worldEras/store';
import {Extension,type Editor} from '@tiptap/core';
import {defineLocalTool,LocalToolCollaborativeRichEditor,useLocalToolDocumentPresenceById} from '@/engines/local/sdk';
import '@/services/aiBridge/dispatch';
import '@/engines';
import {act,StrictMode,useLayoutEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import example from '@/engines/local/installed/examples.published-fields/module';
import type {LocalToolProps,LocalToolHostContext,LocalToolJson} from '@/engines/local/sdk';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
import {useLocaleStore} from '@/stores/localeStore';
type Data={score:number;note:string};
type Coords={projectId:string;documentId:string};
let observedById:unknown[]=[];
let coords:Coords,richId='',showRich=false,editor:Editor|undefined,root:Root|undefined,observed:LocalToolHostContext|undefined;
const marker='own-presence1893-portability-r1';
function assert(value:unknown,text:string):asserts value{if(!value)throw Error(text);}
const Actual=example.component;
const captureEditor=Extension.create({name:'presenceQACapture',onCreate(){editor=this.editor;},onDestroy(){if(editor===this.editor)editor=undefined;}}),richExtensions=[captureEditor];
function RichFixture(props:LocalToolProps<Record<string,LocalToolJson>>){const first=useLocalToolDocumentPresenceById(props.client,{namespace:props.client.namespace,documentId:props.client.documentId!}),second=useLocalToolDocumentPresenceById(props.client,{namespace:props.client.namespace,documentId:props.client.documentId!});useLayoutEffect(()=>{observedById=[first,second];},[first,second]);useLayoutEffect(()=>{observed=props.context;return()=>{if(observed===props.context)observed=undefined;};},[props.context]);return <LocalToolCollaborativeRichEditor {...props} field="body" extensions={richExtensions}/>;}
const richDefinition=defineLocalTool<Record<string,LocalToolJson>>({namespace:'tests.presence-rich',name:{en:'Presence rich fixture',es:'Prueba de presencia rica'},description:{en:'Owned known and unknown caret fixture',es:'Prueba propia de puntos conocidos'},document:{defaultTitle:{en:'Presence rich',es:'Presencia rica'},embed:'interactive'},initialState:{body:{type:'doc',content:[{id:'known-paragraph',type:'paragraph',content:[{type:'text',text:'Known abc'}]}]}},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}},validateState:(v:LocalToolJson):v is Record<string,LocalToolJson>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:RichFixture});
const richClient=()=>createLocalToolClient(coords.projectId,richDefinition,{documentId:richId});

function Probe(props:LocalToolProps<Data>){useLayoutEffect(()=>{observed=props.context;return()=>{if(observed===props.context)observed=undefined;};},[props.context]);return <Actual {...props}/>;}
const register=()=>registerLocalToolModules({['./installed/'+example.namespace+'/module.tsx']:{default:{...example,component:Probe}},['./installed/'+richDefinition.namespace+'/module.tsx']:{default:richDefinition}});
const client=()=>createLocalToolClient(coords.projectId,example,{documentId:coords.documentId});
const wait=async(test:()=>boolean,name:string)=>{for(let i=0;i<200;i++){if(test())return;await act(async()=>{await new Promise(r=>setTimeout(r,20));});}throw Error('Health timeout '+name);};
const tagged=(v:unknown):unknown=>v===undefined?['undefined']:v===null?['null']:Array.isArray(v)?['array',v.map(tagged)]:typeof v==='object'?['object',Object.keys(v as object).sort().map(k=>[k,tagged((v as Record<string,unknown>)[k])])]:[typeof v,v];
const snapshot=async()=>JSON.stringify(tagged(await db.transaction('r',db.tables,()=>Promise.all(db.tables.map(async t=>({name:t.name,rows:(await t.toArray()).sort((a,b)=>String(a.id).localeCompare(String(b.id)))}))))));
async function identity(){const c=client();return{coords,snapshot:await c.read(),checkpoint:(await c.convergence!.export()).checkpoint};}
async function initialize(){await db.open();assert(db.tables.length===89,'Health requires89tables');assert((await Promise.all(db.tables.map(t=>t.count()))).every(x=>x===0),'Health requires private empty library');register();useLocaleStore.setState({locale:'en',loaded:true});return{tables:89};}
async function seed(){await initialize();const projectId='presence1893-'+crypto.randomUUID();await db.projects.add({id:projectId,title:marker,description:marker,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+example.namespace,'local-tool-'+richDefinition.namespace],createdAt:1,updatedAt:1});coords={projectId,documentId:(await createSourceToolDocument({projectId},example.namespace,'Presence Source')).id};const c=client();await c.convergence!.start(await c.read());richId=(await createSourceToolDocument({projectId},richDefinition.namespace,'Presence rich')).id;const rich=richClient();await rich.convergence!.start(await rich.read());const zip=await createProjectZipArchive(projectId);return{coords,richId,zip:Array.from(new Uint8Array(await zip.blob.arrayBuffer())),identity:await identity()};}
async function restore(value:{coords:Coords;richId:string;zip:number[]}){await initialize();coords=value.coords;richId=value.richId;const ids=await importProjectZip(new File([new Uint8Array(value.zip)],'presence-project.zip',{type:'application/zip'}));assert(ids.length===1&&ids[0]===coords.projectId,'ZIP did not retain projectId');return identity();}
async function mount(score:number){root=createRoot(document.getElementById('root')!);await act(async()=>root!.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={coords.projectId} documentId={coords.documentId} namespace={example.namespace}/></MemoryRouter></StrictMode>));const input=()=>document.querySelector<HTMLInputElement>('[data-published-fields-example] input');await wait(()=>input()?.value==='7'&&!!observed,'Source example ready7');const before=await snapshot(),c=client(),saved=await c.read();assert(saved.data.score===7,'Saved7 missing before draft');await act(async()=>{const el=input()!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,String(score));el.dispatchEvent(new Event('input',{bubbles:true}));});await wait(()=>input()?.value===String(score),'normal draft input');assert((await c.read()).data.score===7,'Draft mutated saved score');assert(await snapshot()===before,'Draft changed durable89');return{saved:7,draft:input()!.value,sourceInstance:document.querySelector<HTMLElement>('[data-published-fields-example]')!.dataset.instance,identity:await identity(),dbExact:true,ledger:{...getPendingWritesSnapshot()}};}
function missingPort(){assert(observed,'Source context missing after health');assert(Reflect.get(observed,'presence'),'PRESENCE1893_PORT_MISSING_AFTER_SOURCE_HEALTH_SAVED7_DRAFT9_11');return true;}
async function cleanup(){if(root){await act(async()=>root!.unmount());root=undefined;}if(coords){const project=await db.projects.get(coords.projectId);assert(!project||project.description===marker,'Foreign cleanup refused');if(project)await deleteProject(coords.projectId);}await db.settings.where('key').equals('writer.presence.profiles').delete();if(await db.settings.get('storage.persistRequestedAt'))await db.settings.delete('storage.persistRequestedAt');const counts=Object.fromEntries(await Promise.all(db.tables.map(async t=>[t.name,await t.count()])));assert(Object.values(counts).every(x=>x===0),'Private89cleanup incomplete');return{counts,mounted:false,ledger:{...getPendingWritesSnapshot()}};}

const click=async(text:string)=>{const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);assert(button,'Missing public button '+text);await act(async()=>button.click());};
async function share(name:string){await click('Share local session');await wait(()=>!!document.querySelector('[aria-label="Profile name"]'),'share profile');await act(async()=>{const box=document.querySelector<HTMLInputElement>('[aria-label="Profile name"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(box,name);box.dispatchEvent(new Event('input',{bubbles:true}));});}
async function closeShare(){await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await wait(()=>!document.querySelector('[data-presence-dialog]'),'share dialog closed');}
async function createSession(name:string){await share(name);await click('Create session');await wait(()=>!!document.querySelector<HTMLInputElement>('[aria-label="Share link"]')?.value,'created share link');const link=document.querySelector<HTMLInputElement>('[aria-label="Share link"]')!.value;await closeShare();return{link,snapshot:observed!.presence!.getSnapshot()};}
async function joinSession(value:{name:string;link:string}){await share(value.name);await act(async()=>{const box=document.querySelector<HTMLInputElement>('[aria-label="Local session link"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(box,value.link);box.dispatchEvent(new Event('input',{bubbles:true}));});await click('Join session');await wait(()=>observed!.presence!.getSnapshot().status==='ready','joined presence');await closeShare();return observed!.presence!.getSnapshot();}
function presence(){return observed?.presence?.getSnapshot();}
function publish(state:LocalToolJson|null){assert(observed?.presence,'Presence port absent');observed.presence.setLocal(state);}
async function readonlyBaseline(){return{db:await snapshot(),ledger:{...getPendingWritesSnapshot()},snapshot:await (showRich?richClient():client()).read()};}
async function mcpQuery(){return (showRich?richClient():client()).callTool('wh_local_tool_presence_query',{namespace:showRich?richDefinition.namespace:example.namespace,documentId:showRich?richId:coords.documentId});}


async function mountRich(){if(root)await act(async()=>root!.unmount());root=createRoot(document.getElementById('root')!);showRich=true;await act(async()=>root!.render(<StrictMode><MemoryRouter><LocalToolDocumentHost projectId={coords.projectId} documentId={richId} namespace={richDefinition.namespace}/></MemoryRouter></StrictMode>));await wait(()=>!!editor&&!editor.isDestroyed&&editor.getText()==='Known abc','real rich Source editor');return{saved:(await richClient().read()).data,html:editor!.getHTML()};}
async function selectRich(){await act(async()=>{editor!.commands.setTextSelection({from:2,to:4});editor!.view.focus();editor!.view.dom.dispatchEvent(new FocusEvent('focus',{bubbles:false}));});await wait(()=>!!editor?.isFocused,'controlled rich DOM focus event');return richStatus();}
async function typeRich(){await act(async()=>{editor!.commands.setTextSelection(3);editor!.commands.insertContent('X');});return richStatus();}
async function undoRich(){await click('Undo');return richStatus();}
function richStatus(){return{html:editor?.getHTML(),text:editor?.getText(),focused:editor?.isFocused,carets:document.querySelectorAll('[data-presence-caret]').length,selections:document.querySelectorAll('[data-presence-selection]').length,presence:observed?.presence?.getSnapshot()};}


function pointerSurface(){const surface=document.querySelector<HTMLElement>('[data-presence-surface]')!,box=surface.getBoundingClientRect();surface.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:box.left+box.width*0.3,clientY:box.top+box.height*0.4}));return{width:box.width,height:box.height};}
function prepareViewport(){const container=document.getElementById('root')!;container.style.height='180px';container.style.overflow='auto';const spacer=document.createElement('div');spacer.setAttribute('data-own-presence-spacer','');spacer.style.height='1600px';container.appendChild(spacer);return container.scrollHeight;}
function scrollViewport(top:number){document.getElementById('root')!.scrollTop=top;return document.getElementById('root')!.scrollTop;}
function viewportStatus(){return{top:document.getElementById('root')!.scrollTop,pointers:document.querySelectorAll('[data-presence-pointer]').length,following:[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop following Ada')};}
async function followAda(){await click('Follow Ada');return viewportStatus();}
function cancelFollow(){document.querySelector('[data-presence-surface]')!.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:1}));return true;}
async function unmountOnly(){if(root)await act(async()=>root!.unmount());root=undefined;observed=undefined;return true;}


async function updateScopeRace(){
 await saveWorldEra(coords.projectId,{id:'own-presence-era',name:'Own presence era',description:'',revision:0,createdAt:1,updatedAt:1},null);const real=createLocalToolClient(coords.projectId,richDefinition,{eraId:'own-presence-era',documentId:richId});let armed=false,entered=false,release!:()=>void;const gate=new Promise<void>(r=>release=r),wrapped={...real,read:async()=>{const value=await real.read();if(armed){armed=false;entered=true;await gate;}return value;}};
 const host=new LocalDocumentPresenceHost(wrapped,'own-controlled-scope-'+crypto.randomUUID(),()=>true);try{const profiles=await readLocalPresenceProfiles(),profile=profiles.profiles.find(p=>p.userId===profiles.selected)!;await host.create(profile);host.port.setLocal({value:'before'});await wait(()=>{const state=host.snapshot().peers[0]?.state;return !!state&&typeof state==='object'&&!Array.isArray(state)&&state.value==='before';},'controlled real scope before payload');armed=true;host.port.setLocal({value:'must-not-appear'});await wait(()=>entered,'last client.read held without React lease');await db.projects.update(coords.projectId,{worldEras:[]});const afterDelete=await snapshot();release();await wait(()=>host.snapshot().peers.length===0,'expired era withdrawn');assert(await snapshot()===afterDelete,'Scope refusal wrote DB89 after intentional era removal');return{currentLeaseAlwaysTrue:true,scopeRemovedDuringRead:true,peers:host.snapshot().peers,dbExactAfterRemoval:true,attribution:'Controlled trusted host carrier on real adapter and real SSE, not Source-issued by UI'};}finally{release();host.dispose();}
}


async function attachExisting(value:{coords:Coords;richId:string}){await db.open();coords=value.coords;richId=value.richId;const project=await db.projects.get(coords.projectId);assert(project?.description===marker,'Third normal view did not share the owned first library');register();useLocaleStore.setState({locale:'en',loaded:true});return identity();}
function byId(){return observedById;}

Reflect.set(window,'__presence1893',{seed,restore,mount,identity,missingPort,cleanup,createSession,joinSession,presence,publish,readonlyBaseline,mcpQuery,mountRich,selectRich,typeRich,undoRich,richStatus,pointerSurface,prepareViewport,scrollViewport,viewportStatus,followAda,cancelFollow,unmountOnly,updateScopeRace,attachExisting,byId});Reflect.set(window,'__presence1893Ready',true);
