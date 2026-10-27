import {db} from '../src/db';
import {deleteProject} from '../src/db/operations';
import {runBridgeTool} from '../src/services/aiBridge/dispatch';
import {openWorldForReading} from '../src/engines/worldgen/bridgeAccess';
import {deserializeEdits} from '../src/engines/worldgen/core/edits';
import {DOMAIN_GRIDS} from '../src/engines/worldgen/core/domainReplay';

export const trace:any={checks:[]};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function require(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),v=>v.toString(16).padStart(2,'0')).join('');
export async function testWorldgenSourceABS(){
  const freshCounts=await Promise.all(db.tables.map(async table=>({table:table.name,count:await table.count()})));
  require(freshCounts.length===88&&freshCounts.every(row=>row.count===0),'HEALTH: all88 private tables empty');
  const projectId='qa-source-abs-'+crypto.randomUUID(),siblingId=projectId+'-sibling',marker='Own disposable public Source ABS';
  for(const id of[projectId,siblingId])await db.projects.add({id,title:marker,description:marker,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen'],engineOrder:['worldgen'],createdAt:1,updatedAt:1});
  Object.assign(trace,{attribution:'Actual public dispatcher/reader/real Workers; own hidden profile on existing63395, not Native/Brave/Main',checks:[],calls:[],observations:[],failures:[],healthFailures:[]});
  const OriginalWorker=window.Worker,live=new Set<Worker>();let created=0,terminated=0;
  class ObservedWorker extends OriginalWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);created++;live.add(this);}terminate(){if(live.delete(this))terminated++;super.terminate();}}
  window.Worker=ObservedWorker;
  const authored=()=>db.transaction('r',db.tables,async()=>JSON.stringify(await Promise.all(db.tables.filter(t=>!['worldSnapshots','canonTiles','renderedTiles'].includes(t.name)).map(async t=>[t.name,await t.toArray()]))));
  const sibling=()=>db.transaction('r',db.tables,async()=>JSON.stringify(await Promise.all(db.tables.map(async t=>[t.name,(await t.toArray()).filter(row=>row.id===siblingId||row.projectId===siblingId)]))));
  const siblingBefore=await sibling();
  const check=(ok:unknown,name:string,detail?:unknown)=>{trace.checks.push({name,passed:!!ok,detail});if(!ok)trace.failures.push(name);};
  function criterion(ok:unknown,name:string,legacy:boolean,detail?:unknown){if(legacy)require(ok,'HEALTH legacy: '+name);else check(ok,name,detail);}
  async function call(tool:string,args:Record<string,unknown>){const before=await authored(),response=await runBridgeTool(tool,args),record:any={tool,args,response,authoredBefore:before,authoredAfter:await authored()};trace.calls.push(record);return record;}
  async function success(tool:string,args:Record<string,unknown>){const record=await call(tool,args);require(record.response.ok&&!record.response.result?.pending,'HEALTH public '+tool+': '+record.response.code+' '+record.response.error);return record;}
  async function state(worldId:string){
    const deadline=Date.now()+150000;
    while(Date.now()<deadline){
      const row=await db.generatedWorlds.get(worldId);require(row?.projectId===projectId,'Own actual world');
      const opened=await openWorldForReading(row,'full');if(!opened.ok){await pause(40);continue;}
      const data=structuredClone(opened.world.data),places=opened.world.atlas.places.map(p=>({key:p.key,name:p.name,kind:p.kind,x:p.x,y:p.y}));
      const grids=await Promise.all(DOMAIN_GRIDS.map(async field=>{const v=data[field];require(v&&v.length===data.width*data.height,'Actual14grid '+field);return{field,sha256:await sha(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};}));
      return{rowEdits:row.edits,edits:deserializeEdits(row.edits??''),params:row.params,geometry:data.domain?{bounds:data.domain.bounds,source:data.domain.source,topology:data.domain.topology}:null,width:data.width,height:data.height,grids,places,elevation:Array.from(data.elevation),lake:Array.from(data.lake)};
    }throw Error('HEALTH normal actual reader deadline');
  }
  const compact=(s:any)=>({...s,elevation:undefined,lake:undefined});
  async function undo(record:any,before:any,worldId:string){
    require(record.response.ok&&record.response.result?.__audit,'HEALTH actual successful audit required');
    record.undo=await runBridgeTool('__undo',{entry:{...record.response.result.__audit,tool:record.tool,kind:'update'}});require(record.undo.ok,'HEALTH actual Undo failed');
    const restored=await state(worldId);record.restored=compact(restored);
    require(same(restored.edits,before.edits)&&same(restored.grids,before.grids)&&same(restored.params,before.params)&&same(restored.geometry,before.geometry),'HEALTH Undo restores active edits/14RAW/geometry');
  }
  async function readPlaces(worldId:string){const r=await success('wh_list_places',{projectId,worldId,kind:'ruin',limit:1000});require(r.authoredBefore===r.authoredAfter,'HEALTH list places readonly');return r;}
  async function readStory(worldId:string){const r=await success('wh_list_story_events',{projectId,worldId});require(r.authoredBefore===r.authoredAfter,'HEALTH list story readonly');return r;}
  const latestStory=(s:any)=>{const latest=new Map<string,any>();for(const e of s.edits)if(e.kind==='story')latest.set(e.id,e);else if(e.kind==='storyRemove')latest.delete(e.id);return [...latest.values()];};
  async function family(name:string,fn:()=>Promise<void>){try{await fn();}catch(e){trace.healthFailures.push({family:name,error:e instanceof Error?e.stack:String(e)});}}
  try{
    const legacy=(await success('wh_create_world',{projectId,title:'Own Source ABS legacy',preset:'blankLand',seed:'own-source-abs-legacy',width:1024})).response.result;
    const finite=(await success('wh_create_world',{projectId,title:'Own Source ABS portrait',preset:'blankLand',seed:'own-coordinate-portrait',sheetSize:{widthKm:320,heightKm:640,resolution:64}})).response.result;
    trace.worlds={legacy,finite};
    for(const [worldId,isLegacy]of[[legacy.worldId,true],[finite.worldId,false]]as const){
      if(!isLegacy)require(trace.healthFailures.length===0,'HEALTH legacy controls must complete before finite cases');
      const scope={projectId,worldId},initial=await state(worldId),origin=initial.geometry?.bounds??{x:0,y:0};
      require(isLegacy?initial.width===1024&&initial.height===512:initial.width===32&&initial.height===64&&origin.x===48&&origin.y===0,'HEALTH actual geometry');
      await family((isLegacy?'legacy':'finite')+' places',async()=>{
        const s=await state(worldId),candidates:any[]=[];
        for(let y=2;y<s.height-2&&candidates.length<2;y++)for(let x=2;x<s.width-2&&candidates.length<2;x++){
          const i=y*s.width+x;
          if(s.elevation[i]<=0||s.lake[i]||s.places.some((p:any)=>Math.round(p.x)===x&&Math.round(p.y)===y||p.key===`ruin:${x},${y}`||p.key===`ruin:${x+origin.x},${y+origin.y}`))continue;
          candidates.push({x,y});
        }
        require(candidates.length===2,'HEALTH two actual free dry cells');trace.observations.push({worldId,candidates,geometry:s.geometry});
        const before=await state(worldId),name='Own exact ruin '+(isLegacy?'legacy':'finite');
        const add=await success('wh_add_place',{...scope,marker:'ruin',ruin:'tower',...candidates[0],name});add.before=compact(before);const after=await state(worldId);add.after=compact(after);
        const listed=await readPlaces(worldId),actual=listed.response.result.places.filter((p:any)=>p.name===name);require(actual.length===1,'HEALTH actual own add is publicly visible');
        const added=after.edits.slice(before.edits.length).filter((e:any)=>e.kind==='marker');
        criterion(added.length===1&&added[0].x===candidates[0].x+origin.x&&added[0].y===candidates[0].y+origin.y,'ADD_PLACE_DURABLE_ABS_ONCE',isLegacy);
        criterion(add.response.result.key===actual[0].key&&actual[0].x===candidates[0].x&&actual[0].y===candidates[0].y,'ADD_PLACE_PUBLISHED_KEY_MATCHES_PUBLIC_LIST',isLegacy,{response:add.response.result,actual:actual[0]});
        // A bad add response key must not mask the independent duplicate case.
        const copyBefore=await state(worldId),copyName=name+' copy';
        const copy=await success('wh_duplicate_place',{...scope,key:actual[0].key,...candidates[1],name:copyName});copy.before=compact(copyBefore);const copyAfter=await state(worldId);copy.after=compact(copyAfter);
        const copies=(await readPlaces(worldId)).response.result.places.filter((p:any)=>p.name===copyName);require(copies.length===1,'HEALTH actual duplicate publicly visible');
        const copyEdits=copyAfter.edits.slice(copyBefore.edits.length).filter((e:any)=>e.kind==='marker');
        criterion(copyEdits.length===1&&copyEdits[0].x===candidates[1].x+origin.x&&copyEdits[0].y===candidates[1].y+origin.y,'DUPLICATE_PLACE_DURABLE_ABS_ONCE',isLegacy);
        criterion(copy.response.result.key===copies[0].key&&copies[0].x===candidates[1].x&&copies[0].y===candidates[1].y,'DUPLICATE_PLACE_PUBLISHED_KEY_MATCHES_PUBLIC_LIST',isLegacy,{response:copy.response.result,actual:copies[0]});
        await undo(copy,copyBefore,worldId);await undo(add,before,worldId);
      });
      await family((isLegacy?'legacy':'finite')+' story',async()=>{
        const before=await state(worldId),defs=[{x:8,y:12,type:'meeting',title:'Own arrival Ω',note:'First exact prose',chapter:7,status:'happened'},{x:17,y:14,type:'journey',title:'Own departure 李',note:'Second exact prose',chapter:7,status:'happened'}];
        const first=await success('wh_add_story_event',{...scope,...defs[0]});first.before=compact(before);const afterFirst=await state(worldId);first.after=compact(afterFirst);
        const second=await success('wh_add_story_event',{...scope,...defs[1]});second.before=compact(afterFirst);const afterSecond=await state(worldId);second.after=compact(afterSecond);
        const ids=[first.response.result.event.id,second.response.result.event.id];require(ids[0]&&ids[1]&&ids[0]!==ids[1],'HEALTH distinct real public story IDs');
        const expected=defs.map((d,i)=>({...d,id:ids[i],x:d.x+.5,y:d.y+.5}));
        const exactRecords=(rows:any[],abs:boolean,prose=false)=>expected.every((e,i)=>{const r=rows.find(row=>row.id===e.id);return r&&r.x===e.x+(abs?origin.x:0)&&r.y===e.y+(abs?origin.y:0)&&r.title===(prose&&i===0?'Own revised Ω':e.title)&&r.note===(prose&&i===0?'Changed note 李':e.note)&&r.type===e.type&&r.chapter===7&&r.status==='happened';});
        criterion(exactRecords(latestStory(afterSecond),true),'STORY_ADD_DURABLE_ABS_ONCE',isLegacy);
        criterion(exactRecords([first.response.result.event,second.response.result.event],false),'STORY_ADD_RESPONSE_LOCAL_CENTRES',isLegacy);
        const list=await readStory(worldId);criterion(exactRecords(list.response.result.events,false),'STORY_LIST_LOCAL_CENTRES',isLegacy,{events:list.response.result.events});
        const proseBefore=await state(worldId),prose=await success('wh_update_story_event',{...scope,id:ids[0],title:'Own revised Ω',note:'Changed note 李'});prose.before=compact(proseBefore);const proseAfter=await state(worldId);prose.after=compact(proseAfter);
        criterion(exactRecords(latestStory(proseAfter),true,true),'STORY_PROSE_ONLY_DURABLE_POSITION_STABLE',isLegacy,{events:latestStory(proseAfter)});
        criterion(prose.response.result.event.x===expected[0].x&&prose.response.result.event.y===expected[0].y,'STORY_PROSE_ONLY_RESPONSE_LOCAL',isLegacy,{event:prose.response.result.event});
        const proseList=await readStory(worldId);criterion(exactRecords(proseList.response.result.events,false,true),'STORY_PROSE_ONLY_LIST_LOCAL_STABLE',isLegacy,{events:proseList.response.result.events});
        await undo(prose,proseBefore,worldId);
        const orderBefore=await state(worldId),order=await success('wh_update_story_event',{...scope,id:ids[1],order:0});order.before=compact(orderBefore);const orderAfter=await state(worldId);order.after=compact(orderAfter);
        criterion(exactRecords(latestStory(orderAfter),true),'STORY_REORDER_BOTH_DURABLE_POSITIONS_STABLE',isLegacy,{events:latestStory(orderAfter)});
        criterion(order.response.result.event.x===expected[1].x&&order.response.result.event.y===expected[1].y,'STORY_REORDER_RESPONSE_LOCAL',isLegacy,{event:order.response.result.event});
        const ordered=await readStory(worldId),events=ordered.response.result.events;
        criterion(exactRecords(events,false),'STORY_REORDER_LIST_LOCAL_STABLE',isLegacy,{events});
        criterion(events.length===2&&events[0].id===ids[1]&&events[0].order===0&&events[1].id===ids[0]&&events[1].order===1,'STORY_REORDER_PUBLIC_ORDER',isLegacy,{events});
        criterion([afterFirst,afterSecond,proseAfter,orderAfter].every(s=>same(s.grids,before.grids)&&same(s.params,before.params)&&same(s.geometry,before.geometry)),'STORY_14RAW_PARAMS_GEOMETRY_EXACT',isLegacy);
        await undo(order,orderBefore,worldId);await undo(second,afterFirst,worldId);await undo(first,before,worldId);
      });
    }
    check(await sibling()===siblingBefore,'OTHER_OWN_PROJECT_LITERAL');
  }finally{
    for(const id of[projectId,siblingId]){require((await db.projects.get(id))?.description===marker,'Own cleanup marker');await deleteProject(id);}
    window.Worker=OriginalWorker;
    const counts:Record<string,number>={};for(const table of db.tables)counts[table.name]=await table.count();trace.cleanup={counts,empty:Object.values(counts).every(n=>n===0),workers:{created,terminated,live:live.size}};
    require(trace.cleanup.empty&&live.size===0,'Own cleanup tables/Workers');
  }
  if(trace.failures.length||trace.healthFailures.length)throw Error('SOURCE_ABS_FAILURE '+JSON.stringify({failures:trace.failures,healthFailures:trace.healthFailures}));
  return{...trace,passed:true};
}
