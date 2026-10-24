import '@/engines';
import {act,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import type {Editor} from '@tiptap/core';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {useLocaleStore} from '@/stores/localeStore';
import definition from '@/engines/local/installed/examples.localized-notebook/module';
import {defineLocalTool,useLocalToolT,useLocalToolLocale,type LocalToolProps,type LocalToolClient,type LocalToolJson} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {createLocalToolBlockEnvelope} from '@/engines/local/blocks/definitions';
import {serializeLocalToolBlock,findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {saveCodexDraft} from '@/engines/codex/operations';
import {authorCard} from './fixtures/local-tools/author-data';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {rememberLocalToolDefinition} from '@/engines/local/definitions';
export function localeAssert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
export async function localeUntil(check:()=>boolean|Promise<boolean>,message:string){const end=Date.now()+14000;while(Date.now()<end){if(await check())return;await act(async()=>{await pause();});}throw Error(message+' '+document.body.textContent?.slice(-900));}
const button=(name:string,scope:ParentNode=document)=>[...scope.querySelectorAll('button')].find(x=>x.textContent?.trim()===name);
async function click(el:Element|undefined){localeAssert(el,'Missing real control');await act(async()=>{el.dispatchEvent(new MouseEvent('click',{bubbles:true}));await pause();});}
const editorOf=(scope:ParentNode=document)=>{const node=scope.querySelector('[data-sdk-prose-editor] .tiptap') as HTMLElement&{editor:Editor};return node?.editor;};
export async function localeFixture(suffix:string){
 const projectId='locale-'+suffix+'-'+crypto.randomUUID();registerLocalToolModules({'./installed/examples.localized-notebook/module.tsx':{default:definition}});
 await db.projects.put({id:projectId,title:'Locale QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','writings','local-tool-'+definition.namespace],createdAt:1,updatedAt:1});const source=await createSourceToolDocument({projectId},definition.namespace,'Authored source title');return{projectId,source};
}
const channel=window as unknown as{__want:unknown;__sizeAck?:number;__shot:unknown;__shotDone?:string};let sequence=0;
async function resize(width:number){const n=++sequence;await act(async()=>{channel.__want={w:width,h:1000,n};for(let i=0;i<180&&channel.__sizeAck!==n;i++)await pause();localeAssert(channel.__sizeAck===n,'CSS runner resize missing');});}
async function shot(name:string){await act(async()=>{channel.__shot={name};for(let i=0;i<180&&channel.__shotDone!==name;i++)await pause();localeAssert(channel.__shotDone===name,'CSS runner capture missing');});}
export async function testLocalToolLocaleSourceOwned(){
 const f=await localeFixture('ui'),root=createRoot(document.getElementById('root')!),old=useLocaleStore.getState().locale;
 const owned=createLocalToolBlockEnvelope(definition.namespace,definition.blocks![0],'locale-owned'),entry={...authorCard(f.projectId,'Authored card title'),id:f.projectId+'-card',content:serializeLocalToolBlock(f.projectId,owned)};await db.codexEntries.put(entry);
 function Parent(){const [current,setCurrent]=useState(entry);return <EnginePaneContext.Provider value={{instanceId:'locale-owned',projectId:f.projectId,visible:true}}><CodexEntryForm entry={current} projectId={f.projectId} onCancel={()=>{}} onSave={async(draft,baseline)=>setCurrent(await saveCodexDraft(baseline??current,draft))}/></EnginePaneContext.Provider>;}
 try{
  for(const kind of ['source','owned']as const){await act(async()=>{await useLocaleStore.getState().setLocale('en');root.render(<StrictMode><MemoryRouter key={kind}>{kind==='source'?<LocalToolDocumentHost projectId={f.projectId} documentId={f.source.id}/>:<Parent/>}</MemoryRouter></StrictMode>);await pause();});const area=()=>kind==='owned'?document.querySelector('[data-source-block-id="locale-owned"]')!:document.querySelector('[data-source-document-host]')!;
   await localeUntil(()=>!!area()&&!!editorOf(area())&&!!area().querySelector('[data-localized-notebook]'),'Real example host not mounted');const editor=editorOf(area()),dom=editor.view.dom;
   await act(async()=>{editor.commands.setContent('<p>Nora keeps her own draft.</p>');editor.commands.setTextSelection(8);editor.commands.focus();await pause();});await act(async()=>{dom.focus();await pause();});localeAssert(dom.contains(document.activeElement),'Focus fixture was not established before language change');const activeBefore=document.activeElement?.outerHTML.slice(0,180),selection=JSON.stringify(editor.state.selection.toJSON()),html=editor.getHTML(),before=JSON.stringify({project:await db.projects.get(f.projectId),card:await db.codexEntries.get(entry.id),history:await db.documentHistory.where('projectId').equals(f.projectId).toArray()});
   await act(async()=>{await useLocaleStore.getState().setLocale('es');await pause();});await localeUntil(()=>!!area()?.textContent?.includes('Libreta local'),'Own catalog did not follow app ES');
   localeAssert(editorOf(area())===editor&&editor.view.dom===dom,'Language remounted real editor');console.log('LOCALE_UI_DIAG',JSON.stringify({kind,html,afterHtml:editor.getHTML(),selection,afterSelection:editor.state.selection.toJSON(),activeBefore,activeAfter:document.activeElement?.outerHTML.slice(0,180)}));localeAssert(editor.getHTML()===html&&JSON.stringify(editor.state.selection.toJSON())===selection&&dom.contains(document.activeElement),'Language lost draft/focus/selection '+JSON.stringify({kind,html,afterHtml:editor.getHTML(),selection,afterSelection:editor.state.selection.toJSON(),activeBefore,activeAfter:document.activeElement?.outerHTML.slice(0,180)}));localeAssert(before===JSON.stringify({project:await db.projects.get(f.projectId),card:await db.codexEntries.get(entry.id),history:await db.documentHistory.where('projectId').equals(f.projectId).toArray()}),'Language wrote document/codec/envelope/history');
   for(const width of [1280,390]){await resize(width);localeAssert(document.documentElement.scrollWidth<=innerWidth+1,'Locale example overflows page');await shot(`locale-${kind}-${width}`);}
   await click(button('Guardar informe',area()));await localeUntil(()=>!button('Guardar informe',area())?.matches(':enabled'),'Real child Save did not settle');
   if(kind==='source')localeAssert(String((await readSourceToolDocument({projectId:f.projectId},f.source.id))!.document.data.notes).includes('Nora keeps her own draft.'),'Source saved localized seed instead of authored words');
   else{await act(async()=>{await useLocaleStore.getState().setLocale('en');await pause();});await click(button('Save Changes'));await localeUntil(async()=>String((await db.codexEntries.get(entry.id))?.content).includes('Nora keeps her own draft.'),'Owned parent did not persist authored words');const saved=findLocalToolBlocksInHtml((await db.codexEntries.get(entry.id))!.content)[0].envelope;localeAssert(saved.scope==='host'&&String(saved.data.notes).includes('Nora keeps her own draft.'),'Owned changed authored content');}
  }
  return ['Real Source and Owned preserve editor identity, focus/selection/draft and exact authored envelopes across host EN→ES; explicit saves persist own words','One normal-CSS capture batch Source/Owned1280/390 preserves incumbent layout and no overflow'];
 }finally{await act(async()=>root.unmount());await useLocaleStore.getState().setLocale(old);await deleteProject(f.projectId);}
}
export async function testLocalToolLocaleHooks(){
 const host=createFakeLocalToolHost(definition,{projects:[{id:'hooks',updatedAt:1}]},{locale:'en'}),original=host.createClient({projectId:'hooks'}),root=createRoot(document.getElementById('root')!);let active=0,updates=0;const port={...original.locale!,subscribe:(fn:()=>void)=>{active++;const off=original.locale!.subscribe(fn);return()=>{active--;off();};}},client={...original,locale:port};let tree:unknown;let previous:unknown;const before=JSON.stringify(host.inspect());
 function Probe({current}:{current?:{locale?:typeof port}}){const t=useLocalToolT(current),snapshot=useLocalToolLocale(current);updates++;previous=tree;tree=snapshot.catalogs;return <p data-probe>{t('notebook.title')}:{t.locale}</p>;}
 try{await act(async()=>{root.render(<StrictMode><Probe current={client}/></StrictMode>);await pause();});localeAssert(active===2,'StrictMode left subscriptions');await act(async()=>{host.setLocale('es');await pause();});localeAssert(previous===tree&&document.querySelector('[data-probe]')?.textContent==='Libreta local:es','Locale derivation replaced prepared catalog');const stable=tree;for(let i=0;i<200;i++)client.locale.getSnapshot();localeAssert(tree===stable&&before===JSON.stringify(host.inspect()),'Primitive snapshot read rebuilt catalog or wrote data');await act(async()=>{root.render(<StrictMode><Probe/></StrictMode>);await pause();});localeAssert(active===0,'Retarget retained locale subscriptions');const count=updates;await act(async()=>{host.setLocale('en');await pause();});localeAssert(count===updates&&document.querySelector('[data-probe]')?.textContent==='notebook.title:en','Missing port pretends reactive host');return['Locale hooks prepare stable owned catalogs, subscribe only to host locale, unsubscribe on retarget/StrictMode and keep no-port fallback fixed English without data changes'];}finally{await act(async()=>root.unmount());localeAssert(active===0,'Unmount leaked locale listener');}
}
export async function testLocalToolLocaleDescribe(){
 const f=await localeFixture('describe');try{const before=JSON.stringify(await db.projects.get(f.projectId)),call=async(extra={})=>{const out=await runBridgeTool('wh_local_tool_describe',{projectId:f.projectId,namespace:definition.namespace,...extra});localeAssert(out.ok,'Describe failed '+JSON.stringify(out));return out.result as {locales?:{defaultLocale:string;supported:string[];catalogs?:unknown}};};const summary=await call();localeAssert(summary.locales?.defaultLocale==='en'&&summary.locales.supported.join(',')==='en,es'&&!('catalogs'in summary.locales),'Metadata opt-in broken');const full=await call({includeLocaleCatalogs:true});localeAssert(JSON.stringify(full.locales?.catalogs)===JSON.stringify(definition.locales!.catalogs),'Describe returned wrong own catalog');const legacy=defineLocalTool({...definition,namespace:'test.locale-legacy',locales:undefined});rememberLocalToolDefinition(legacy);const old=await runBridgeTool('wh_local_tool_describe',{namespace:legacy.namespace,includeLocaleCatalogs:true});localeAssert(old.ok&&!Object.hasOwn(old.result as object,'locales'),'Legacy describe shape changed');localeAssert(before===JSON.stringify(await db.projects.get(f.projectId)),'Describe changed project');return['Registered describe exposes own locale metadata/catalog opt-in and preserves legacy omission with zero document writes'];}finally{await deleteProject(f.projectId);}
}
export async function testLocalToolLocaleNativeDescribe(){
 const bridge=(window as unknown as{__localeNative?:{execute:(payload:unknown)=>Promise<{ok:boolean;result?:{locales?:{catalogs?:unknown}};error?:string}>}}).__localeNative;localeAssert(bridge,'Use --native existing IPC binding');const f=await localeFixture('native');try{const before=JSON.stringify(await db.projects.get(f.projectId));const result=await bridge.execute({tool:'wh_local_tool_describe',args:{projectId:f.projectId,namespace:definition.namespace,includeLocaleCatalogs:true}});localeAssert(result.ok&&JSON.stringify(result.result?.locales?.catalogs)===JSON.stringify(definition.locales!.catalogs),'Native executor/IPC describe did not return own catalogs: '+JSON.stringify(result));localeAssert(before===JSON.stringify(await db.projects.get(f.projectId)),'Readonly Native describe wrote document');return['Real readonly NativeExecutor→IPC→registered handler describes own catalog without writes, listener, key, external stdio or invented Undo'];}finally{await deleteProject(f.projectId);}
}
