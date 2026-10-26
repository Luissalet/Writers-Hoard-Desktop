import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {useLocaleStore} from '@/stores/localeStore';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import type {Timeline,TimelineEvent} from '@/types';
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,60));
async function until(read:()=>boolean,message:string){for(let i=0;i<100;i++){if(read())return;await act(async()=>{await pause();});}throw Error(message);}
export async function testTimelineFit(){
 const P='qa-timeline-fit',root=createRoot(document.getElementById('root')!);let writes=0,width=900,visible=true;
 const lines:Timeline[]=[0,1].map(i=>({id:P+'-lane'+i,projectId:P,title:'Own lane '+i,color:'#777777',displayPrecision:'year',yearRange:{start:1500,end:1900},createdAt:1,updatedAt:1}));
 const events:TimelineEvent[]=Array.from({length:64},(_,index)=>({id:P+'-event'+index,projectId:P,timelineId:lines[index%2].id,title:'Own event '+index,description:'Exact prose '+index,date:'Year '+(1500+index),dateMode:'calendar',realDate:(1500+index)+'-01-10',order:index,lane:'',color:'#777777',createdAt:1,updatedAt:1}));
 const noWrite=()=>{writes++;};
 const render=async()=>{await act(async()=>{root.render(<MemoryRouter><style>{'#timeline-fit-fixture .overflow-auto{overflow:auto} #timeline-fit-fixture{min-width:0}'}</style><div id="timeline-fit-fixture" style={{width,display:visible?'block':'none'}}><EnginePaneContext.Provider value={{projectId:P,instanceId:P,visible}}><SwimLaneView projectId={P} timelines={lines} events={events} connections={[]} onAddEvent={noWrite} onEditEvent={noWrite} onDeleteEvent={noWrite} onAddConnection={noWrite} onEditConnection={noWrite} onDeleteConnection={noWrite} onEditTimeline={noWrite}/></EnginePaneContext.Provider></div></MemoryRouter>);await pause();});};
 const svg=()=>document.querySelector<SVGSVGElement>('svg.select-none')!,canvas=()=>svg().parentElement!,button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>(node.getAttribute('aria-label')??node.title??node.textContent)==label);
 const raw=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
 const inside=()=>svg().getBoundingClientRect().right<=canvas().getBoundingClientRect().right+2&&canvas().scrollLeft===0;
 useLocaleStore.setState({locale:'en',loaded:true});
 try{
  await db.projects.add({id:P,title:'Own fit fixture',description:'Synthetic',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],engineOrder:['timeline'],createdAt:1,updatedAt:1});await db.timelines.bulkAdd(lines);await db.timelineEvents.bulkAdd(events);const before=await raw();
  await render();check(svg()&&canvas().clientWidth>0,'Positive baseline: real measurable SVG');check(svg().getBoundingClientRect().width>canvas().clientWidth,'Positive baseline: enough unique slots overflow viewport');
  const zoomIn=button('Zoom in');check(zoomIn,'Positive baseline: incumbent zoom control');const oldWidth=svg().getBoundingClientRect().width;await act(async()=>{zoomIn!.click();await pause();});check(svg().getBoundingClientRect().width>oldWidth,'Positive baseline: normal zoom must actually change SVG width');canvas().scrollLeft=400;check(canvas().scrollLeft>0,'Positive baseline: scroll can be moved');check(await raw()===before&&writes===0,'Positive baseline: viewport writes authored data');
  const fit=button('Fit timeline to view');check(fit,'TIMELINE_FIT_CONTROL_MISSING_AFTER_POSITIVE_ZOOM_BASELINE');
  await act(async()=>{fit!.click();await pause();});await until(inside,'Fit must frame real SVG and reset horizontal scroll');
  width=320;await render();await until(inside,'Active Fit must recompute after real narrow resize');check(svg().getBoundingClientRect().width<=320,'Fit below30% must fit many slots');
  const scale=()=>Number(svg().getAttribute('width'))/Number(svg().viewBox.baseVal.width),beforeManual=scale();await act(async()=>{button('Zoom in')!.click();await pause();});check(scale()>beforeManual,'Manual zoom leaves Fit');const manual=scale();width=640;await render();check(Math.abs(scale()-manual)<.000001,'Resize must preserve manual zoom');
  const get=await runBridgeTool('wh_timeline_view_get',{projectId:P});check(get.ok,'Registered normal bridge getter missing');const targets=(get.result as {targets:Array<{hostId:string}>}).targets;check(targets.length===1,'Exactly one live host expected');
  const reply=await runBridgeTool('wh_timeline_view_fit',{projectId:P,hostId:targets[0].hostId});check(reply.ok&&(reply.result as {available:boolean}).available,'Bridge must call real mounted host');await until(inside,'Bridge Fit must affect rendered SVG');
  visible=false;await render();const hidden=await runBridgeTool('wh_timeline_view_fit',{projectId:P,hostId:targets[0].hostId});check(hidden.ok&&!(hidden.result as {available:boolean}).available,'Hidden host unavailable, no queued Fit');
  visible=true;await render();await act(async()=>{button('Zoom in')!.click();await pause();});const fresh=scale();await pause();check(scale()===fresh,'Unavailable command must not be queued');
  check(await raw()===before&&writes===0,'Fit/resize/bridge must leave every authored row, field, date, range and precision exact');return ['Actual SVG width Fit + scroll reset + narrow resize below30%; manual leaves Fit; normal bridge targets actual host, hidden unavailable/no queue; all DB bytes/settings unchanged'];
 }finally{await act(async()=>root.unmount());await deleteProject(P);}
}
