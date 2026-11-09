import {getGeography} from '@/engines/worldgen/cartography/texture';
import {openWorldForReading} from '@/engines/worldgen/bridgeAccess';
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {deleteProject,exportProjectData,importProjectData} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {mutateEraRows,listEraRows} from '@/services/worldEras/store';
import {saveWorldJourney,saveWorldTravelSettings,revertWorldTravelSettings} from '@/engines/worldgen/journeyOperations';
import {worldgenScopeOperations,worldRuntimeKey} from '@/engines/worldgen/era';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {type Settlement} from '@/engines/worldgen/core/settlements';
import {saveSnapshot} from '@/engines/worldgen/snapshots';
import {paramsKey} from '@/engines/worldgen/useWorldGeneration';
import type {GeneratedWorld} from '@/engines/worldgen/types';
import type {WorldJourney} from '@/engines/worldgen/journeyTypes';
import {journeyPoint,journeyStopsForWorld} from '@/engines/worldgen/journeyTypes';
import {planRoute,effectiveHoursPerDay} from '@/engines/worldgen/core/travel';
import JourneyPanel from '@/engines/worldgen/components/JourneyPanel';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {t} from '@/i18n/useTranslation';
import {installJourneyWorkerFixture,JourneyWorkerFixture} from './journeyWorkerFixture';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(name:string,args:Record<string,unknown>){const reply=await runBridgeTool(name,args);check(reply.ok,`${name}: ${JSON.stringify(reply)}`);return reply.result as any;}
async function until(test:()=>unknown|Promise<unknown>,message:string){for(let i=0;i<200;i++){if(await test())return;await act(async()=>{await pause();});}throw Error(message);}
async function fixture(){
 const P='qa-rest-'+crypto.randomUUID(),W=P+'-world',params={...DEFAULT_PARAMS,seed:'hard-rest-own',width:128,starter:'land' as const,worldKm:2048};
 await db.projects.add({id:P,title:'Own rest fixture',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen'],createdAt:1,updatedAt:1,worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}]});
 const record:GeneratedWorld={id:W,projectId:P,title:'Own rest world',params,edits:'[]',createdAt:1,updatedAt:1};await db.generatedWorlds.add(record);
 return{P,W,record,scope:{projectId:P}};
}

export async function testWorldHardRestPersistence(){
 const f=await fixture(),owned=new Set([f.P]);
 try{
  const ways=[{id:'own-horse',name:'Own horse',base:'horse' as const}];
  await saveWorldTravelSettings(f.scope,f.W,{profile:{speed:{horse:1.25},ways}});
  const first=await saveWorldTravelSettings(f.scope,f.W,{hardRestEvery:3,pace:'hard'},1);
  check(first.revision===2&&first.to.profile?.speed?.horse===1.25&&first.to.profile.ways?.length===1&&first.to.profile.hardRestEvery===3,'Partial rest save discarded factors or ways');
  let stale=false;try{await saveWorldTravelSettings(f.scope,f.W,{hardRestEvery:2},1);}catch{stale=true;}check(stale,'Stale interval write accepted');
  const change=await saveWorldTravelSettings(f.scope,f.W,{hardRestEvery:2});await saveWorldTravelSettings(f.scope,f.W,{pace:'easy'});
  const undone=await revertWorldTravelSettings(f.scope,f.W,change);let row=(await db.generatedWorlds.get(f.W))!;
  check(undone.reverted.includes('profile')&&row.travelProfile?.hardRestEvery===3&&row.travelPace==='easy','Undo discarded independent pace change');
  const changedAgain=await saveWorldTravelSettings(f.scope,f.W,{hardRestEvery:2});await saveWorldTravelSettings(f.scope,f.W,{factors:[{table:'speed',key:'foot',value:1.5}]});
  check((await revertWorldTravelSettings(f.scope,f.W,changedAgain)).kept.includes('profile')&&(await db.generatedWorlds.get(f.W))?.travelProfile?.speed?.foot===1.5,'Undo overwrote a later profile change');
  const inherited=await saveWorldTravelSettings({projectId:f.P,eraId:'past'},f.W,{hardRestEvery:3});
  check(!inherited.scope?.eraId&&(await db.worldEraVariants.where('projectId').equals(f.P).count())===0,'Inherited settings detached world from Base');
  await mutateEraRows({projectId:f.P,eraId:'past'},[{table:'generatedWorlds',id:f.W,changes:{title:'Own era rest world'}}]);
  const eraScope={projectId:f.P,eraId:'past'},eraSet=await saveWorldTravelSettings(eraScope,f.W,{hardRestEvery:4});
  check(eraSet.scope?.eraId==='past'&&(await db.generatedWorlds.get(f.W))?.travelProfile?.hardRestEvery===3,'Era settings leaked into Base');
  await revertWorldTravelSettings(eraScope,f.W,eraSet);check((await worldgenScopeOperations(eraScope).worlds.getOne(f.W))?.travelProfile?.hardRestEvery===3,'Era Undo wrong scope');await saveWorldTravelSettings(eraScope,f.W,{hardRestEvery:4});
  const journey:WorldJourney={id:'rest-trip',name:'Own rest trip',stops:[{name:'A',u:.2,v:.5},{name:'B',u:.4,v:.5}],options:{mode:'horse',season:'summer',pace:'hard',profile:{hardRestEvery:3}},recipeKey:'own',createdAt:1,updatedAt:1};
  await saveWorldJourney(f.W,f.P,journey);await saveWorldJourney(f.W,f.P,{...journey,id:'era-trip',name:'Own era trip',options:{...journey.options,profile:{hardRestEvery:4}}},'past');
  await saveWorldTravelSettings(f.scope,f.W,{hardRestEvery:5});
  async function verify(projectId:string){const base=(await db.generatedWorlds.where('projectId').equals(projectId).toArray()).find(row=>row.title==='Own rest world');check(base?.travelProfile?.hardRestEvery===5&&base.journeys?.find(row=>row.name==='Own rest trip')?.options.profile?.hardRestEvery===3,'Portable Base profile or itinerary lost');const project=await db.projects.get(projectId),eraId=project!.worldEras!.find(row=>row.name==='Past')!.id,era=(await listEraRows<GeneratedWorld>({projectId,eraId},'generatedWorlds')).find(row=>row.title==='Own era rest world');check(era?.travelProfile?.hardRestEvery===4&&era.journeys?.find(row=>row.name==='Own era trip')?.options.profile?.hardRestEvery===4,'Portable era profile or itinerary lost');}
  await verify(f.P);const jsonId=await importProjectData(JSON.parse(JSON.stringify(await exportProjectData(f.P))));owned.add(jsonId);await verify(jsonId);
  const preview=await call('wh_project_duplicate_preview',{projectId:f.P,title:'Own rest clone'}),clone=await call('wh_project_duplicate',{projectId:f.P,title:'Own rest clone',operationId:'rest_'+crypto.randomUUID().replaceAll('-',''),expectedSourceVersion:preview.sourceVersion});check(clone.complete,'Duplicate unfinished');owned.add(clone.projectId);await verify(clone.projectId);
  const zip=await createProjectZipArchive(f.P);check(zip.blob.size>0,'Empty archive');await deleteProject(f.P);const restored=await importProjectZip(new File([zip.blob],zip.fileName,{type:'application/zip'}));check(restored.includes(f.P),'ZIP did not restore project');await verify(f.P);
  // MCP uses the normal persisted profile and reports the same calendar and replay result as the core.
  const data=generateWorld(f.record.params);await saveSnapshot(worldRuntimeKey(f.W),paramsKey(f.record.params),data);
  await call('wh_set_world_travel_settings',{worldId:f.W,profile:{hardRestEvery:3},pace:'hard'});
  const read=await call('wh_get_world_travel_settings',{worldId:f.W});check(read.profile.hardRestEvery===3,'MCP profile roundtrip');
  const stops=[{x:20,y:32},{x:50,y:32}],options={mode:'horse' as const,season:'summer' as const,pace:'hard' as const,hoursPerDay:2,profile:{hardRestEvery:3}};
  const opened=await openWorldForReading((await db.generatedWorlds.get(f.W))!,'full');check(opened.ok,'Own materialized world unavailable');const expected=planRoute(opened.world.data,opened.world.geo,stops[0],stops[1],options,'en');check(!expected.impossible&&(expected.restDays??0)>0,'Own MCP rest fixture too short or impossible');
  let result:any;for(let i=0;i<100;i++){result=await call('wh_plan_journey',{worldId:f.W,stops,mode:'horse',hoursPerDay:2,atDay:3.5,locale:'en'});if(!result.pending)break;await pause(50);}
  const arrivalDay=Math.ceil(expected.hours/effectiveHoursPerDay(options)-1e-9)+(expected.restDays??0);
  check(result.restEvery===3&&result.restDays===expected.restDays&&Math.abs(result.days-expected.days)<.011&&result.clock.arrives.day===arrivalDay&&result.atDay.phase==='rest','MCP duration/calendar/replay ignored interval '+JSON.stringify({actual:{restEvery:result.restEvery,restDays:result.restDays,days:result.days,clock:result.clock,atDay:result.atDay},expected:{days:expected.days,restDays:expected.restDays,arrivalDay}}));
  const rejected=await runBridgeTool('wh_set_world_travel_settings',{worldId:f.W,profile:{hardRestEvery:0}});check(!rejected.ok&&rejected.code==='bad-args','MCP invalid interval accepted');
  const set=await call('wh_set_world_travel_settings',{worldId:f.W,profile:{hardRestEvery:2}}),audit=set.__audit;
  await call('wh_set_world_travel_settings',{worldId:f.W,pace:'easy'});
  await call('__undo',{entry:{tool:'wh_set_world_travel_settings',kind:'update',entityId:audit.entityId,projectId:audit.projectId,before:audit.before,summary:'own rest'}});
  row=(await db.generatedWorlds.get(f.W))!;check(row.travelProfile?.hardRestEvery===3&&row.travelPace==='easy','Normal MCP Undo lost rest or independent pace');
  return ['Partial interval writes preserve factors/ways; CAS refuses stale edits; Undo preserves later independent changes','Inherited settings stay on Base; own era settings and Undo stay in that era','JSON, actual ZIP restore and normal project duplication preserve Base/era profiles and saved-trip intervals independently','Normal MCP get/set/plan/Undo preserves interval, duration, arrival calendar, rest playback and independent edits'];
 }finally{await db.worldSnapshots.delete(worldRuntimeKey(f.W));for(const projectId of owned)if(await db.projects.get(projectId))await deleteProject(projectId);}
}

export async function testWorldHardRestUI(){
 const f=await fixture(),restore=installJourneyWorkerFixture(),host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 const world=generateWorld(f.record.params),geography=getGeography(world,'full'),a=journeyPoint(20,32,'Own A',1),b=journeyPoint(50,32,'Own B',2);
 const untilUI=(test:()=>unknown,message:string)=>until(test,message);
 const click=async(label:string)=>{const button=Array.from(host.querySelectorAll('button')).find(item=>item.textContent?.trim()===label);check(button,'Missing '+label);await act(async()=>{button.click();await pause();});};
 const type=async(input:HTMLInputElement,value:string)=>{check(input,'Missing input');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await pause();});};
 function Harness({record}:{record:GeneratedWorld}){const[stops,setStops]=useState<Settlement[]>([a,b]);return <JourneyPanel world={world} geography={geography} worldRecord={record} from={stops[0]} to={stops[1]} via={[]} picking={null} onPick={()=>{}} onClearVia={()=>{}} onSwap={()=>{}} onClear={()=>{}} onRoute={()=>{}} onPaleo={()=>{}} paleo={null} onOpenJourney={journey=>setStops(journeyStopsForWorld(journey,world))}/>;}
 const render=async()=>{const record=(await db.generatedWorlds.get(f.W))!;await act(async()=>{root.render(<Harness record={record}/>);await pause();});};
 const current=()=>JourneyWorkerFixture.instances.filter(worker=>worker.job?.type==='route').at(-1)?.job;
 try{
  await saveWorldTravelSettings(f.scope,f.W,{ways:[{id:'own-horse',name:'Own horse',base:'horse'}]});await render();await untilUI(()=>host.querySelector('[data-testid="journey-playback"]'),'Initial route');
  await click(t('worldgen.journey.settings')+' ▾');check((host.querySelector('[data-testid="journey-hard-rest-every"]') as HTMLInputElement).value==='6','Legacy UI default');
  await click(t('worldgen.journey.pace.hard'));await type(host.querySelector('[data-testid="journey-hard-rest-every"]')!,'3');
  await untilUI(()=>current()?.type==='route'&&(current() as any).options.profile?.hardRestEvery===3,'UI worker missed interval '+JSON.stringify({worker:current()?.type==='route'?(current() as any).options:null,input:host.querySelector<HTMLInputElement>('[data-testid="journey-hard-rest-every"]')?.value}));
  await until(()=>db.generatedWorlds.get(f.W).then(row=>row?.travelProfile?.hardRestEvery===3),'Debounced interval not saved');
  await act(async()=>{root.render(null);await pause();});await render();await click(t('worldgen.journey.settings')+' ▾');check(host.querySelector<HTMLInputElement>('[data-testid="journey-hard-rest-every"]')?.value==='3','Reopened world lost stored interval');
  await type(host.querySelector('input[aria-label="'+t('worldgen.journey.name')+'"]')!,'Own UI trip');
  await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await pause();});
  await until(()=>db.generatedWorlds.get(f.W).then(row=>row?.journeys?.some(journey=>journey.name==='Own UI trip')),'UI trip not saved');
  let row=(await db.generatedWorlds.get(f.W))!,trip=row.journeys!.find(journey=>journey.name==='Own UI trip')!;check(trip.options.profile?.hardRestEvery===3,'UI trip missing interval snapshot');
  await act(async()=>{await saveWorldTravelSettings(f.scope,f.W,{hardRestEvery:5});});await render();
  const select=host.querySelector<HTMLSelectElement>('select[aria-label="'+t('worldgen.journey.openSaved')+'"]')!;
  await act(async()=>{select.value=trip.id;select.dispatchEvent(new Event('change',{bubbles:true}));await pause();});
  await untilUI(()=>host.querySelector<HTMLInputElement>('[data-testid="journey-hard-rest-every"]')?.value==='3','Opening trip did not restore own interval');
  await pause(550);check((await db.generatedWorlds.get(f.W))?.travelProfile?.hardRestEvery===5,'Opening old trip rewrote world');
  await click(t('worldgen.journey.settingsReset'));await until(()=>db.generatedWorlds.get(f.W).then(row=>!row?.travelProfile?.hardRestEvery),'UI reset not persisted');
  row=(await db.generatedWorlds.get(f.W))!;check(row.travelProfile?.ways?.length===1,'Reset removed own ways');
  return ['Normal UI defaults to six, edits interval3, recalculates in the worker and persists the partial setting','Normal itinerary save/open restores interval3 without rewriting current world5; reset restores six while preserving own ways'];
 }finally{await act(async()=>{root.unmount();await pause(500);});restore();host.remove();if(await db.projects.get(f.P))await deleteProject(f.P);}
}
