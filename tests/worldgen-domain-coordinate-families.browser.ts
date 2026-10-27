import {db} from '../src/db';
import {deleteProject} from '../src/db/operations';
import {runBridgeTool} from '../src/services/aiBridge/dispatch';
import {openWorldForReading} from '../src/engines/worldgen/bridgeAccess';
import {deserializeEdits} from '../src/engines/worldgen/core/edits';
import {DOMAIN_GRIDS} from '../src/engines/worldgen/core/domainReplay';
import {BIOME_KEY} from '../src/engines/worldgen/core/biomeKeys';

export const trace:any={checks:[]};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function require(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),v=>v.toString(16).padStart(2,'0')).join('');
export async function testWorldgenDomainCoordinateFamilies(){
  require(await db.projects.count()===0,'HEALTH: fresh private database required');
  const projectId='qa-coordinate-family-'+crypto.randomUUID(),siblingId=projectId+'-sibling',marker='Own disposable public coordinate family';
  for(const id of[projectId,siblingId])await db.projects.add({id,title:marker,description:marker,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen'],engineOrder:['worldgen'],createdAt:1,updatedAt:1});
  Object.assign(trace,{attribution:'Actual dispatcher/runBridgeTool, real Workers/reader/Source edits/Undo, private Electron; not Native/Brave/Main',checks:[],calls:[],failures:[],healthFailures:[],cleanup:[]});
  const OriginalWorker=window.Worker,live=new Set<Worker>();let created=0,terminated=0;
  class ObservedWorker extends OriginalWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);created++;live.add(this);}terminate(){if(live.delete(this))terminated++;super.terminate();}}
  window.Worker=ObservedWorker;
  const check=(ok:unknown,name:string,detail?:unknown)=>{trace.checks.push({name,passed:!!ok,detail});if(!ok)trace.failures.push(name);return!!ok;};
  const authored=()=>db.transaction('r',db.tables,async()=>JSON.stringify(await Promise.all(db.tables.filter(t=>!['worldSnapshots','canonTiles','renderedTiles'].includes(t.name)).map(async t=>[t.name,await t.toArray()]))));
  const sibling=()=>db.transaction('r',db.tables,async()=>JSON.stringify(await Promise.all(db.tables.map(async t=>[t.name,(await t.toArray()).filter(row=>row.id===siblingId||row.projectId===siblingId)]))));
  const siblingBefore=await sibling();
  async function call(tool:string,args:Record<string,unknown>){const before=await authored();const response=await runBridgeTool(tool,args);const record={tool,args,response,authoredBefore:before,authoredAfter:await authored()};trace.calls.push(record);return record;}
  async function success(tool:string,args:Record<string,unknown>){const record=await call(tool,args);require(record.response.ok,'HEALTH: '+tool+' '+record.response.code+' '+record.response.error);return record.response.result as any;}
  async function state(worldId:string){
    const deadline=Date.now()+150000;
    while(Date.now()<deadline){const row=await db.generatedWorlds.get(worldId);require(row?.projectId===projectId,'Own world required');const opened=await openWorldForReading(row,'full');if(!opened.ok){await pause(40);continue;}
      const data=structuredClone(opened.world.data);
      const grids=await Promise.all(DOMAIN_GRIDS.map(async field=>{const values=data[field];require(values&&values.length===data.width*data.height,'Real14grid '+field);return{field,sha256:await sha(new Uint8Array(values.buffer,values.byteOffset,values.byteLength))};}));
      return{rowEdits:row.edits,params:row.params,domain:data.domain??null,width:data.width,height:data.height,grids,edits:deserializeEdits(row.edits??''),elevation:Array.from(data.elevation),biome:Array.from(data.biome),lake:Array.from(data.lake)};
    }throw Error('HEALTH: normal reader readiness deadline');
  }
  const compact=(s:any)=>({...s,elevation:undefined,biome:undefined,lake:undefined});
  async function undo(record:any,before:any,worldId:string){
    if(!record.response.ok)return;
    const audit=record.response.result?.__audit;require(audit,'CLEANUP: successful writer needs actual audit');
    record.undo=await runBridgeTool('__undo',{entry:{...audit,tool:record.tool,kind:'update'}});require(record.undo.ok,'CLEANUP: actual public Undo failed '+record.undo.error);
    const restored=await state(worldId);record.restored=compact(restored);require(same(restored.edits,before.edits)&&same(restored.grids,before.grids),'CLEANUP: Undo must restore active edits and14RAW');
  }
  async function writer(tool:string,args:Record<string,unknown>,predicate:(record:any,after:any,before:any)=>boolean,name:string,health=false){
    const worldId=String(args.worldId),before=await state(worldId),record:any=await call(tool,args);record.before=compact(before);const after=await state(worldId);record.after=compact(after);const ok=predicate(record,after,before);record.criterion=name;record.criterionPassed=ok;
    await undo(record,before,worldId);
    if(health)require(ok,'HEALTH: '+name);else check(ok,name,{response:record.response});
    return record;
  }
  const rejected=(record:any,after:any,before:any)=>!record.response.ok&&record.response.code==='bad-args'&&record.authoredBefore===record.authoredAfter&&!record.response.result?.__audit&&same(after.rowEdits,before.rowEdits)&&same(after.grids,before.grids);
  async function family(name:string,fn:()=>Promise<void>){try{await fn();}catch(error){trace.healthFailures.push({family:name,error:error instanceof Error?error.stack:String(error)});}}
  try{
    const legacy=await success('wh_create_world',{projectId,title:'Own legacy coordinate control',preset:'blankLand',seed:'own-coordinate-legacy',width:1024});
    const portrait=await success('wh_create_world',{projectId,title:'Own portrait coordinate family',preset:'blankLand',seed:'own-coordinate-portrait',sheetSize:{widthKm:320,heightKm:640,resolution:64}});
    const landscape=await success('wh_create_world',{projectId,title:'Own landscape stroke family',preset:'blankLand',seed:'own-coordinate-landscape',sheetSize:{widthKm:640,heightKm:320,resolution:64}});
    trace.worlds={legacy,portrait,landscape};
    const scope=(worldId:string)=>({projectId,worldId});
    const pg=scope(portrait.worldId),lg=scope(legacy.worldId),sg=scope(landscape.worldId);
    await family('descriptor',async()=>{
      const legacyRead=await call('wh_get_world',lg);const lr:any=legacyRead.response.result;
      require(legacyRead.response.ok&&lr.width===1024&&lr.height===512&&legacyRead.authoredBefore===legacyRead.authoredAfter,'HEALTH: public legacy descriptor');
      const domain=await success('wh_get_world_domain',pg);require(domain.bounds.width===32&&domain.bounds.height===64&&domain.source.width===128&&domain.cellKm===10,'HEALTH: actual portrait domain');
      const before=await state(portrait.worldId),read=await call('wh_get_world',pg),value:any=read.response.result,after=await state(portrait.worldId);
      check(read.response.ok&&value.width===32&&value.height===64&&value.sheet===true&&value.physicalScale.width===32&&value.physicalScale.height===64&&value.physicalScale.cellKm===10,'PORTRAIT_DESCRIPTOR_ACTIVE_EXTENT',{domain,value});
      check(read.authoredBefore===read.authoredAfter&&same(before,after),'PORTRAIT_DESCRIPTOR_READONLY');
    });
    const grown=await success('wh_resize_world',{...pg,widthKm:400,heightKm:650,anchor:'north-west',fill:'sea',expectedRevision:0});require(grown.domain.bounds.width===40&&grown.domain.bounds.height===65,'HEALTH: actual public grow40x65');trace.grown=grown;
    await family('grown descriptor',async()=>{
      const read=await call('wh_get_world',pg),v:any=read.response.result,actual=await success('wh_get_world_domain',pg);
      check(read.response.ok&&v.width===40&&v.height===65&&v.sheet===true&&v.physicalScale.width===40&&v.physicalScale.height===65&&actual.bounds.width===40&&actual.bounds.height===65,'GROWN_DESCRIPTOR_ACTIVE_EXTENT',{value:v,actual});
      check(read.authoredBefore===read.authoredAfter,'GROWN_DESCRIPTOR_READONLY');
    });
    await family('cellCoords',async()=>{
      const interior=await call('wh_place_at',{...pg,x:8,y:8});const iv:any=interior.response.result;require(interior.response.ok&&iv.x===8&&iv.y===8&&interior.authoredBefore===interior.authoredAfter,'HEALTH: cell readonly interior');
      const labelPredicate=(x:number,y:number)=>(record:any,after:any,before:any)=>{const labels=after.edits.slice(before.edits.length).filter((e:any)=>e.kind==='label');return record.response.ok&&labels.length===1&&labels[0].x===x+(before.domain?.bounds.x??0)&&labels[0].y===y+(before.domain?.bounds.y??0)&&record.response.result?.x===x&&record.response.result?.y===y;};
      await writer('wh_add_label',{...pg,x:8,y:8,text:'Own interior healthy',style:'note'},labelPredicate(8,8),'cell writer interior audit/Undo',true);
      await writer('wh_add_label',{...lg,x:-.25,y:8,text:'Own legacy fraction',style:'note'},labelPredicate(0,8),'legacy cell rounded fraction/audit/Undo',true);
      const cases=[
        {name:'VALID_LAST_CELL',x:39,y:64,want:[39,64]},
        {name:'ORIGINAL_NEGATIVE_X',x:-.25,y:8},
        {name:'ORIGINAL_X_EQUALS_W',x:40,y:8},
        {name:'ORIGINAL_NEGATIVE_Y',x:8,y:-.25},
        {name:'ORIGINAL_Y_EQUALS_H',x:8,y:65},
        {name:'INSIDE_X_CLAMPS_LAST',x:39.9,y:8,want:[39,8]},
        {name:'INSIDE_Y_CLAMPS_LAST',x:8,y:64.9,want:[8,64]},
      ];
      for(const item of cases){
        const read=await call('wh_place_at',{...pg,x:item.x,y:item.y}),v:any=read.response.result;
        check(read.authoredBefore===read.authoredAfter,'CELL_READONLY_'+item.name);
        check(item.want?read.response.ok&&v.x===item.want[0]&&v.y===item.want[1]:!read.response.ok&&read.response.code==='bad-args','CELL_READER_'+item.name,{response:read.response});
        await writer('wh_add_label',{...pg,x:item.x,y:item.y,text:'Own '+item.name,style:'note'},item.want?labelPredicate(item.want[0],item.want[1]):rejected,'CELL_WRITER_'+item.name);
      }
    });
    await family('strokeCells',async()=>{
      const terrain=(point:{x:number;y:number})=>({...sg,op:'height',heightM:550,points:[point],radius:1.5,strength:1});
      const terrainPositive=(record:any,after:any,before:any)=>record.response.ok&&after.edits.length===before.edits.length+1&&after.edits.at(-1).kind==='terrain'&&after.grids.find((x:any)=>x.field==='elevation').sha256!==before.grids.find((x:any)=>x.field==='elevation').sha256;
      await writer('wh_shape_terrain',terrain({x:63,y:16}),terrainPositive,'stroke lawful east edge changes terrain/Undo',true);
      await writer('wh_shape_terrain',terrain({x:0,y:16}),terrainPositive,'stroke lawful west edge changes terrain/Undo',true);
      await writer('wh_shape_terrain',{...terrain({x:-1,y:256}),...lg},(record:any,after:any,before:any)=>record.response.ok&&after.edits.at(-1)?.stroke.pts[0].x===1023.5&&terrainPositive(record,after,before),'legacy stroke wraps exterior/Undo',true);
      for(const x of[-1,64])await writer('wh_shape_terrain',terrain({x,y:16}),rejected,'STROKE_ORIGINAL_X_'+x+'_REJECTS_NO_WRITE');
    });
    await family('paintBiome',async()=>{
      const s=await state(landscape.worldId);require(s.width===64&&s.height===32,'HEALTH: landscape active/source geometry');
      const find=(x:number)=>{for(let y=2;y<s.height-2;y++)if(s.elevation[y*s.width+x]>0&&!s.lake[y*s.width+x])return{x,y,biome:BIOME_KEY[s.biome[y*s.width+x]]==='desert'?'grassland':'desert'};return null;};
      const east=find(63),west=find(0);require(east&&west,'HEALTH: actual dry edge cells for biome');trace.biomeHealth={east,west};
      const positive=(record:any,after:any,before:any)=>record.response.ok&&after.edits.length===before.edits.length+1&&after.edits.at(-1)?.kind==='biome'&&after.grids.find((x:any)=>x.field==='biome').sha256!==before.grids.find((x:any)=>x.field==='biome').sha256;
      const paint=(x:number,y:number,biome:string)=>({...sg,points:[{x,y}],radius:1.5,biome});
      await writer('wh_paint_biome',paint(east.x,east.y,east.biome),positive,'biome lawful east edge changes actual grid/Undo',true);
      await writer('wh_paint_biome',paint(west.x,west.y,west.biome),positive,'biome lawful west edge changes actual grid/Undo',true);
      const legacyData=await state(legacy.worldId);let legacyPoint:any;
      for(let y=2;y<legacyData.height-2;y++)if(legacyData.elevation[y*legacyData.width+legacyData.width-1]>0&&!legacyData.lake[y*legacyData.width+legacyData.width-1]){legacyPoint={x:-1,y,biome:BIOME_KEY[legacyData.biome[y*legacyData.width+legacyData.width-1]]==='desert'?'grassland':'desert'};break;}
      require(legacyPoint,'HEALTH: legacy dry biome exterior alias');
      await writer('wh_paint_biome',{...paint(legacyPoint.x,legacyPoint.y,legacyPoint.biome),...lg},(record:any,after:any,before:any)=>positive(record,after,before)&&after.edits.at(-1)?.stroke.pts[0].x===1023,'legacy biome wraps exterior/Undo',true);
      await writer('wh_paint_biome',paint(-1,east.y,east.biome),rejected,'BIOME_ORIGINAL_NEGATIVE_X_REJECTS_NO_WRITE');
      await writer('wh_paint_biome',paint(64,west.y,west.biome),rejected,'BIOME_ORIGINAL_X_EQUALS_W_REJECTS_NO_WRITE');
    });
    check(await sibling()===siblingBefore,'OTHER_OWN_PROJECT_LITERAL');
  }finally{
    for(const id of[projectId,siblingId]){require((await db.projects.get(id))?.description===marker,'CLEANUP: own marker');await deleteProject(id);}
    window.Worker=OriginalWorker;
    const counts:Record<string,number>={};for(const table of db.tables)counts[table.name]=await table.count();trace.cleanup={counts,empty:Object.values(counts).every(x=>x===0),workers:{created,terminated,live:live.size}};
    require(trace.cleanup.empty&&live.size===0,'CLEANUP: own profile rows/Workers remain');
  }
  require(trace.healthFailures.length===0,'Coordinate family health: '+JSON.stringify(trace.healthFailures));
  require(trace.failures.length===0,'Coordinate family criteria: '+trace.failures.join('; '));
  return trace;
}
