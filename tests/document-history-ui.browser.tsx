import { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import { useLocaleStore } from '@/stores/localeStore';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
const click=async(node:Element|null)=>{assert(node,'Missing control');await act(async()=>{(node as HTMLElement).click();await pause();});};
const resize=async(w:number,h:number)=>{const n=Date.now();Object.assign(window,{__want:{w,h,n}});while((window as unknown as {__sizeAck:number}).__sizeAck!==n)await pause();};
const shot=async(name:string)=>{Object.assign(window,{__shot:{name}});while((window as unknown as {__shotDone:string}).__shotDone!==name)await pause();};
export async function testDocumentHistoryUi():Promise<string[]> {
 const P='synthetic-history-ui',project:Project={id:P,title:'Synthetic library',description:'',mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1};
 useLocaleStore.setState({locale:'en'});await db.projects.put(project);await db.codexEntries.put({id:'history-ui-card',projectId:P,title:'Harbor of the first age',content:'Original harbor prose.',fields:{population:'120'},type:'location',tags:[],relations:[],createdAt:1,updatedAt:1});await db.codexEntries.update('history-ui-card',{title:'Harbor rebuilt',content:'Rebuilt harbor prose.'});
 const host=document.getElementById('root')!,root=createRoot(host);try{
  await resize(1440,900);await act(async()=>{root.render(<WorkspaceLibrary projectId={P} enabledEngineIds={['codex']} onOpen={async()=>true} onManage={async()=>true}/>);await pause();});await act(async()=>{await pause(250);});
  const originalCount=await db.documentHistory.where('projectId').equals(P).count();
  await click(host.querySelector('[data-library-history]'));await act(async()=>{await pause();});assert(host.querySelector('[data-testid="document-history-panel"]'),'Library history absent');
  await click(host.querySelector('[data-history-version]'));assert(host.querySelector('[data-testid="history-preview"]')?.textContent?.includes('Original harbor prose.'),'Selected version not previewed');assert(await db.documentHistory.where('projectId').equals(P).count()===originalCount,'UI reading creates history');
  await shot('history-desktop');
  for(const width of [1440,640]){await resize(width,900);assert(document.documentElement.scrollWidth<=innerWidth+1,'History overflows window');const controls=host.querySelectorAll<HTMLButtonElement>('[data-testid="document-history-panel"] button');assert([...controls].filter(button=>button.getBoundingClientRect().width).every(button=>button.getBoundingClientRect().height>=36),'History targets too small');}
  await shot('history-narrow');
  await click(host.querySelector('[data-testid="history-restore"]'));assert((await db.codexEntries.get('history-ui-card'))?.content==='Original harbor prose.','UI restore failed');await click(host.querySelector('[data-testid="history-undo"]'));assert((await db.codexEntries.get('history-ui-card'))?.content==='Rebuilt harbor prose.','UI Undo failed');
  await act(async()=>{await pause(250);});await click(host.querySelector('[data-testid="history-save"]'));assert(host.textContent?.includes('Current state retained.'),`Manual UI save failed: ${host.querySelector('[role=alert]')?.textContent??host.querySelector('[role=status]')?.textContent}`);
  await act(async()=>{await db.codexEntries.update('history-ui-card',{content:'New concurrent prose.'});await pause();});assert(host.querySelectorAll('[data-history-version]').length>originalCount,'Committed middleware version did not refresh normal UI');
  await click(host.querySelector('[aria-label="Close history"]'));assert(!host.querySelector('[data-testid="document-history-panel"]'),'Close lifecycle failed');await click(host.querySelector('[data-testid="library-history"]'));assert(host.textContent?.includes('Harbor rebuilt'),'Project history index missing');
  return ['Normal Library workflow previews, restores, undoes and manually retains a Base card; external committed edits refresh its history','Real product CSS at1440/640 has no horizontal overflow, usable controls and clean open/close lifecycle'];
 }finally{await act(async()=>{root.unmount();});await deleteProject(P);}
}
