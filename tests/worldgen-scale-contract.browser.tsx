// Independent pre-product oracle. Calls public handlers; never supplies a scale implementation.
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { createWorldEditWriter } from '@/engines/worldgen/editWriter';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { mutateEraRows } from '@/services/worldEras/store';
import type { GeneratedWorld } from '@/engines/worldgen/types';

export function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
export async function call(name: string, args: Record<string, unknown>) {
  const reply = await runBridgeTool(name, args);
  check(reply.ok, `${name}: ${reply.code}: ${reply.error}`);
  return reply.result as Record<string, any>;
}
export function terrainRecord(record: Record<string, unknown>) {
  const { mapWidthKm, scaleRevision, updatedAt, ...rest } = record;
  return JSON.stringify(rest);
}
export async function makeFixture() {
  const P = `qa-scale-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, W = P+'-world';
  await db.projects.add({id:P,title:P,description:'Own isolated scale oracle',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen'],engineOrder:['worldgen'],createdAt:1,updatedAt:1,worldEras:[{id:'past',name:'Past',description:'',revision:1,createdAt:1,updatedAt:1}]});
  const world: GeneratedWorld = {id:W,projectId:P,title:'QA scale terrain',params:{...DEFAULT_PARAMS,seed:'scale-original',width:128,starter:'land',worldKm:2048},edits:JSON.stringify([{kind:'placesEverywhere',enabled:false},{kind:'marker',marker:'settlement',x:24,y:20,rank:'village',name:'Retained village'},{kind:'label',x:28,y:20,text:'Exact note',style:'note'}]),regions:[{id:P+'-region',title:'Exact region',x:30,y:20,spanKm:80,params:{res:640,aspect:1.55,detail:.8,settled:.6,habitation:1,streamDensity:.7},createdAt:1,updatedAt:1}],thumbnail:'data:image/png;base64,own-sentinel',createdAt:1,updatedAt:1};
  await db.generatedWorlds.add(world);
  await db.worldWaypoints.add({id:P+'-pin',projectId:P,worldId:W,name:'Exact pin',u:.25,v:.375,color:'#777777',createdAt:1,updatedAt:1});
  return {P,W,world,cleanup:()=>deleteProject(P)};
}

export async function testWorldScaleContracts() {
  const f=await makeFixture();
  try {
    // Baseline causal RED is unknown-tool here. Do not accept it as a successful skip.
    const base=await call('wh_get_world_scale',{worldId:f.W,projectId:f.P});
    check(base.widthKm===2048 && base.heightKm===1024 && base.cellKm===16,'Source scale must reflect the actual 128×64 grid');
    const pins=JSON.stringify(await db.worldWaypoints.where('worldId').equals(f.W).toArray());
    const raw=terrainRecord((await db.generatedWorlds.get(f.W))! as unknown as Record<string,unknown>);
    const points=[{x:20,y:20},{x:23,y:24}];
    const square=[{x:20,y:20},{x:30,y:20},{x:30,y:30},{x:20,y:30}];
    const oldDistance=await call('wh_measure_world',{worldId:f.W,points});
    const oldArea=await call('wh_measure_world',{worldId:f.W,points:square});
    check(oldDistance.totalKm===80 && oldArea.areaKm2===25600,'Independent 3-4-5 and area baseline');
    await call('wh_set_world_scale',{worldId:f.W,projectId:f.P,widthKm:4096,expectedRevision:base.revision});
    const doubled=await call('wh_get_world_scale',{worldId:f.W});
    check(doubled.widthKm===4096 && doubled.heightKm===2048 && doubled.cellKm===32,'Scale must double metric, not counts');
    check(terrainRecord((await db.generatedWorlds.get(f.W))! as unknown as Record<string,unknown>)===raw,'Scale changed params/seed/edits/regions/thumbnail or other authored fields');
    check(JSON.stringify(await db.worldWaypoints.where('worldId').equals(f.W).toArray())===pins,'Scale rewrote pin u/v or identity');
    const distance=await call('wh_measure_world',{worldId:f.W,points}), area=await call('wh_measure_world',{worldId:f.W,points:square});
    check(distance.totalKm===160 && area.areaKm2===102400,'Public ruler did not use the saved metric');
    const stale=await runBridgeTool('wh_set_world_scale',{worldId:f.W,widthKm:8192,expectedRevision:base.revision});
    check(!stale.ok && stale.code==='conflict','A stale scale must fail without replacing newer scale');
    const beforeNoop=JSON.stringify(await db.generatedWorlds.get(f.W));
    await call('wh_set_world_scale',{worldId:f.W,widthKm:4096,expectedRevision:doubled.revision});
    check(JSON.stringify(await db.generatedWorlds.get(f.W))===beforeNoop,'Noop scale wrote history/revision/timestamp');
    const writer=createWorldEditWriter(f.W,async edits=>{await db.generatedWorlds.update(f.W,{edits});},60_000);
    const pending=f.world.edits!.slice(0,-1)+',{"kind":"label","x":32,"y":22,"text":"Late exact note","style":"note"}]';
    writer.schedule(pending);
    try {
      await call('wh_set_world_scale',{worldId:f.W,widthKm:604.8,expectedRevision:doubled.revision});
      check((await db.generatedWorlds.get(f.W))?.edits===pending,'Scale did not drain/retain pending edit writer');
    } finally { await writer.flush(); }
    const inherited=await call('wh_get_world_scale',{worldId:f.W,projectId:f.P,eraId:'past'});
    check(!inherited.scope?.eraId,'Inherited settings must resolve Base without implicit variant');
    const variants=await db.worldEraVariants.where('projectId').equals(f.P).toArray();
    check(variants.length===0,'A getter created an era variant');
    await call('wh_set_world_scale',{worldId:f.W,projectId:f.P,eraId:'past',widthKm:900,expectedRevision:inherited.revision});
    check((await call('wh_get_world_scale',{worldId:f.W,projectId:f.P})).widthKm===900,'Inherited-era setting did not update its Base owner');
    check((await db.worldEraVariants.where('projectId').equals(f.P).toArray()).length===0,'Inherited setting implicitly created a variant');
    const baseAgain=await call('wh_get_world_scale',{worldId:f.W,projectId:f.P});
    await call('wh_set_world_scale',{worldId:f.W,projectId:f.P,widthKm:604.8,expectedRevision:baseAgain.revision});
    await mutateEraRows({projectId:f.P,eraId:'past'},[{table:'generatedWorlds',id:f.W,changes:{title:'Owned era terrain'}}]);
    const own=await call('wh_get_world_scale',{worldId:f.W,projectId:f.P,eraId:'past'});
    check(own.scope?.eraId==='past','Own variant must receive own settings');
    await call('wh_set_world_scale',{worldId:f.W,projectId:f.P,eraId:'past',widthKm:1209.6,expectedRevision:own.revision});
    check((await call('wh_get_world_scale',{worldId:f.W,projectId:f.P})).widthKm===604.8,'Own-era write leaked into Base');
    return ['Public dispatcher scale changes metric×2/area×4 while authored row and pin bytes remain exact','CAS/noop/pending writer and inherited Base versus owned-era settings preserve their actual contracts'];
  } finally { await f.cleanup(); }
}
