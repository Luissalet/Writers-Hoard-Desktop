import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import type {CodexEntry} from '@/types';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {saveCodexDraft} from '@/engines/codex/operations';
import {saveWorldEra,readWorldDocument} from '@/services/worldEras/store';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {useLocaleStore} from '@/stores/localeStore';
import {t} from '@/i18n/useTranslation';

const state=window as unknown as {__want:unknown;__sizeAck?:number;__native:unknown;__nativeAck?:number;__shot:unknown;__shotDone?:string};
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));let seq=0;
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function wait(check:()=>boolean){for(let i=0;i<220;i++){if(check())return;await pause();}throw Error('Codex small-flow handshake timeout');}
async function settle(check:()=>boolean){for(let i=0;i<220;i++){if(check())return;await act(async()=>{await pause();});}throw Error('Codex draft did not settle');}
async function native(events:unknown[]){const n=++seq;await act(async()=>{state.__native={n,events};await wait(()=>state.__nativeAck===n);await pause();});}
async function click(node:HTMLElement){assert(node,'Missing Codex action');node.scrollIntoView({block:'center',behavior:'instant'});const r=node.getBoundingClientRect(),p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseMove',x:p.x,y:p.y},{type:'mouseDown',...p},{type:'mouseUp',...p}]);}
async function type(node:HTMLInputElement,text:string){await click(node);await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']}]);await native([{type:'text',text}]);assert(node.value===text,'Native typing did not settle');}
export async function testCodexSmallFlowsDepth(){
 const root=createRoot(document.getElementById('root')!),P=`codex-small-${Date.now()}`,id=`${P}-card`,results:string[]=[];
 const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;const ctx=canvas.getContext('2d')!;ctx.fillStyle='red';ctx.fillRect(0,0,120,160);ctx.fillStyle='blue';ctx.fillRect(120,0,120,160);const original=canvas.toDataURL();
 const entry:CodexEntry={id,projectId:P,title:'Synthetic card',type:'character',avatar:original,avatarOriginal:original,fields:{age:'120','職業':'Cartógrafo',legacy:'KEEP'},referenceFields:{allies:[`${P}-friend`]},content:'<p>Exact authored body 🧭</p>',tags:['personal'],relations:[],createdAt:1,updatedAt:1};
 try{
  useLocaleStore.setState({locale:'en'});await db.projects.put({id:P,title:'Synthetic small flows',type:'standalone',mode:'custom',enabledEngines:['codex'],createdAt:1,updatedAt:1});await db.codexEntries.put(entry);await db.codexEntries.put({...entry,id:`${P}-friend`,title:'Friend',avatar:undefined,avatarOriginal:undefined,referenceFields:{}});
  await saveWorldEra(P,{id:'later',name:'Later',description:'',revision:0,createdAt:1,updatedAt:1},null);
  for(const [width,eraId]of [[1440,undefined],[640,'later']]as const){
   let saved:CodexEntry|undefined;
   const n=++seq,base=(await readWorldDocument({projectId:P,eraId},'codex',id))!.document.root as unknown as CodexEntry;
   await act(async()=>{state.__want={w:width,h:1100,n};await wait(()=>state.__sizeAck===n);root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:`small-${width}`,projectId:P,eraId,visible:true,primary:true}}><main className="bg-deep p-5 text-text-primary"><CodexEntryForm key={width} projectId={P} entry={base} onSave={async(draft,baseline)=>{saved=await saveCodexDraft(baseline!,draft,{projectId:P,eraId});}} onCancel={()=>{}}/></main></EnginePaneContext.Provider></MemoryRouter>);await pause();});
   const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===text)!;
   await act(async()=>{await pause();});
   assert(button('Location'),'Existing card has no plain category selector');await click(button('Location'));
   assert([...document.querySelectorAll<HTMLInputElement>('input')].some(node=>node.value==='120')&&[...document.querySelectorAll('span')].some(node=>node.textContent==='Friend'),'Changing type discarded incompatible authored values/references');
   const field=document.querySelector<HTMLInputElement>('input[id$="-new-field"]')!;await type(field,'Ruta 🧭');await native([{type:'keyDown',keyCode:'Enter'},{type:'char',keyCode:'Enter'},{type:'keyUp',keyCode:'Enter'}]);
   const label=[...document.querySelectorAll<HTMLLabelElement>('label')].find(node=>node.textContent==='Ruta 🧭');assert(label,'Unicode card-only field not created');await type(document.getElementById(label.htmlFor)as HTMLInputElement,'Sólo esta ficha');
   await type(field,'  Ruta   🧭  ');await click(button(t('codex.fields.add')));assert(field.getAttribute('aria-invalid')==='true','Duplicate normalized field silently accepted');
   const imageButton=document.querySelector<HTMLButtonElement>(`button[aria-label="${t('imageCrop.title')}"]`)!;await click(imageButton);await act(async()=>{await wait(()=>!!document.querySelector<HTMLImageElement>('.ReactCrop img')?.complete);});await click(button(t('imageCrop.rotate')));await click(button(t('imageCrop.attach')));
   await settle(()=>!document.querySelector('.ReactCrop'));await click(button(t('codex.saveChanges')));await act(async()=>{await wait(()=>!!saved);});
   const read=await runBridgeTool('wh_world_era_document_get',{projectId:P,eraId,kind:'codex',entityId:id});assert(read.ok,`MCP complete card read failed:${read.error}`);const actual=(read.result as {document:{root:CodexEntry}}).document.root;
   assert(actual.type==='location'&&actual.fields.age==='120'&&actual.fields['職業']==='Cartógrafo'&&actual.fields['Ruta 🧭']==='Sólo esta ficha'&&actual.referenceFields?.allies[0]===`${P}-friend`&&actual.content===entry.content&&actual.tags[0]==='personal','Normal Save/MCP read lost authored data');
   assert(actual.avatarOriginal===original&&actual.avatar!==original,'Normal Save did not retain cropped/original separately');const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=reject;image.src=actual.avatar!;});assert(image.naturalWidth===160&&image.naturalHeight===240,'Codex persisted wrong rotated dimensions');
   assert((await db.codexEntries.get(`${P}-friend`))!.fields['Ruta 🧭']===undefined,'Card-only property leaked to another card');
   await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{instanceId:`reopen-${width}`,projectId:P,eraId,visible:true,primary:true}}><main className="bg-deep p-5 text-text-primary"><CodexEntryForm key={`reopen-${width}`} projectId={P} entry={actual} onSave={async(draft,baseline)=>{saved=await saveCodexDraft(baseline!,draft,{projectId:P,eraId});}} onCancel={()=>{}}/></main></EnginePaneContext.Provider></MemoryRouter>);await pause();});
   await settle(()=>document.querySelector<HTMLInputElement>('input[id$="-new-field"]')?.value===''&&document.querySelector('fieldset')?.getAttribute('aria-busy')==='false'&&!!document.querySelector('[data-reference-field="allies"]')?.textContent?.includes('Friend'));
   document.querySelector('fieldset')!.scrollIntoView({block:'start',behavior:'instant'});
   assert(button('Location').getAttribute('aria-pressed')==='true','Reopened card lost category selection');
   const shot=`codex-small-reopened-${width}`;await act(async()=>{state.__shot={name:shot,forcePaint:true};await wait(()=>state.__shotDone===shot);});
   assert([...document.querySelectorAll<HTMLInputElement>('input')].some(node=>node.value==='Sólo esta ficha'),'Reopening lost card-only Unicode property');
   const cloned=await importProjectData(await exportProjectData(P));
   try{const clonedProject=(await db.projects.get(cloned))!,clonedId=(await db.codexEntries.where('projectId').equals(cloned).toArray()).find(row=>row.title===entry.title)!.id,clonedEra=eraId?clonedProject.worldEras![0].id:undefined;const clone=(await readWorldDocument({projectId:cloned,eraId:clonedEra},'codex',clonedId))!.document.root as unknown as CodexEntry;assert(clone.avatar===actual.avatar&&clone.avatarOriginal===original&&clone.fields['Ruta 🧭']==='Sólo esta ficha'&&clone.referenceFields!.allies[0]!==`${P}-friend`,'JSON clone lost image/original/field or retained source reference');}finally{await deleteProject(cloned);}
   results.push(`Native${width}/${eraId??'Base'}: category change retains incompatible fields/references, Unicode card-only property rejects collision, rotated avatar/original survive Save/reopen and normal MCP read`);
   // Restore through the normal writer so the next scope starts from the same Base fixture.
   if(!eraId)await act(async()=>{await saveCodexDraft(actual,entry,{projectId:P});await pause();});
  }
  assert((await db.codexEntries.get(id))!.avatar===original&&(await db.codexEntries.get(id))!.type==='character','Era edit changed Base');
  return results;
 }finally{await act(async()=>root.unmount());await deleteProject(P);}
}
