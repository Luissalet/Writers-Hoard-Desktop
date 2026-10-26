import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { db } from '@/db';
import { actOnEntityCandidateDismissal as decide } from '@/services/entityDetection/service';
import { useLocaleStore } from '@/stores/localeStore';
import type { EntitySpan } from '@/services/entityDetection/types';
const pause = (ms=40) => new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
async function until(read:()=>boolean,message:string){for(let i=0;i<120;i++){if(read())return;await act(async()=>{await pause();});}throw Error(message);}
export async function testEntityCandidateDismissalReactivity():Promise<string[]>{
 const projectId='qa-durable-reactivity', documentId='qa-durable-shared', source='Nora met Rowan at Castle Blackthorn.';
 const spans:EntitySpan[]=['Nora','Rowan','Castle Blackthorn'].map(text=>({from:source.indexOf(text),to:source.indexOf(text)+text.length,text,label:'PER',score:.99}));
 const original=window.electronAPI, previousLocale=useLocaleStore.getState().locale;useLocaleStore.setState({locale:'es'});
 let delay=false;const pending:Array<(spans:EntitySpan[])=>void>=[];let edits=0;
 Object.defineProperty(window,'electronAPI',{configurable:true,value:{entityDetection:{status:async()=>({state:'ready',model:'controlled-reactivity-no-model'}),detect:async()=>delay?new Promise<EntitySpan[]>(resolve=>pending.push(resolve)):spans}}});
 await db.projects.put({id:projectId,title:'Shared',mode:'custom',type:'standalone',description:'',status:'draft',color:'#777777',enabledEngines:['codex','writings'],engineOrder:['writings','codex'],createdAt:1,updatedAt:1,entityDetectionPreferences:{revision:1,detectNewEntities:true,autoLinkMentions:true,animateNewLinks:false}});
 for(const id of [documentId,'qa-durable-other'])await db.writings.put({id,projectId,title:id,content:'<p>'+source+'</p>',status:'draft',wordCount:7,tags:[],createdAt:1,updatedAt:1});
 const root=createRoot(document.getElementById('root')!);const render=async(firstDocument=documentId)=>{await act(async()=>{root.render(<MemoryRouter>{[firstDocument,documentId,'qa-durable-other'].map((id,index)=><section key={index} data-pane={index}><TiptapEditor content={'<p>'+source+'</p>'} onChange={()=>{edits++;}} copilotIdentity={{projectId,objectId:id,kind:'writings'}} entityCandidateContext={{kind:'writings',documentId:id}} /></section>)}</MemoryRouter>);await pause();});for(const node of document.querySelectorAll<HTMLDetailsElement>('details'))node.open=true;};
 const pane=(index:number)=>document.querySelector<HTMLElement>('[data-pane="'+index+'"]')!;
 const visible=(index:number)=>[...pane(index).querySelectorAll('.wh-entity-panel li > span')].map(node=>node.textContent).join('|');
 const button=(index:number,label:string)=>[...pane(index).querySelectorAll<HTMLButtonElement>('button')].find(node=>(node.getAttribute('aria-label')??node.textContent??'').trim()===label)!;
 try{
  await render();await until(()=>[0,1,2].every(index=>visible(index)==='Nora|Rowan|Castle Blackthorn'),'three positive real-editor baselines');
  delay=true;await act(async()=>{button(0,'Analizar documento').click();await pause();});check(pending.length===1,'one delayed inference captured');
  const scope={projectId,context:{kind:'writings' as const,documentId}};
  const result=await decide(scope,{action:'dismiss',text:source,candidate:spans[0],expectedVersion:''});
  await until(()=>visible(0)==='Rowan|Castle Blackthorn'&&visible(1)==='Rowan|Castle Blackthorn','both same-owner panes react to DB commit');check(visible(2)==='Nora|Rowan|Castle Blackthorn','other owner untouched');
  await act(async()=>{pending.shift()!(spans);await pause();});check(visible(0)==='Rowan|Castle Blackthorn','late inference cannot revive dismissed Nora');
  await decide(scope,{action:'undo',receiptId:result.receiptId!});await until(()=>visible(0).startsWith('Nora|')&&visible(1).startsWith('Nora|'),'MCP/service Undo reactive in both panes');
  await act(async()=>{button(0,'Analizar documento').click();await pause();});check(pending.length===1,'second old source inference captured');
  await render('qa-durable-other');await render(documentId);
  await act(async()=>{pending.shift()!([spans[1]]);await pause();});check(visible(0)==='','A to B to A rejects earlier inference even when binding string returns');
  delay=false;await until(()=>visible(0)==='Nora|Rowan|Castle Blackthorn','current binding rescans successfully');
  check(edits===0,'no prose writes in any mounted editor');
  check((await db.writings.get(documentId))!.content==='<p>'+source+'</p>','source bytes exact');
  return ['Two real editor panes share committed per-owner metadata, another owner stays isolated; delayed inference cannot revive dismissed names; A-B-A token guard rejects old results; exact prose and no onChange'];
 }finally{await act(async()=>root.unmount());Object.defineProperty(window,'electronAPI',{configurable:true,value:original});useLocaleStore.setState({locale:previousLocale});}
}
