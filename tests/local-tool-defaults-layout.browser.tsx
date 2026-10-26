import {act,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {LocalToolUndoBoundary} from '@/engines/local/LocalToolUndoBoundary';
import {useLocaleStore} from '@/stores/localeStore';
import definition from '@/engines/local/examples/iconNotebookDefinition';
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,30));
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function until(test:()=>boolean,message:string){for(let i=0;i<250;i++){if(test())return;await act(async()=>{await pause();});}throw Error(message);}
export async function testLocalToolDefaultsLayout(){
 const target=document.getElementById('root');check(target,'Missing root');const root=createRoot(target),channel=window as unknown as {__want?:{n:number;w:number;h:number};__sizeAck?:number;__shot?:{name:string};__shotDone?:string},passed:string[]=[];let sequence=0;
 const render=async(node:ReactNode)=>{await act(async()=>{root.render(node);await pause();});};
 const button=(label:string)=>{const value=[...target.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent===label);check(value,'Missing '+label);return value;};
 try{for(const scene of [{locale:'en',width:1280,state:'absent'},{locale:'en',width:1280,state:'saved'},{locale:'es',width:390,state:'saved'},{locale:'es',width:390,state:'error'},{locale:'en',width:1280,state:'busy'},{locale:'en',width:390,state:'unknown'},{locale:'es',width:390,state:'old-host'}]){
  const n=++sequence;channel.__want={n,w:scene.width,h:1000};await until(()=>channel.__sizeAck===n,'Resize handshake');await act(async()=>{useLocaleStore.setState({locale:scene.locale as 'en'|'es',loaded:true});});
  const projectId='defaults-layout-'+scene.state,documentId=projectId+'-doc',host=createFakeLocalToolHost(definition,{projects:[{id:projectId,updatedAt:1,sourceToolDocuments:[{id:documentId,namespace:definition.namespace,title:'Favorite notebook',revision:1,createdAt:1,updatedAt:1,data:{version:1,iconId:'writer-map-symbols/1:Castle',notes:'Saved independent notes.'},codec:definition.codec}]}]}),base=host.createClient({projectId},false,documentId),service=base.defaults!;
  if(!['absent','old-host'].includes(scene.state))await service.set('favorite-icon',scene.state==='unknown'?'future:UnknownFavorite':'writer-map-symbols/1:BookOpen',await service.get('favorite-icon'));
  let release:()=>void=()=>{};const client=scene.state==='old-host'?{...base,defaults:undefined}:scene.state==='busy'?{...base,defaults:{...service,set:()=>new Promise<never>(resolve=>{release=()=>resolve(undefined as never);})}}:scene.state==='error'?{...base,defaults:{...service,set:async()=>{throw Error('Synthetic preference failure');}}}:base;
  const Component=definition.component;await render(<MemoryRouter><LocalToolUndoBoundary><Component projectId={projectId} client={client} context={{view:'editor',canEdit:true,scope:{projectId},document:{id:documentId,namespace:definition.namespace,title:'Favorite notebook'}}}/></LocalToolUndoBoundary></MemoryRouter>);
  const es=scene.locale==='es',label=es?'Guardar favorito':'Save favorite';await until(()=>!!target.querySelector('textarea:not(:disabled)')&&target.querySelectorAll('ul button').length>0&&(!client.defaults||!button(label).disabled),'Layout ready');
  const search=target.querySelector<HTMLInputElement>('input[type="search"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'Castle');search.dispatchEvent(new Event('input',{bubbles:true}));await pause();});await until(()=>target.querySelectorAll('ul button').length===1,'Filtered catalogue ready');
  const notes=target.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(notes,es?'Borrador de notas independiente: el favorito no lo guarda.':'Independent notes draft: saving a favorite does not save it.');notes.dispatchEvent(new Event('input',{bubbles:true}));await pause();});
  if(scene.state==='busy'||scene.state==='error'){await act(async()=>{button(label).click();await pause();});await until(()=>scene.state==='busy'?button(label).disabled:!!target.querySelector('[role="alert"]'),'Pending/error state missing');}
  const before=host.inspect(),source=await base.read();await act(async()=>{await pause();});check(notes.value.includes(es?'Borrador':'Independent'),'Draft lost');check(!notes.disabled,'Preference blocked notes');check(document.documentElement.scrollWidth<=scene.width+1,'Horizontal page overflow');
  for(const node of target.querySelectorAll<HTMLElement>('[aria-label="'+(es?'Favorito compartido':'Shared favorite')+'"] button'))check(node.getBoundingClientRect().height>=39.5,'Favorite control below40px');
  if(scene.state!=='old-host'&&scene.state!=='busy'){button(label).focus();check(parseFloat(getComputedStyle(button(label)).outlineWidth)>=2,'Favorite focus outline missing');}
  const panel=target.querySelector<HTMLElement>('[aria-label="'+(es?'Favorito compartido':'Shared favorite')+'"]')!;const text=panel.querySelector<HTMLElement>('[role="alert"]')??panel.querySelector<HTMLElement>('[role="status"]');check(text,'Preference status absent');const color=getComputedStyle(text).color,bg=getComputedStyle(document.body).backgroundColor;
  console.log('DEFAULTS_LAYOUT '+JSON.stringify({locale:scene.locale,width:scene.width,state:scene.state,color,background:bg,notesEditable:!notes.disabled}));
  check(JSON.stringify(host.inspect())===JSON.stringify(before),'Layout read wrote fixtures');check(JSON.stringify(await base.read())===JSON.stringify(source),'Layout changed Source');
  const name='sdk-defaults-'+scene.state+'-'+scene.locale+'-'+scene.width;channel.__shot={name};await until(()=>channel.__shotDone===name,'Screenshot handshake');passed.push(name+'; no horizontal overflow,40px controls,2px enabled focus and independent editable draft');
  await render(<p>Scene complete</p>);release();
 }}finally{await act(async()=>root.unmount());}return passed;
}
