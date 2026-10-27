import {db} from '../src/db';
import {deleteProject} from '../src/db/operations';
import {runBridgeTool} from '../src/services/aiBridge/dispatch';
import {openWorldForReading} from '../src/engines/worldgen/bridgeAccess';
import {deserializeEdits} from '../src/engines/worldgen/core/edits';
import {DOMAIN_GRIDS} from '../src/engines/worldgen/core/domainReplay';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),pause=()=>new Promise(r=>setTimeout(r,40));
function need(v:unknown,m:string):asserts v{if(!v)throw Error('HEALTH '+m);}
const sha=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),v=>v.toString(16).padStart(2,'0')).join('');
export async function run(){
 need(await db.projects.count()===0,'private empty DB');
 const projectId='qa-fog-wrap-'+crypto.randomUUID(),marker='Own disposable zero-origin Fog wrap characterization';
 await db.projects.add({id:projectId,title:marker,description:marker,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen'],engineOrder:['worldgen'],createdAt:1,updatedAt:1});
 const trace:any={checks:[],failures:[],calls:[],observations:[],cleanup:null};Reflect.set(window,'__fogWrapDiagnostic',trace);
 const Original=window.Worker,live=new Set<Worker>();let created=0,terminated=0;
 class Observed extends Original{constructor(url:string|URL,options?:WorkerOptions){super(url,options);created++;live.add(this);}terminate(){if(live.delete(this))terminated++;super.terminate();}}window.Worker=Observed;
 const authored=()=>db.transaction('r',db.tables,async()=>JSON.stringify(await Promise.all(db.tables.filter(t=>!['worldSnapshots','canonTiles','renderedTiles'].includes(t.name)).map(async t=>[t.name,await t.toArray()]))));
 async function call(tool:string,args:Record<string,unknown>){const before=await authored(),response=await runBridgeTool(tool,args),record={tool,args,response,before,after:await authored()};trace.calls.push(record);return record;}
 async function ok(tool:string,args:Record<string,unknown>){const c=await call(tool,args);need(c.response.ok,tool+' '+c.response.code+' '+c.response.error);return c.response.result as any;}
 async function state(worldId:string){const end=Date.now()+150000;while(Date.now()<end){const row=await db.generatedWorlds.get(worldId);need(row?.projectId===projectId,'own world');const opened=await openWorldForReading(row,'full');if(!opened.ok){await pause();continue;}const w=opened.world.data;return{edits:row.edits,active:deserializeEdits(row.edits??''),grids:await Promise.all(DOMAIN_GRIDS.map(async key=>{const a=w[key];need(a?.length===w.width*w.height,'14 shapes');return{key,sha:await sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength))};})),meta:JSON.stringify({params:w.params,domain:w.domain,bounds:w.domain?.bounds,width:w.width,height:w.height,mapWidthKm:w.mapWidthKm}),width:w.width,height:w.height};}throw Error('HEALTH reader150s');}
 function check(v:unknown,name:string,legacy:boolean){trace.checks.push({name,passed:!!v});if(!v){if(legacy)throw Error('HEALTH '+name);trace.failures.push(name);}}
 try{
  const legacy=await ok('wh_create_world',{projectId,title:'Own legacy fog wrap',preset:'blankLand',seed:'own-legacy-fog-wrap-r1',width:1024,worldKm:1280});
  const finite=await ok('wh_create_world',{projectId,title:'Own zero origin fog wrap',preset:'blankLand',seed:'own-finite-fog-wrap-r1',sheetSize:{widthKm:640,heightKm:320,resolution:128}});
  for(const[label,worldId]of [['legacy',legacy.worldId],['finite',finite.worldId]] as const){
   const health=label==='legacy',scope={projectId,worldId},domain=await ok('wh_get_world_domain',scope),base=await state(worldId);
   if(health)need(domain.topology==='legacy-sheet'&&same(domain.bounds,{x:0,y:0,width:1024,height:512})&&base.width===1024&&base.height===512,'legacy actual geometry');
   else need(domain.topology==='finite'&&same(domain.bounds,{x:0,y:0,width:128,height:64})&&domain.source.width===128&&domain.source.height===64&&domain.cellKm===5&&base.width===128&&base.height===64,'finite actual origin0/128x64/cell5');
   trace.observations.push({label,phase:'actual-geometry-before-paint',domain,width:base.width,height:base.height});
   const W=base.width,cases=[{name:'edge',points:[{x:0,y:6}],radius:3,queries:[{x:0,y:6},{x:W-1,y:6}],expected:['seen',health?'seen':'hidden']},{name:'long',points:[{x:2,y:10},{x:W-3,y:10}],radius:1.5,queries:[{x:Math.floor((W-1)/2),y:10},{x:0,y:10}],expected:health?['hidden','seen']:['seen','hidden']}];
   for(const item of cases){
    const before=await state(worldId),baseline=await ok('wh_reader_view',{...scope,cells:item.queries,chapter:0});need(baseline.readerStart==='blank'&&baseline.cells.every((c:any)=>c.state==='hidden'),'own blank chapter0');
    const painted=await call('wh_paint_reader_fog',{...scope,op:'seen',points:item.points,radiusCells:item.radius,chapter:1});need(painted.response.ok,'normal fog writer');
    const early=await call('wh_reader_view',{...scope,cells:item.queries,chapter:0}),read=await call('wh_reader_view',{...scope,cells:item.queries,chapter:1}),after=await state(worldId),strokes=after.active.filter((e:any)=>e.kind==='fog');
    trace.observations.push({label,item,before,painted,strokes,early,read,after});
    check(early.response.ok&&(early.response.result as any).cells.every((c:any)=>c.state==='hidden'),label+'_'+item.name+'_CHAPTER_GATE',health);
    check(read.response.ok&&same((read.response.result as any).cells.map((c:any)=>c.state),item.expected),label+'_'+item.name+'_WRAP_CONTRACT',health);
    check(read.before===read.after&&early.before===early.after,label+'_'+item.name+'_READONLY',health);
    check(same(before.grids,after.grids)&&before.meta===after.meta,label+'_'+item.name+'_14_META_EXACT',health);
    if(!health&&item.name==='long'){const pts=strokes.flatMap((e:any)=>e.stroke.pts);check(same(pts[0],{x:2.5,y:10.5})&&same(pts.at(-1),{x:125.5,y:10.5}),label+'_LONG_LITERAL_ENDPOINTS',false);}
    const audit=(painted.response.result as any).__audit;need(audit,'actual audit');await ok('__undo',{entry:{...audit,tool:'wh_paint_reader_fog',kind:'update'}});const restored=await state(worldId);need(restored.edits===before.edits&&same(restored.grids,before.grids),'actual audit Undo exact journal/14');
   }
  }
 }finally{
  need((await db.projects.get(projectId))?.description===marker,'own cleanup marker');await deleteProject(projectId);window.Worker=Original;
  const counts:Record<string,number>={},indexes:Record<string,number>={};for(const t of db.tables){counts[t.name]=await t.count();for(const index of t.schema.indexes)if(index.keyPath==='projectId')indexes[t.name+':'+index.name]=await t.where(index.name).equals(projectId).count();}trace.cleanup={counts,indexes,tables:db.tables.length,workers:{created,terminated,live:live.size}};need([...Object.values(counts),...Object.values(indexes)].every(v=>v===0)&&live.size===0,'all own tables/indexes/Workers zero');
 }
 return{...trace,passed:trace.failures.length===0,attribution:'Normal dispatcher/reader/Workers/Undo, raw ABS equals local at asserted origin0. No UI/Native/Brave/PNG/routeReveal claim'};
}


// Permanent regression adapter; original oracle above differs only in import roots.
export const trace:{checks:{name:string;passed:boolean}[];result?:Awaited<ReturnType<typeof run>>}={checks:[]};
export async function testWorldgenFogWrap(){
 try{
  const result=await run();trace.result=result;trace.checks=result.checks;
  if(!result.passed)throw Error('Fog regression failed '+JSON.stringify(result.failures));
  if(result.checks.length!==17)throw Error('Fog criterion count changed');
  return result;
 }catch(error){Object.assign(trace,Reflect.get(window,'__fogWrapDiagnostic')??{});throw error;}
}
