import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import TimelineView from '@/engines/timeline/components/TimelineView';
import {readWorldDocument,saveEraDocument,readEraRow,listEraRows} from '@/services/worldEras/store';
import {defaultWorldCalendar} from '@/engines/timeline/worldCalendar';
import {useLocaleStore} from '@/stores/localeStore';
import type {Timeline,TimelineEvent} from '@/types';
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
async function oracle(mode:'swim'|'list'){
 const P='qa-all-years-era-'+mode,E='past',T=P+'-target',root=createRoot(document.getElementById('root')!),scope={projectId:P,eraId:E},passed:string[]=[];
 const line:Timeline={id:T,projectId:P,title:'Exact era range',color:'#777777',yearRange:{start:1,end:10},displayPrecision:'month',createdAt:1,updatedAt:1};
 const rows:TimelineEvent[]=[5,25,40].map((year,index)=>({id:P+'-'+year,projectId:P,timelineId:T,title:'Event '+year,description:'Exact prose '+year,date:'Year '+year,dateMode:'world',worldDate:{year,month:1,day:1},order:index,lane:'',color:'#777777',createdAt:1,updatedAt:1}));
 useLocaleStore.setState({locale:'en',loaded:true});
 try{
  await db.projects.add({id:P,title:'Own era All years',description:'Synthetic',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],engineOrder:['timeline'],createdAt:1,updatedAt:1,worldCalendar:defaultWorldCalendar(),worldEras:[{id:E,name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});
  await db.timelines.bulkAdd([line,{...line,id:P+'-sibling',title:'Kept sibling'}]);await db.timelineEvents.bulkAdd(rows);
  const base=(await readWorldDocument(scope,'timeline',T))!;
  await saveEraDocument(scope,'timeline',{...base.document,root:{...base.document.root,yearRange:{start:20,end:30},displayPrecision:'year'}},base.version);
  const effective=(await readEraRow<Timeline>(scope,'timelines',T))!,events=(await listEraRows<TimelineEvent>(scope,'timelineEvents')).filter(row=>row.timelineId===T);
  const before={base:await db.timelines.get(T),project:await db.projects.get(P),sibling:await db.timelines.get(P+'-sibling'),events:await db.timelineEvents.toArray()};
  const noWrite=()=>{throw Error('All years must use normal scoped settings, not event callbacks');};
  await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{projectId:P,eraId:E,instanceId:P,visible:true}}>{mode==='swim'?<SwimLaneView projectId={P} timelines={[effective]} events={events} connections={[]} onAddEvent={noWrite} onEditEvent={noWrite} onDeleteEvent={noWrite} onAddConnection={noWrite} onEditConnection={noWrite} onDeleteConnection={noWrite} onEditTimeline={noWrite}/>:<TimelineView projectId={P} timelineId={T} events={events} onAddEvent={noWrite} onEditEvent={noWrite} onDeleteEvent={noWrite}/>}</EnginePaneContext.Provider></MemoryRouter>);await pause();});
  for(let i=0;i<40&&!document.querySelector('[data-testid="timeline-range-note"]');i++)await act(async()=>{await pause();});
  const note=document.querySelector('[data-testid="timeline-range-note"]');check(note?.textContent?.includes('20')&&note.textContent.includes('30'),'Positive baseline: effective era range20–30 note missing');
  const button=note?.querySelector<HTMLButtonElement>('button');check(button,'Positive baseline: normal All years control missing');
  check(JSON.stringify((await db.timelines.get(T))?.yearRange)==='{"start":1,"end":10}','Positive baseline: Base must differ from own era');
  await act(async()=>{button!.click();await pause();});
  const actualBase=await db.timelines.get(T);
  check(JSON.stringify(actualBase)===JSON.stringify(before.base),'TIMELINE_ALL_YEARS_BASE_MUTATION '+mode+': normal era All years changed Base; actual='+JSON.stringify(actualBase));
  const after=(await readEraRow<Timeline>(scope,'timelines',T))!;check(after.yearRange===undefined&&after.displayPrecision==='year','Era range was not cleared independently while preserving precision');
  check(JSON.stringify(await db.projects.get(P))===JSON.stringify(before.project),'Era settings changed shared Project');check(JSON.stringify(await db.timelines.get(P+'-sibling'))===JSON.stringify(before.sibling),'Sibling timeline changed');check(JSON.stringify(await db.timelineEvents.toArray())===JSON.stringify(before.events),'Authored events changed');
  passed.push('Normal '+mode+' All years targets actual own era only; Base/Project/sibling/events exact, local precision retained');return passed;
 }finally{await act(async()=>root.unmount());await deleteProject(P);}
}
export const testTimelineAllYearsSwimEra=()=>oracle('swim');
export const testTimelineAllYearsListEra=()=>oracle('list');
