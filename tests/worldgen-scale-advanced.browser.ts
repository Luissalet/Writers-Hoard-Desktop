import {db} from '@/db';
import Dexie from 'dexie';
import {makeFixture,call,check} from './worldgen-scale-contract.browser';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {undoAuditEntry} from '@/services/aiBridge/undo';
import {saveWorldScale,getWorldScale,revertWorldScale} from '@/engines/worldgen/worldScale';
import {createWorldEditWriter} from '@/engines/worldgen/editWriter';
import {worldRuntimeKey} from '@/engines/worldgen/era';
import {mutateEraRows,readEraRow} from '@/services/worldEras/store';
import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {planRoute} from '@/engines/worldgen/core/travel';
import {applyWorldScaleMetadata,mapMetric} from '@/engines/worldgen/core/geoScale';
import {autoSites} from '@/engines/worldgen/core/economy';
import {getGeography} from '@/engines/worldgen/cartography/texture';
import {elevKmToY} from '@/engines/worldgen/sculpt/scene3d';
import {viewportToCartaCamera} from '@/engines/worldgen/core/camera';
import {placeReference} from '@/engines/worldgen/core/scaleReference';

function value(result:unknown){return result as Record<string,any>;}
export async function testAdvanced(){
 const f=await makeFixture();const checks:string[]=[];
 try{
  const source=await getWorldScale({projectId:f.P},f.W);
  const row=await db.generatedWorlds.get(f.W),before=JSON.stringify(row);
  for(const width of [0,-1,Number.MIN_VALUE,Number.MAX_VALUE,Infinity,NaN]){let bad=false;try{await saveWorldScale({projectId:f.P},f.W,width,source.revision);}catch{bad=true;}check(bad,'Invalid metric accepted '+width);check(JSON.stringify(await db.generatedWorlds.get(f.W))===before,'Invalid value mutated record');}
  check(await Dexie.exists(db.name),'Actual Dexie profile not open');
  let aborted=false;try{await db.transaction('rw',db.tables,async()=>{await saveWorldScale({projectId:f.P},f.W,3000,0);throw Error('Outer abort');});}catch{aborted=true;}check(aborted&&JSON.stringify(await db.generatedWorlds.get(f.W))===before,'Outer transaction published a calibration');checks.push('Invalid/overflow/underflow input and outer transaction refusal preserve exact row');
  const created=await runBridgeTool('wh_set_world_scale',{worldId:f.W,projectId:f.P,widthKm:4096,expectedRevision:0});check(created.ok,'Public set failed');const audit=value(created.result).__audit;
  await db.generatedWorlds.update(f.W,{title:'Concurrent title',presentation:{clouds:true},updatedAt:99});
  await undoAuditEntry({entry:{...audit,tool:'wh_set_world_scale',kind:'update'}});
  const undone=await getWorldScale({projectId:f.P},f.W);check(undone.widthKm===2048&&undone.revision===2,'Undo revision/metric');const kept=await db.generatedWorlds.get(f.W);check(kept?.title==='Concurrent title'&&kept.presentation?.clouds,'Undo lost concurrent metadata');
  await saveWorldScale({projectId:f.P},f.W,4096,2);let aba=false;try{await undoAuditEntry({entry:{...audit,tool:'wh_set_world_scale',kind:'update'}});}catch{aba=true;}check(aba&&(await getWorldScale({projectId:f.P},f.W)).revision===3,'Old receipt undid ABA');
  const reset=await saveWorldScale({projectId:f.P},f.W,null,3);check(reset.revision===4&&!Object.hasOwn((await db.generatedWorlds.get(f.W))!,'mapWidthKm'),'Reset did not remove override');const no=JSON.stringify(await db.generatedWorlds.get(f.W)),noop=await runBridgeTool('wh_set_world_scale',{worldId:f.W,widthKm:null,expectedRevision:4});check(noop.ok&&!value(noop.result).__audit&&JSON.stringify(await db.generatedWorlds.get(f.W))===no,'Noop created Undo or changed row');checks.push('Real public Undo retains title/look; reset removes override; revisions reject ABA; noop has no audit envelope/history change');
  // The requested era inherits before flush; this pending writer materializes it.
  const writer=createWorldEditWriter(worldRuntimeKey(f.W,'past'),async()=>{await mutateEraRows({projectId:f.P,eraId:'past'},[{table:'generatedWorlds',id:f.W,changes:{title:'Variant created during drain'}}]);},60000);writer.schedule('pending');
  try{const receipt=await saveWorldScale({projectId:f.P,eraId:'past'},f.W,604.8,4);check(receipt.scope.eraId==='past','Flush-created variant wrote Base');check((await getWorldScale({projectId:f.P},f.W)).widthKm===2048&&(await getWorldScale({projectId:f.P,eraId:'past'},f.W)).widthKm===604.8,'Wrong flush owner');await revertWorldScale({projectId:f.P,eraId:'past'},f.W,receipt);}finally{await writer.flush();}
  const regionWriter=createWorldEditWriter('regions:'+f.W,async()=>{await db.generatedWorlds.update(f.W,{regions:[{...f.world.regions![0],title:'Late exact region'}]});},60000);regionWriter.schedule('pending');try{await saveWorldScale({projectId:f.P},f.W,4096,4);check((await db.generatedWorlds.get(f.W))?.regions?.[0].title==='Late exact region','Pending region lost');}finally{await regionWriter.flush();}
  let scope=false;try{await getWorldScale({projectId:'other-project'},f.W);}catch{scope=true;}check(scope,'Cross-project scale accepted');checks.push('Pending era writer changes owner during flush; Base remains; pending regions preserved; foreign project rejected');
  const pastNow=await getWorldScale({projectId:f.P,eraId:'past'},f.W),pastReceipt=await saveWorldScale({projectId:f.P,eraId:'past'},f.W,3000,pastNow.revision);
  const pastVariant=await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([f.P,'past','worldgen',f.W]).first();check(pastVariant,'Missing owned era');
  await db.worldEraVariants.update(pastVariant.id,{archived:true});await db.generatedWorlds.update(f.W,{mapWidthKm:pastReceipt.afterOverride!,scaleRevision:pastReceipt.revision});
  let archived=false;try{await revertWorldScale({projectId:f.P,eraId:'past'},f.W,pastReceipt);}catch{archived=true;}check(archived&&(await db.worldEraVariants.get(pastVariant.id))?.archived===true,'Undo recreated an archived era owner from matching Base metric');checks.push('Undo does not resurrect archived owner even if inherited Base has matching metric/revision');
  const world=generateWorld(f.world.params),geo=getGeography(world,'places'),positions=[{x:20,y:20},{x:23,y:24}];
  // Controlled flat/no-river routing fixture built from actual pipeline arrays; no inferred universal path claim.
  const flat={...world,elevation:world.elevation.map(()=>.1),biome:world.biome.map(()=>5),temperature:world.temperature.map(()=>18),precipitation:world.precipitation.map(()=>600),rivers:[],flow:world.flow.map(()=>0),lake:world.lake.map(()=>0),lakeSurface:world.lakeSurface?.map(()=>0)};
  const travelGeo={roads:[],settlements:[],ruins:[],realms:[],realmOf:new Int32Array(world.width*world.height)};
  const opts={mode:'foot' as const,season:'summer' as const,planetRadiusKm:6371};
  const first=planRoute(flat,travelGeo,positions[0],positions[1],opts);flat.mapWidthKm=4096;const second=planRoute(flat,travelGeo,positions[0],positions[1],opts);check(Math.abs(second.km/first.km-2)<1e-9&&Math.abs(second.hours/first.hours-2)<1e-9&&JSON.stringify(second.cells)===JSON.stringify(first.cells),'Same-object metric cache remained stale '+JSON.stringify({first,second}));
  const places=[{id:1,x:24,y:20,name:'Own town',rank:'town' as const,population:1000,port:false}],input={world,places,seed:world.params.seed};const sites=JSON.stringify(autoSites(input));world.mapWidthKm=4096;check(JSON.stringify(autoSites(input))===sites,'Automatic site IDs/coordinates changed');
  const viewport={u:.3,v:.4,spanKm:6000},camera=viewportToCartaCamera(viewport,world,800,400,.01,1000);world.mapWidthKm=604.8;check(JSON.stringify(viewportToCartaCamera(viewport,world,800,400,.01,1000))===JSON.stringify(camera),'Normalized camera footprint moved');
  const rings=[[[0,0],[1,0],[1,1],[0,1],[0,0]]],a=placeReference(rings,.5,.5,undefined,undefined,mapMetric(world));world.mapWidthKm=1209.6;const b=placeReference(rings,.5,.5,undefined,undefined,mapMetric(world));check(Math.abs((a.rings[0][1][0]-.5)/(b.rings[0][1][0]-.5)-2)<1e-9,'Physical outline not recalibrated');
  check(elevKmToY(18,128)>0&&geo.settlements!==undefined,'Actual pipeline geography unavailable');
  checks.push('Actual pipeline plus explicitly controlled flat route: memoized object with fixed radius doubles km/hours; autoSite IDs/coords raw exact; camera cells unchanged and outline true size');
  return checks;
 }finally{await f.cleanup();}
}
