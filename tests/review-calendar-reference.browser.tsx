import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import CalendarView from '@/engines/timeline/components/CalendarView';
import EventDetailsFields from '@/engines/timeline/components/EventDetailsFields';
import { emptyEventDetails } from '@/engines/timeline/eventDetails';
import { earthCalendar } from '@/engines/timeline/calendarPresets';
import { calendarMonth } from '@/engines/timeline/calendarGrid';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { TimelineEvent } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
const P='qa-calendar-reference',T='qa-calendar-reference-t';
export async function reviewCalendarReference():Promise<string[]>{
 const passed:string[]=[],root=createRoot(document.getElementById('root')!),captured:TimelineEvent[]=[];useLocaleStore.setState({locale:'en'});
 try{
 await db.projects.put({id:P,title:'Calendar QA',description:'',mode:'custom',type:'standalone',color:'#888888',status:'draft',enabledEngines:['timeline'],createdAt:1,updatedAt:1});await db.timelines.put({id:T,projectId:P,title:'Harbour',color:'#c4973b',createdAt:1,updatedAt:1});
 const made=await runBridgeTool('wh_create_event',{projectId:P,timelineId:T,title:'Arrival at the harbour',dateMode:'calendar',realDate:'1500-01-10',realDateEnd:'1500-01-12',eventType:'range',repeat:{every:'week'},bannerPattern:'solid'});assert(made.ok,JSON.stringify(made));
 const stored=(await db.timelineEvents.where('projectId').equals(P).toArray())[0];assert(stored.realDate==='1500-01-10'&&stored.realDateEnd==='1500-01-12'&&stored.repeat?.every==='week','Normal MCP lost range/repeat');
 const cal=earthCalendar('en'),january=calendarMonth(cal,'earth',1500,1,[stored]),february=calendarMonth(cal,'earth',1500,2,[stored]);
 assert(january.days.filter(day=>day.events.length).map(day=>day.day).join(',')==='10,11,12,17,18,19,24,25,26,31','January differs from observed reference coverage');assert(february.days.slice(0,2).every(day=>day.events.some(row=>row.id===stored.id))&&!february.days[2].events.length,'January31 occurrence lost February1–2 or overran');
 passed.push('Registered MCP and pure calendar match January1500 weekly three-day coverage10–12/17–19/24–26/31 and carry into February1–2');
 await act(async()=>{root.render(<CalendarView events={[stored]} timelines={await db.timelines.where('projectId').equals(P).toArray()} worldCalendar={null} onAddEvent={event=>{captured.push(event);}}/>);await pause();});
 const covered=[...document.querySelectorAll<HTMLElement>('[data-testid^="calendar-day-"]')].filter(day=>day.querySelector('[data-testid="calendar-event"]')).map(day=>day.dataset.testid?.replace('calendar-day-','')).join(',');assert(covered==='10,11,12,17,18,19,24,25,26,31',`Rendered coverage ${covered}`);assert(document.querySelector('[data-testid="calendar-day-10"] [data-banner="start"]')&&document.querySelector('[data-testid="calendar-day-11"] [data-banner="middle"]')&&document.querySelector('[data-testid="calendar-day-12"] [data-banner="end"]'),'Rendered range endpoints differ');
 await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid="calendar-day-10"]')!.click();await pause();});assert(!document.querySelector('[data-testid="calendar-day-detail"] [data-testid="event-repeat"]'),'Calendar quick-add unexpectedly includes full repeat form');
 const title=document.querySelector<HTMLInputElement>('[data-testid="calendar-new-title"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title,'Quick point QA');title.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid="calendar-new"]')!.click();await pause();});assert(captured.length===1&&captured[0].realDate==='1500-01-10'&&!captured[0].realDateEnd&&!captured[0].repeat&&captured[0].eventType==='point','Quick-add contract differs');
 passed.push('Actual CalendarView renders all observed weekly bands; day quick-add emits a dated one-day point with no end/repeat and has no full-event controls');
 function Fields(){const [value,setValue]=useState(emptyEventDetails());return <EventDetailsFields value={value} onChange={setValue} entries={[]} mode="calendar"/>;}
 await act(async()=>{root.render(<MemoryRouter><Fields/></MemoryRouter>);await pause();});const repeat=[...document.querySelectorAll<HTMLOptionElement>('[data-testid="event-repeat"] option')].map(row=>row.value),patterns=[...document.querySelectorAll<HTMLOptionElement>('[data-testid="event-banner-pattern"] option')].map(row=>row.value);assert(repeat.join(',')===',year,month,week','Existing form missing documented repeat frequency');assert(patterns.join(',')===',stripes,dots,checks,crosshatch,grid,image','Pattern inventory must include the four legacy fills and Crosshatch/Grid/Image');
 const ribbon=await runBridgeTool('wh_update_event',{id:stored.id,bannerPattern:'ribbon'});assert(!ribbon.ok&&ribbon.code==='bad-args'&&ribbon.error?.includes('bannerPattern'),'Ribbon rejection did not come from the actual pattern contract');
 passed.push('Actual event detail fields already offer Never/Yearly/Monthly/Weekly; Writer exposes solid/stripes/dots/checks, and native MCP does not accept Ribbon as an equivalent shape');
 await act(async()=>{root.render(<MemoryRouter key="deep-link" initialEntries={[`/project/${P}/timeline?view=list&entity=${stored.id}`]}><TimelineEngine projectId={P}/></MemoryRouter>);await pause();});for(let attempt=0;attempt<35&&!document.querySelector('[data-testid="event-repeat"]');attempt++)await act(async()=>{await pause();});assert(document.querySelector<HTMLSelectElement>('[data-testid="event-repeat"]')?.value==='week'&&[...document.querySelectorAll<HTMLInputElement>('input[type="date"]')].some(row=>row.value==='1500-01-12'),'Existing normal entity deep link did not open the saved event/range/repeat editor');
 passed.push('Normal TimelineEngine list/entity deep link opens the existing saved-event editor with its end date and weekly frequency; no duplicate editor is needed');
 }finally{await act(async()=>root.unmount());for(const table of db.tables)if(table.name!=='projects'&&table.schema.idxByName.projectId)await table.where('projectId').equals(P).delete();await db.projects.delete(P);}
 return passed;
}


export async function reviewCalendarDateEdit():Promise<string[]>{
 const root=createRoot(document.getElementById('root')!),id='qa-calendar-edit-point';useLocaleStore.setState({locale:'en'});
 try{await db.projects.put({id:P,title:'Calendar edit QA',description:'',mode:'custom',type:'standalone',color:'#888888',status:'draft',enabledEngines:['timeline'],createdAt:1,updatedAt:1});await db.timelines.put({id:T,projectId:P,title:'Harbour',color:'#c4973b',createdAt:1,updatedAt:1});await db.timelineEvents.put({id,projectId:P,timelineId:T,title:'Point to edit',date:'10 January1500',dateMode:'calendar',realDate:'1500-01-10',eventType:'point',description:'',lane:'Main',color:'#c4973b',order:0,createdAt:1,updatedAt:1});
 const render=async(key:string)=>{await act(async()=>{root.render(<MemoryRouter key={key} initialEntries={[`/project/${P}/timeline?view=list&entity=${id}`]}><TimelineEngine projectId={P}/></MemoryRouter>);await pause();});for(let attempt=0;attempt<35&&document.querySelectorAll('input[type="date"]').length<2;attempt++)await act(async()=>{await pause();});};
 await render('initial-date-edit');const end=document.querySelectorAll<HTMLInputElement>('input[type="date"]')[1];assert(end&&end.value==='','Editor did not start as a point');
 await act(async()=>{end.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(end,'1500-01-12');end.dispatchEvent(new Event('input',{bubbles:true}));end.dispatchEvent(new Event('change',{bubbles:true}));end.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));await pause();});
 assert(end.value==='1500-01-12','Native setter did not change DOM date');const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent?.trim()==='Save');assert(save&&!save.disabled,'Actual Save unavailable');await act(async()=>{save.click();await pause();});for(let attempt=0;attempt<25&&(await db.timelineEvents.get(id))?.realDateEnd!=='1500-01-12';attempt++)await act(async()=>{await pause();});
 const stored=(await db.timelineEvents.get(id))!;assert(stored.realDateEnd==='1500-01-12'&&stored.eventType==='range',`Date edit was not saved: ${JSON.stringify(stored)}`);const reply=await runBridgeTool('wh_list_events',{projectId:P,timelineId:T});assert(reply.ok&&JSON.stringify(reply.result).includes('1500-01-12'),'MCP readback lost saved end date');await render('reopen-date-edit');assert(document.querySelectorAll<HTMLInputElement>('input[type="date"]')[1]?.value==='1500-01-12','Reopen did not keep end date');
 return ['Actual TimelineEngine/TimelineView point editor native setter+input/change/blur then Save persists January10–12 as range; MCP and reopened form agree'];
 }finally{await act(async()=>root.unmount());for(const table of db.tables)if(table.name!=='projects'&&table.schema.idxByName.projectId)await table.where('projectId').equals(P).delete();await db.projects.delete(P);}}
