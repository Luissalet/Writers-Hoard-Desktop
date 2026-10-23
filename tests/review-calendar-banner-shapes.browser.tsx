import '@/engines/timeline/index';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {exportProjectData,importProjectData} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {createToolExecutor,type AuditLine} from '@/services/aiRuntime/executorCore';
import {saveWorldEra,readEraRow} from '@/services/worldEras/store';
import {defaultWorldCalendar} from '@/engines/timeline/worldCalendar';
import CalendarView from '@/engines/timeline/components/CalendarView';
import {useLocaleStore} from '@/stores/localeStore';
import type {TimelineEvent} from '@/types';
const P='review-banner-shapes',T=P+'-timeline';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
const calendar={...defaultWorldCalendar('Five day world'),months:[{name:'Alpha',days:10},{name:'Beta',days:10}],weekdays:['A','B','C','D','E'],weekdayOffset:2,moons:[],holidays:[]};
async function seed(){await db.projects.put({id:P,title:'Banner review',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:['timeline'],worldCalendar:calendar,createdAt:1,updatedAt:1});await db.timelines.put({id:T,projectId:P,title:'Five days',color:'#4984ac',createdAt:1,updatedAt:1});}
async function clean(owner=P){for(const table of db.tables)if(table.name!=='projects'&&table.schema.idxByName.projectId)await table.where('projectId').equals(owner).delete();await db.projects.delete(owner);}
const args={projectId:P,timelineId:T,title:'Long harbour event',dateMode:'world',worldDate:{year:1,month:1,day:2},worldDateEnd:{year:1,month:2,day:3},eventType:'range'};
export async function reviewBannerShapeErrors():Promise<string[]>{
 const receipts:AuditLine[]=[],execute=createToolExecutor({writesEnabled:async()=>true,relay:runBridgeTool,audit:async line=>{receipts.push(line);return receipts.length-1;}}),call=(tool:string,input:Record<string,unknown>)=>execute({tool,args:input},{origin:'bridge',projectId:P});
 try{
  await seed();assert((await call('wh_create_event',args)).ok,'Legacy event creation failed');const event=(await db.timelineEvents.where('projectId').equals(P).toArray())[0],before=JSON.stringify(event);
  const listed=await call('wh_list_events',{projectId:P,timelineId:T});assert(listed.ok&&(listed.result as {events:{bannerShape:string}[]}).events[0].bannerShape==='plain'&&JSON.stringify(await db.timelineEvents.get(event.id))===before,'Legacy read filled missing shape');
  for(const bad of [{bannerShape:'dots',title:'Must not save'},{bannerShape:{type:'ribbon'},title:'Must not save'},{bannerPattern:'ribbon',bannerShape:'scallop'}]){const reply=await call('wh_update_event',{id:event.id,...bad});assert(!reply.ok&&reply.code==='bad-args'&&JSON.stringify(await db.timelineEvents.get(event.id))===before,'Invalid mixed patch partly mutated event');}
  const audits=receipts.length,fail=()=>{throw Error('independent event storage failure');};db.timelineEvents.hook('updating',fail);
  try{assert(!(await call('wh_update_event',{id:event.id,bannerShape:'bunting'})).ok,'Storage failure reported success');}finally{db.timelineEvents.hook('updating').unsubscribe(fail);}
  assert(receipts.slice(audits).every(line=>!line.ok)&&JSON.stringify(await db.timelineEvents.get(event.id))===before,'Failed storage wrote event or success audit');
  assert((await call('wh_update_event',{id:event.id,bannerShape:'ribbon',bannerPattern:'checks'})).ok,'Valid retry failed');const receipt=receipts.at(-1)!;
  assert((await runBridgeTool('__undo',{entry:receipt})).ok,'Normal Undo failed');assert(!Object.hasOwn((await db.timelineEvents.get(event.id))!,'bannerShape'),'Undo did not remove formerly absent shape');
  const missing=await call('wh_update_event',{id:P+'-missing',bannerShape:'ribbon'});assert(!missing.ok&&missing.code==='not-found','Missing event should refuse update');
  await db.timelineEvents.delete(event.id);assert(!(await runBridgeTool('__undo',{entry:receipt})).ok,'Undo silently recreated a missing event');
  return ['MCP rejects invalid mixed patches atomically, storage failures create no audit, retry/Undo restore absent shape and missing-event operations refuse'];
 }finally{await clean();}
}
export async function reviewBannerShapeWorldDom():Promise<string[]>{
 const root=createRoot(document.getElementById('root')!);useLocaleStore.setState({locale:'en',loaded:true});
 const event:TimelineEvent={...args,id:P+'-dom',date:'',dateMode:'world',eventType:'range',color:'#4984ac',order:0,createdAt:1,updatedAt:1};
 const band=(day:number)=>document.querySelector<HTMLElement>(`[data-testid="calendar-day-${day}"] [data-testid="calendar-event"]`)!;
 const render=async(row:TimelineEvent,key:string)=>{await act(async()=>{root.render(<CalendarView key={key} events={[row]} timelines={[]} worldCalendar={calendar} onAddEvent={()=>{}}/>);await pause();});};
 try{
  await render(event,'legacy');const absent=band(2).getAttribute('style');await render({...event,bannerShape:'plain'},'plain');assert(band(2).getAttribute('style')===absent&&!band(3).querySelector('.sr-only'),'Plain no longer matches missing legacy shape');
  for(const shape of ['ribbon','bunting','scallop'] as const)for(const pattern of [undefined,'stripes','dots','checks'] as const){
   await render({...event,bannerShape:shape,bannerPattern:pattern},shape+pattern);
   assert([...document.querySelectorAll('[data-testid^="calendar-day-"]')].filter(day=>day.querySelector('[data-testid="calendar-event"]')).length===9,'Five-day calendar lost range coverage');
   assert(!band(2).querySelector('.sr-only')&&band(3).querySelector('.sr-only')&&!band(4).querySelector('.sr-only')&&band(5).querySelector('.sr-only')&&!band(9).querySelector('.sr-only'),'Titles do not follow custom five-day week and offset');
   assert(band(10).dataset.banner==='middle','Month truncation falsely became range end');
   const computed=getComputedStyle(band(2));assert(pattern===undefined||computed.backgroundImage!=='none','Shape dropped patterned fill');
   if(shape==='ribbon')assert(computed.clipPath.includes('6px')&&!getComputedStyle(band(3)).clipPath.includes('6px'),'Ribbon clips interior joins');else assert(computed.maskImage!== 'none'&&computed.maskSize.includes('8px 4px'),'Decorative lower edge absent in DOM');
   await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid="calendar-next"]')!.click();await pause();});
   assert(band(1).dataset.banner==='middle'&&!band(1).querySelector('.sr-only')&&band(2).querySelector('.sr-only')&&band(3).dataset.banner==='end','New month lost first visible title or actual end');
  }
  return ['Custom five-day week/offset and month carry preserve every shape/fill, continuity, accessible labels and exact legacy Plain style'];
 }finally{await act(async()=>root.unmount());}
}
export async function reviewBannerShapeEraPortable():Promise<string[]>{
 let clone='';
 try{
  await seed();for(const [title,shape]of [['Missing',undefined],['Explicit plain','plain'],['Decorated','ribbon']]as const)await runBridgeTool('wh_create_event',{...args,title,...(shape?{bannerShape:shape}:{}),bannerPattern:'dots'});
  const rows=await db.timelineEvents.where('projectId').equals(P).toArray(),decorated=rows.find(row=>row.title==='Decorated')!,base=JSON.stringify(decorated);
  await saveWorldEra(P,{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);const receipts:AuditLine[]=[];
  const execute=createToolExecutor({writesEnabled:async()=>true,relay:runBridgeTool,audit:async line=>{receipts.push(line);return receipts.length-1;}});
  assert((await execute({tool:'wh_update_event',args:{id:decorated.id,projectId:P,eraId:'past',bannerShape:'scallop',bannerPattern:'stripes'}},{origin:'bridge',projectId:P})).ok,'Era shape update failed');
  assert((await readEraRow<TimelineEvent>({projectId:P,eraId:'past'},'timelineEvents',decorated.id))?.bannerShape==='scallop'&&JSON.stringify(await db.timelineEvents.get(decorated.id))===base,'Era patch modified Base');
  assert((await runBridgeTool('__undo',{entry:receipts[0]})).ok&&(await readEraRow<TimelineEvent>({projectId:P,eraId:'past'},'timelineEvents',decorated.id))?.bannerShape==='ribbon','Era Undo failed to restore source shape');
  clone=await importProjectData(await exportProjectData(P));const cloned=await db.timelineEvents.where('projectId').equals(clone).toArray();assert(cloned.find(row=>row.title==='Decorated')?.bannerShape==='ribbon'&&cloned.every(row=>row.bannerPattern==='dots')&&!Object.hasOwn(cloned.find(row=>row.title==='Missing')!,'bannerShape')&&cloned.find(row=>row.title==='Explicit plain')?.bannerShape===undefined,'Clone altered shape/fill or migrated absent/plain');
  const zip=await createProjectZipArchive(P);await db.timelineEvents.update(decorated.id,{bannerShape:'bunting',bannerPattern:'checks'});await importProjectZip(new File([zip.blob],zip.fileName,{type:'application/zip'}),{replaceProjectIds:[P]});assert((await db.timelineEvents.get(decorated.id))?.bannerShape==='ribbon'&&(await db.timelineEvents.get(decorated.id))?.bannerPattern==='dots','ZIP did not restore independent shape and fill');
  return ['Era MCP/Undo preserve Base and world dates; real clone and ZIP keep decoration/fill without filling absent/plain legacy fields'];
 }finally{if(clone)await clean(clone);await clean();}
}
