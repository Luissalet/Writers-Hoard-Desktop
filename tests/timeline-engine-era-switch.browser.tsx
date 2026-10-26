import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {readWorldDocument,saveEraDocument,readEraRow} from '@/services/worldEras/store';
import {defaultWorldCalendar} from '@/engines/timeline/worldCalendar';
import {useLocaleStore} from '@/stores/localeStore';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import type {Timeline} from '@/types';
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
async function wait(read:()=>boolean,message:string){for(let i=0;i<80;i++){if(read())return;await act(async()=>{await pause();});}throw Error(message);}
export async function testTimelineEngineEraSwitch(){
 const P='qa-timeline-engine-switch-'+crypto.randomUUID(),T=P+'-line',root=createRoot(document.getElementById('root')!);let eraId:string|undefined;
 const render=async()=>{await act(async()=>{root.render(<MemoryRouter><textarea aria-label="Other pane pending draft" defaultValue="Own pending draft kept exact"/><EnginePaneContext.Provider value={{projectId:P,eraId,instanceId:P,visible:true}}><div key={`${P}:${eraId??'base'}`}><TimelineEngine projectId={P}/></div></EnginePaneContext.Provider></MemoryRouter>);await pause();});};
 const raw=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
 const note=()=>document.querySelector('[data-testid="timeline-range-note"]')?.textContent??'';
 const targets=async()=>{const reply=await runBridgeTool('wh_timeline_view_get',{projectId:P,...(eraId?{eraId}:{})});check(reply.ok,JSON.stringify(reply));return(reply.result as {targets:{hostId:string}[]}).targets;};
 const inspectSettings=async(precision:string,start:string)=>{await wait(()=>!!document.querySelector('[data-testid="timeline-settings-open"]'),'Normal timeline settings missing');await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid="timeline-settings-open"]')!.click();await pause();});await wait(()=>!!document.querySelector('[data-testid="world-calendar-editor"] select'),'Normal settings fields missing');const editor=document.querySelector('[data-testid="world-calendar-editor"]')!;check([...editor.querySelectorAll('select')].some(select=>select.value===precision),'Normal settings precision not '+precision);check([...editor.querySelectorAll<HTMLInputElement>('input[type="number"]')].some(input=>input.value===start),'Normal settings range not '+start);const cancel=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Cancel');check(cancel,'Normal settings Cancel missing');await act(async()=>{cancel!.click();await pause();});};
 useLocaleStore.setState({locale:'en',loaded:true});
 try{
  await db.projects.add({id:P,title:'Own Timeline engine scope switch',description:'Synthetic only',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],engineOrder:['timeline'],createdAt:1,updatedAt:1,worldCalendar:defaultWorldCalendar(),worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});
  await db.timelines.add({id:T,projectId:P,title:'Own range',color:'#777777',yearRange:{start:1500,end:1900},displayPrecision:'year',createdAt:1,updatedAt:1});
  await db.timelineEvents.bulkAdd([1500,1515,1519].map((year,order)=>({id:P+'-'+year,projectId:P,timelineId:T,title:'Base event '+year,description:'Exact prose',date:'Year '+year,dateMode:'world' as const,worldDate:{year,month:1,day:1},order,lane:'',color:'#777777',createdAt:1,updatedAt:1})));
  const scope={projectId:P,eraId:'past'},current=(await readWorldDocument(scope,'timeline',T))!;
  await saveEraDocument(scope,'timeline',{...current.document,root:{...current.document.root,yearRange:{start:1510,end:1525},displayPrecision:'month'},children:{...current.document.children,timelineEvents:current.document.children.timelineEvents.map((event:Record<string,unknown>)=>({...event,title:String(event.title).replace('Base','Era')}))}},current.version);
  const before=await raw();await render();await wait(()=>note().includes('1500')&&note().includes('1900'),'Positive Base range DOM missing');const draft=document.querySelector('textarea')!,baseHost=(await targets())[0];check(baseHost,'Positive real Base viewport host missing');check(document.querySelector('svg.select-none')?.textContent?.includes('Base event 1500'),'Positive normal engine Base events missing');await inspectSettings('year','1500');
  eraId='past';await render();const effective=await readEraRow<Timeline>(scope,'timelines',T);check(effective?.yearRange?.start===1510&&effective.displayPrecision==='month','Positive authored era differs from Base');
  await wait(()=>note().includes('1510')&&note().includes('1525'),'TIMELINE_ENGINE_ERA_SWITCH_STALE_ROWS DOM='+note());
  await inspectSettings('month','1510');
  check(!document.querySelector('svg.select-none')?.textContent?.includes('Base event'),'Base event rows survived era switch');check(document.querySelector('svg.select-none')?.textContent?.includes('Era event 1515'),'Era event rows not loaded');check(!document.querySelector('svg.select-none')?.textContent?.includes('Era event 1500'),'Out of era range event remained visible');check((await targets())[0]?.hostId!==baseHost.hostId,'Scope switch reused Base viewport host');
  check(document.querySelector('textarea')===draft&&draft.value==='Own pending draft kept exact','Scope boundary remounted an unrelated draft');
  eraId=undefined;await render();await wait(()=>note().includes('1500')&&note().includes('1900'),'Back to Base range did not refresh');check(document.querySelector('svg.select-none')?.textContent?.includes('Base event 1500'),'Back to Base events did not refresh');check(document.querySelector('textarea')===draft,'Return to Base remounted unrelated draft');check(await raw()===before,'Scope navigation changed author bytes');
  const baseBefore=JSON.stringify({project:await db.projects.get(P),timeline:await db.timelines.get(T),events:await db.timelineEvents.where('projectId').equals(P).toArray()}),eraBefore=await readWorldDocument(scope,'timeline',T);
  eraId='past';await render();await wait(()=>note().includes('1510')&&note().includes('1525'),'Era range missing before normal All years');await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid="timeline-range-note"] button')!.click();await pause();});await wait(()=>!document.querySelector('[data-testid="timeline-range-note"]')&&!!document.querySelector('svg.select-none')?.textContent?.includes('Era event 1500'),'Normal era All years did not refresh visible rows');const eraAfter=await readWorldDocument(scope,'timeline',T);check(eraAfter?.document.root.yearRange===undefined&&eraAfter?.document.root.displayPrecision==='month','Normal era All years lost precision or kept range');check(JSON.stringify(eraAfter?.document.children)===JSON.stringify(eraBefore?.document.children),'Normal All years changed era event prose');check(JSON.stringify({project:await db.projects.get(P),timeline:await db.timelines.get(T),events:await db.timelineEvents.where('projectId').equals(P).toArray()})===baseBefore,'Normal era All years changed Base/Project/events');check(document.querySelector('textarea')===draft&&draft.value==='Own pending draft kept exact','Normal All years changed sibling draft');
  return ['Host-equivalent boundary: normal TimelineEngine Base→era→Base refreshes DOM range/precision/events and host; sibling draft node/value and author bytes exact','Normal settings reflect own Base/era precision; normal era All years updates visible event range with only scoped metadata delta and Base/Project/events exact'];
 }finally{await act(async()=>root.unmount());await deleteProject(P);}
}
