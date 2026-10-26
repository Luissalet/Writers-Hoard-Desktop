import {act,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import {useLocaleStore} from '@/stores/localeStore';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {defineLocalTool,type LocalToolClient,type LocalToolProps} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import type {Timeline,TimelineEvent} from '@/types';
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
async function wait(read:()=>boolean,message:string){for(let i=0;i<100;i++){if(read())return;await act(async()=>{await pause();});}throw Error(message);}
function Notes({client}:LocalToolProps<{notes:string}>){const [draft,setDraft]=useState('Unsaved independent Source notes'),[saved,setSaved]=useState('');useEffect(()=>{void client.read().then(value=>setSaved(value.data.notes));},[client]);return <div><textarea aria-label="Independent SDK draft" value={draft} onChange={event=>setDraft(event.target.value)}/><output>{saved}</output></div>;}
const definition=defineLocalTool({namespace:'qa.timeline-fit',name:{en:'Own Fit consumer',es:'Consumidor propio'},description:{en:'SDK viewport fixture',es:'Prueba SDK de vista'},initialState:{notes:'Saved default'},validateState:(value):value is {notes:string}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string',component:Notes});
export async function testTimelineFitContracts(){
 const P='qa-fit-contract',Q=P+'-foreign',root=createRoot(document.getElementById('root')!);let era:string|undefined,show=true,cloned='';
 const line=(projectId:string):Timeline=>({id:projectId+'-line',projectId,title:'Own lane',color:'#777777',yearRange:{start:1500,end:1900},displayPrecision:'year',createdAt:1,updatedAt:1});
 const events=(projectId:string):TimelineEvent[]=>Array.from({length:20},(_,i)=>({id:projectId+'-event'+i,projectId,timelineId:line(projectId).id,title:'Own event '+i,description:'Exact prose',dateMode:'calendar',realDate:(1500+i)+'-01-01',date:'Year '+(1500+i),order:i,lane:'',color:'#777777',createdAt:1,updatedAt:1}));
 const noWrite=()=>{throw Error('Viewport must not call a writer');};
 const clients:LocalToolClient<{notes:string}>[]=[];
 const raw=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
 const direct=async(name:string,args:Record<string,unknown>)=>{const reply=await runBridgeTool(name,args);check(reply.ok,JSON.stringify(reply));return reply.result as {targets:Array<{hostId:string;mode:string;zoom:number}>;available?:boolean};};
 const targets=(projectId=P,eraId?:string)=>direct('wh_timeline_view_get',{projectId,eraId});
 const mount=(projectId:string,scopeEra?:string)=><section data-fit-contract={projectId} style={{width:420}}><EnginePaneContext.Provider value={{projectId,eraId:scopeEra,instanceId:projectId,visible:true}}><SwimLaneView projectId={projectId} timelines={[line(projectId)]} events={events(projectId)} connections={[]} onAddEvent={noWrite} onEditEvent={noWrite} onDeleteEvent={noWrite} onAddConnection={noWrite} onEditConnection={noWrite} onDeleteConnection={noWrite} onEditTimeline={noWrite}/></EnginePaneContext.Provider></section>;
 const render=async()=>{await act(async()=>{root.render(<MemoryRouter><style>{'[data-fit-contract] .overflow-auto{overflow:auto}'}</style><Notes client={clients[0]} projectId={P}/>{show&&mount(P,era)}{mount(Q)}</MemoryRouter>);await pause();});};
 useLocaleStore.setState({locale:'en',loaded:true});
 try{
  for(const id of [P,Q]){await db.projects.add({id,title:id,description:'Synthetic',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['timeline'],engineOrder:['timeline'],createdAt:1,updatedAt:1,worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});await db.timelines.add(line(id));await db.timelineEvents.bulkAdd(events(id));}
  clients.push(createLocalToolClient(P,definition),createLocalToolClient(P,definition,{eraId:'past'}));await clients[0].save({notes:'Saved canonical SDK notes'},null);
  check((await targets()).targets.length===0,'No host before mount');const absent=await direct('wh_timeline_view_fit',{projectId:P,hostId:'absent'});check(absent.available===false,'Absent host must not queue');
  await render();await wait(()=>document.querySelectorAll('svg.select-none').length===2,'Two measurable real canvases');const before=await raw(),draft=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Independent SDK draft"]')!,initialDraft=draft.value;
  check((await clients[0].tools()).some(tool=>tool.name==='wh_timeline_view_fit'),'SDK public catalogue includes normal registered Fit');
  const base=(await targets()).targets[0],foreign=(await targets(Q)).targets[0];check(base&&foreign&&(await targets(P,'past')).targets.length===0,'Exact Base scope only');
  const rejected=await direct('wh_timeline_view_fit',{projectId:P,hostId:foreign.hostId});check(rejected.available===false,'Foreign host rejected');
  await act(async()=>{await clients[0].callTool('wh_timeline_view_fit',{hostId:base.hostId});await pause();});check((await targets()).targets[0].mode==='fit','SDK callTool invokes actual mounted Fit');check((await targets(Q)).targets[0].mode==='manual','Another host unaffected');check(document.querySelector('textarea')===draft&&draft.value===initialDraft,'SDK Fit remounted/lost own unsaved draft');
  era='past';await render();check((await targets()).targets.length===0,'Base does not include era host');const past=(await targets(P,'past')).targets[0];check(past&&past.hostId!==base.hostId,'Era binding gets fresh hostId');
  check((await direct('wh_timeline_view_fit',{projectId:P,hostId:base.hostId})).available===false,'Stale host revoked');await act(async()=>{await clients[1].callTool('wh_timeline_view_fit',{hostId:past.hostId});await pause();});check((await targets(P,'past')).targets[0].mode==='fit','SDK era pin reaches exact era host');
  era=undefined;await render();const next=(await targets()).targets[0];check(next.hostId!==base.hostId,'A-B-A does not revive old hostId');check((await direct('wh_timeline_view_fit',{projectId:P,hostId:base.hostId})).available===false,'A-B-A stale request rejected');
  show=false;await render();check((await targets()).targets.length===0,'Unmount revokes host');check((await direct('wh_timeline_view_fit',{projectId:P,hostId:next.hostId})).available===false,'Unmounted host unavailable');
  show=true;await render();check((await targets()).targets[0].mode==='manual','Unavailable requests are never applied on later mount');check(document.querySelector('textarea')===draft&&draft.value===initialDraft,'Mode/scope changes saved or lost another draft');
  check(await raw()===before,'SDK/get/Fit/scope change altered any business table/field/date');
  const portable=await exportProjectData(P);check(!JSON.stringify(portable).includes('hostId')&&!JSON.stringify(portable).includes('viewportWidth'),'Viewport must not enter JSON');cloned=await importProjectData(portable);const clone=(await db.timelines.where('projectId').equals(cloned).first())!;check(clone.displayPrecision==='year'&&clone.yearRange?.end===1900,'JSON copy retains authored settings');
  const archive=await createProjectZipArchive(P);await importProjectZip(new File([archive.blob],'fit-settings.zip'),{replaceProjectIds:[P]});check((await db.timelines.get(line(P).id))?.yearRange?.start===1500,'ZIP keeps authored range');
  await act(async()=>{root.render(<MemoryRouter><EnginePaneContext.Provider value={{projectId:P,instanceId:P,visible:true}}><TimelineEngine projectId={P}/></EnginePaneContext.Provider></MemoryRouter>);await pause();});
  for(const label of ['List','Calendar']){const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label);check(button,'Normal '+label+' view control');await act(async()=>{button!.click();await pause();});check((await targets()).targets.length===0,'List/calendar must not fabricate SwimLane viewport');}
  return ['Actual SDK client catalogue/callTool reaches exact live Base/era host; foreign, unmounted and A-B-A revoked hosts unavailable with no queue; independent unsaved SDK draft and all DB bytes exact','Viewport stays out of normal JSON/ZIP while range/precision survive real import/clone; normal List/Calendar expose no fabricated canvas host'];
 }finally{await act(async()=>root.unmount());for(const id of [P,Q,cloned].filter(Boolean))await deleteProject(id);}
}
