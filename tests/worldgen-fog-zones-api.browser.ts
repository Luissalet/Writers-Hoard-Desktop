import {db} from '../src/db';
import {deleteProject} from '../src/db/operations';
import {runBridgeTool} from '../src/services/aiBridge/dispatch';
import {openWorldForReading} from '../src/engines/worldgen/bridgeAccess';
import {deserializeEdits} from '../src/engines/worldgen/core/edits';
import {DOMAIN_GRIDS} from '../src/engines/worldgen/core/domainReplay';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),pause=(ms=40)=>new Promise(r=>setTimeout(r,ms));
function need(v:unknown,text:string):asserts v{if(!v)throw Error('HEALTH '+text);}
export async function run(){
 need(await db.projects.count()===0,'private empty DB');
 const id='qa-fog-zone-'+crypto.randomUUID(),sibling=id+'-sibling',marker='Own disposable Fog Zones domain characterization';
 for(const projectId of[id,sibling])await db.projects.add({id:projectId,title:marker,description:marker,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen'],engineOrder:['worldgen'],createdAt:1,updatedAt:1});
 const trace:any={checks:[],failures:[],calls:[],observations:[],cleanup:null};Reflect.set(window,'__fogZonesDiagnostic',trace);
 const Original=window.Worker,live=new Set<Worker>();let created=0,terminated=0;
 class Observed extends Original{constructor(url:string|URL,options?:WorkerOptions){super(url,options);live.add(this);created++;}terminate(){if(live.delete(this))terminated++;super.terminate();}}window.Worker=Observed;
 const authored=()=>db.transaction('r',db.tables,async()=>JSON.stringify(await Promise.all(db.tables.filter(t=>!['worldSnapshots','canonTiles','renderedTiles'].includes(t.name)).map(async t=>[t.name,await t.toArray()]))));
 const siblingBefore=await db.projects.get(sibling);
 async function call(tool:string,args:Record<string,unknown>){const before=await authored(),response=await runBridgeTool(tool,args),record={tool,args,response,before,after:await authored()};trace.calls.push(record);return record;}
 async function ok(tool:string,args:Record<string,unknown>){const record=await call(tool,args);need(record.response.ok,tool+' '+record.response.code+' '+record.response.error);return record.response.result as any;}
 async function state(worldId:string){const end=Date.now()+150000;while(Date.now()<end){const row=await db.generatedWorlds.get(worldId);need(row?.projectId===id,'own row');const opened=await openWorldForReading(row,'full');if(!opened.ok){await pause();continue;}const w=opened.world.data;const grids=await Promise.all(DOMAIN_GRIDS.map(async key=>{const a=w[key];need(a?.length===w.width*w.height,'14 '+key);return{key,sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a.buffer,a.byteOffset,a.byteLength))),v=>v.toString(16).padStart(2,'0')).join('')};}));return{edits:row.edits,active:deserializeEdits(row.edits??''),grids,meta:JSON.stringify({params:w.params,bounds:w.domain?.bounds,topology:w.domain?.topology,width:w.width,height:w.height,mapWidthKm:w.mapWidthKm})};}throw Error('HEALTH real reader deadline');}
 function check(v:unknown,name:string,legacy=false){trace.checks.push({name,passed:!!v});if(!v){if(legacy)throw Error('HEALTH '+name);trace.failures.push(name);}}
 async function undo(record:any,worldId:string,before:any){if(!record.response.ok)return;const audit=record.response.result?.__audit;need(audit,'actual writer audit');await ok('__undo',{entry:{...audit,tool:record.tool,kind:'update'}});const restored=await state(worldId);need(restored.edits===before.edits&&same(restored.grids,before.grids),'Undo exact journal/14');}
 const scoped=(worldId:string)=>({projectId:id,worldId});
 try{
  const legacy=await ok('wh_create_world',{projectId:id,title:'Own fog zone legacy',preset:'blankLand',seed:'own-fog-zones-legacy',width:1024,worldKm:1280});
  const finite=await ok('wh_create_world',{projectId:id,title:'Own fog zone shifted',preset:'blankLand',seed:'own-fog-zones-finite',sheetSize:{widthKm:64,heightKm:128,resolution:64}});
  const grown=await ok('wh_resize_world',{...scoped(finite.worldId),widthKm:48,heightKm:96,anchor:'south-east',fill:'sea',expectedRevision:finite.domain.revision});need(same(grown.domain.bounds,{x:56,y:16,width:24,height:48}),'fixture origin56,16');
  for(const[label,worldId]of [['legacy',legacy.worldId],['finite',finite.worldId]] as const){
   const health=label==='legacy',scope=scoped(worldId),domain=await ok('wh_get_world_domain',scope),cell=domain.cellKm,origin=domain.bounds;
   const initial=await state(worldId);trace.observations.push({label,phase:'baseline',domain,state:initial});
   const polygons=[{name:'small',pts:[{x:4,y:12},{x:8,y:12},{x:8,y:16},{x:4,y:16}],cells:16,center:{x:6,y:14}},...(!health?[{name:'wide',pts:[{x:2,y:12},{x:22,y:12},{x:22,y:20},{x:2,y:20}],cells:160,center:{x:12,y:16}}]:[])];
   for(const poly of polygons){
    const before=await state(worldId),added=await call('wh_add_zone',{...scope,name:'Own '+label+' '+poly.name,points:poly.pts,color:'#0a84e1',pattern:'outline'});need(added.response.ok,'actual zone creation');const zone:any=added.response.result?.zone;need(zone?.id,'public zone id');
    const after=await state(worldId),listed=await call('wh_list_zones',scope),value=(listed.response.result as any)?.zones?.find((z:any)=>z.id===zone.id),stored:any=after.active.filter((e:any)=>e.kind==='zone'&&e.id===zone.id).at(-1);
    trace.observations.push({label,polygon:poly,added,listed,stored,before,after});
    check(same(stored.pts,poly.pts.map(p=>({x:p.x+origin.x,y:p.y+origin.y}))),label+'_'+poly.name+'_ABS_PUBLICATION',health);
    check(listed.response.ok&&same(value?.pts,poly.pts)&&same(value?.center,poly.center),label+'_'+poly.name+'_LIST_LOCAL_CENTER',health);
    check(value?.areaKm2===Math.round(poly.cells*cell*cell),label+'_'+poly.name+'_PHYSICAL_AREA',health);
    check(listed.before===listed.after,label+'_'+poly.name+'_LIST_READONLY',health);
    const renamed=await call('wh_update_zone',{...scope,id:zone.id,name:'Own renamed '+label}),afterRename=await state(worldId),last:any=afterRename.active.filter((e:any)=>e.kind==='zone'&&e.id===zone.id).at(-1);trace.observations.push({label,phase:'rename-before-check',renamed,last,stored});
    check(renamed.response.ok&&same(last?.pts,stored.pts)&&last?.id===stored.id,label+'_'+poly.name+'_NAME_ONLY_PRESERVES_ABS',health);
    check(same(after.grids,before.grids)&&same(afterRename.grids,before.grids)&&after.meta===before.meta&&afterRename.meta===before.meta,label+'_'+poly.name+'_14_META_EXACT',health);
    await undo(renamed,worldId,after);await undo(added,worldId,before);
   }
   const cases=[{name:'single',points:[{x:5,y:6}],radius:1.5,queries:[{x:5,y:6},{x:13,y:22}],want:['seen','hidden']},{name:'edge',points:[{x:0,y:6}],radius:3,queries:[{x:0,y:6},{x:domain.bounds.width-1,y:6}],want:['seen',health?'seen':'hidden']},{name:'wide',points:[{x:2,y:10},{x:21,y:10}],radius:1.5,queries:[{x:12,y:10},{x:0,y:10}],want:['seen','hidden']}];
   for(const item of cases){
    const before=await state(worldId),baseline=await ok('wh_reader_view',{...scope,cells:item.queries,chapter:0});need(baseline.readerStart==='blank'&&baseline.cells.every((c:any)=>c.state==='hidden'),'blank reader baseline');
    const painted=await call('wh_paint_reader_fog',{...scope,op:'seen',points:item.points,radiusCells:item.radius,chapter:1});need(painted.response.ok,'real fog publish');
    const early=await call('wh_reader_view',{...scope,cells:item.queries,chapter:0}),read=await call('wh_reader_view',{...scope,cells:item.queries,chapter:1}),after=await state(worldId);trace.observations.push({label,item,painted,early,read,before,after});
    check(early.response.ok&&(early.response.result as any).cells.every((c:any)=>c.state==='hidden'),label+'_'+item.name+'_CHAPTER_GATE',health);
    check(read.response.ok&&same((read.response.result as any).cells.map((c:any)=>c.state),item.want),label+'_'+item.name+'_LOCAL_FINITE_FOG',health);
    check(read.before===read.after&&early.before===early.after,label+'_'+item.name+'_READER_READONLY',health);
    check(same(before.grids,after.grids)&&before.meta===after.meta,label+'_'+item.name+'_14_META_EXACT',health);
    await undo(painted,worldId,before);
   }
  }
  check(same(await db.projects.get(sibling),siblingBefore),'SIBLING_LITERAL');
 }finally{
  for(const projectId of[id,sibling]){need((await db.projects.get(projectId))?.description===marker,'cleanup own marker');await deleteProject(projectId);}window.Worker=Original;
  const counts:Record<string,number>={},projectIndexes:Record<string,number>={};for(const t of db.tables){counts[t.name]=await t.count();for(const index of t.schema.indexes)if(index.keyPath==='projectId')for(const projectId of[id,sibling])projectIndexes[t.name+':'+index.name+':'+projectId]=await t.where(index.name).equals(projectId).count();}trace.cleanup={counts,projectIndexes,tableCount:db.tables.length,measuredCount:Object.keys(counts).length+Object.keys(projectIndexes).length,workers:{created,terminated,live:live.size}};need([...Object.values(counts),...Object.values(projectIndexes)].every(v=>v===0)&&live.size===0,'own DB/Workers zero');
 }
 return{...trace,passed:trace.failures.length===0,attribution:'Actual dispatcher/reader/Workers/Undo, own private DB; not mounted UI/Native/Brave/PNG file'};
}


// Permanent regression adapter; original oracle above differs only in import roots.
export const trace:{checks:{name:string;passed:boolean}[];result?:Awaited<ReturnType<typeof run>>}={checks:[]};
export async function testWorldgenFogZonesAPI(){
 try{
  const result=await run();trace.result=result;trace.checks=result.checks;
  if(!result.passed)throw Error('Fog regression failed '+JSON.stringify(result.failures));
  if(result.checks.length!==43)throw Error('Fog criterion count changed');
  return result;
 }catch(error){Object.assign(trace,Reflect.get(window,'__fogZonesDiagnostic')??{});throw error;}
}
