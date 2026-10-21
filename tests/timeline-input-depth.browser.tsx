import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import {useLocaleStore} from '@/stores/localeStore';
import type {Timeline,TimelineEvent} from '@/types';
const qa=window as any;let seq=0;
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const pause=()=>new Promise(r=>setTimeout(r,40));
async function wait(f:()=>boolean){for(let i=0;i<200;i++){if(f())return;await pause();}throw Error('Timeline input timeout');}
async function native(events:unknown[]){const n=++seq;await act(async()=>{qa.__native={n,events};await wait(()=>qa.__nativeAck===n);await pause();});}
export async function testTimelineInputDepth(){
 const P=`timeline-input-${Date.now()}`,line:Timeline={id:`${P}-line`,projectId:P,title:'Expedition',color:'#c4973b',createdAt:1,updatedAt:1};
 const events:TimelineEvent[]=Array.from({length:24},(_,i)=>({id:`${P}-${i}`,projectId:P,timelineId:line.id,title:`Stop${i}`,description:'Authored event',date:`Year${i}`,dateMode:'text',eventType:'point',lane:'Expedition',order:i,color:'#c4973b',createdAt:1,updatedAt:1}));
 const root=createRoot(document.getElementById('root')!),passed:string[]=[],observed:{ctrl:boolean;prevented:boolean;deltaY:number}[]=[];
 const wheel=(event:WheelEvent)=>{queueMicrotask(()=>observed.push({ctrl:event.ctrlKey,prevented:event.defaultPrevented,deltaY:event.deltaY}));};window.addEventListener('wheel',wheel,{passive:true});
 try{
  useLocaleStore.setState({locale:'en'});await db.projects.put({id:P,title:'Synthetic timeline',type:'standalone',mode:'custom',enabledEngines:['timeline'],createdAt:1,updatedAt:1});await db.timelines.put(line);await db.timelineEvents.bulkPut(events);const canonical=JSON.stringify(await db.timelineEvents.where('projectId').equals(P).toArray());
  for(const width of [1440,640]){
   const n=++seq;await act(async()=>{qa.__want={w:width,h:1000,n};await wait(()=>qa.__sizeAck===n);root.render(<MemoryRouter><main className="bg-deep p-4 text-text-primary"><SwimLaneView key={width} projectId={P} timelines={[line]} events={events} connections={[]} onAddEvent={async()=>{}} onEditEvent={async()=>{}} onDeleteEvent={async()=>{}} onAddConnection={async()=>{}} onEditConnection={async()=>{}} onDeleteConnection={async()=>{}} onEditTimeline={async()=>{}}/></main></MemoryRouter>);await pause();});
   const svg=document.querySelector<SVGSVGElement>('svg.select-none')!;check(svg,'No normal timeline canvas');const container=svg.parentElement!,rect=container.getBoundingClientRect(),x=Math.round(rect.x+Math.min(150,rect.width/2)),y=Math.round(rect.y+50);
   check(container.scrollWidth>container.clientWidth,'Fixture is not horizontally scrollable');const oldLeft=container.scrollLeft;
   await native([{type:'mouseMove',x,y},{type:'mouseWheel',x,y,deltaX:-250,deltaY:0,canScroll:true}]);await act(async()=>{await pause();});check(container.scrollLeft!==oldLeft,'Ordinary native horizontal wheel did not scroll the timeline');
   const zoom=()=>[...document.querySelectorAll('span')].find(node=>/^\d+%$/.test(node.textContent??''))?.textContent;
   const before=zoom(),inner=innerWidth,ratio=devicePixelRatio;observed.length=0;
   await native([{type:'mouseMove',x,y},{type:'mouseWheel',x,y,deltaX:0,deltaY:100,modifiers:['control'],canScroll:true}]);await act(async()=>{await pause();});
   check(zoom()!==before,`Ctrl+wheel did not zoom canvas:${zoom()},events:${JSON.stringify(observed)},inner:${innerWidth}/${inner},ratio:${devicePixelRatio}/${ratio}`);const handled=observed.find(row=>row.ctrl);check(handled,'No actual Ctrl wheel reached the canvas');check(handled.prevented,'Ctrl+wheel changed canvas zoom but did not prevent its browser default');check(innerWidth===inner&&devicePixelRatio===ratio,'Ctrl+wheel also changed browser zoom');
   const button=document.querySelector<HTMLButtonElement>('button[title="Zoom in"]')!;check(button,'Missing keyboard zoom action');button.focus();const current=zoom();await native([{type:'keyDown',keyCode:'Enter'},{type:'char',keyCode:'Enter'},{type:'keyUp',keyCode:'Enter'}]);check(zoom()!==current,'Keyboard zoom action failed');
   const shot=`timeline-wheel-${width}`;qa.__shot={name:shot,forcePaint:true};await wait(()=>qa.__shotDone===shot);check(JSON.stringify(await db.timelineEvents.where('projectId').equals(P).toArray())===canonical,'Viewport input changed authored rows');
   passed.push(`Native${width}: horizontal wheel scroll, Ctrl wheel zoom consumes default, browser scale unchanged and keyboard button zoom; authored rows exact`);
  }
  return passed;
 }finally{window.removeEventListener('wheel',wheel);await act(async()=>root.unmount());await deleteProject(P);}
}
