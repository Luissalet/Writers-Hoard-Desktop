// Actual Vite Workers, pipeline and mounted React hooks. Own isolated renderer only.
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {getGeography} from '@/engines/worldgen/cartography/texture';
import {RegionWorkerClient} from '@/engines/worldgen/region/client';
import {tileGeometry,tileWindow,canonParams,tileKey} from '@/engines/worldgen/region/tiles';
import {mapSourceKey} from '@/engines/worldgen/region/contentIdentity';
import {useJourneyComputation,useJourneyPaleo} from '@/engines/worldgen/useJourneyComputation';
import {check} from './worldgen-scale-contract.browser';

async function hash(value:unknown):Promise<string>{
 const bytes=ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):new TextEncoder().encode(JSON.stringify(value));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function hashes(region:Record<string,unknown>){const result:Record<string,string>={};for(const [key,value]of Object.entries(region))result[key]=await hash(value);return result;}
async function wait(predicate:()=>boolean,label:string){const end=Date.now()+90000;while(!predicate()){if(Date.now()>end)throw Error('Deadline '+label);await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});}}
export async function testWorker(){
 const world=generateWorld({...DEFAULT_PARAMS,width:512,seed:'own-scale-canon-worker',worldKm:2048,starter:'land'}),geo=getGeography(world,'places'),id={tx:10,ty:10},clients:RegionWorkerClient[]=[];
 const client=()=>{const next=new RegionWorkerClient(2,1);clients.push(next);return next;};
 let root:ReturnType<typeof createRoot>|undefined;
 try{
  const a=client(),geometry=tileGeometry(world,id),window=tileWindow(world,id),options={geometry,canonKey:tileKey(id),params:canonParams(world,{habitation:0,sites:'auto'}),edits:'[]'};
  const identity=mapSourceKey(world,geo,'[]'),start=performance.now();
  const cold=await a.request(world,geo,window,options).promise,coldHash=await hashes(cold as unknown as Record<string,unknown>),firstMs=performance.now()-start;
  const warm=await a.request(world,geo,window,options).promise;check(warm===cold,'Warm canon did not use resident cache');
  world.mapWidthKm=4096;world.scaleRevision=1;
  check(mapSourceKey(world,geo,'[]')===identity&&JSON.stringify(tileGeometry(world,id))===JSON.stringify(geometry),'Canon identity/geometry changed');
  check(await a.request(world,geo,window,options).promise===cold,'Scale evicted warm canon');
  a.dispose();check(a.workerSessionCount===0&&a.cacheSize===0,'First worker/cache not closed');
  await new Promise(resolve=>setTimeout(resolve,2100));
  const b=client(),secondStart=performance.now(),reopened=await b.request(world,geo,tileWindow(world,id),{...options,geometry:tileGeometry(world,id)}).promise;
  const reopenedHash=await hashes(reopened as unknown as Record<string,unknown>);check(JSON.stringify(coldHash)===JSON.stringify(reopenedHash),'Full cold canon fields/arrays differ after calibration');
  const free=await b.request(world,geo,{cx:42,cy:42,spanKm:80},{params:{res:64,aspect:1,habitation:0,sites:'auto'}}).promise;
  check(Math.abs(free.worldPerCellX-80/(4096/world.width)/64)<1e-12&&Math.abs(free.metresPerCell-1250)<1e-9&&free.window.spanKm===80,'Freeform physical window not projected');
  b.dispose();
  // Controlled flat/no-water terrain for exact ratios, with real worker transport and hooks.
  const flat={...world,mapWidthKm:2048,scaleRevision:0,elevation:world.elevation.map(()=>.1),biome:world.biome.map(()=>7),temperature:world.temperature.map(()=>18),precipitation:world.precipitation.map(()=>600),rivers:[],flow:world.flow.map(()=>0),lake:world.lake.map(()=>0),lakeSurface:world.lakeSurface?.map(()=>0)},travelGeo={roads:[],settlements:[],ruins:[],realms:[],realmOf:new Int32Array(world.width*world.height)};
  const from={x:20,y:20,name:'A'},to={x:23,y:24,name:'B'},via:never[]=[],opts={mode:'foot' as const,season:'summer' as const,planetRadiusKm:6371},paleo={ice:0,seaLevelM:500};let latest:any,paleoLatest:any;
  function Surface(){latest=useJourneyComputation(flat,travelGeo as any,from as any,to as any,via,opts,false,'en');paleoLatest=useJourneyPaleo(flat,paleo,'en');return <output>{JSON.stringify({km:latest.route?.km,busy:latest.busy,paleo:paleoLatest.description})}</output>;}
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<Surface/>));await wait(()=>!latest.busy&&!paleoLatest.busy,'initial mounted jobs');const before=latest.route,description=paleoLatest.description;check(before&&!before.impossible,'Actual worker route unavailable');
  flat.mapWidthKm=4096;flat.scaleRevision=1;await act(async()=>root!.render(<Surface/>));await wait(()=>!latest.busy&&!paleoLatest.busy,'recalibrated mounted jobs');
  check(Math.abs(latest.route.km/before.km-2)<1e-9&&Math.abs(latest.route.hours/before.hours-2)<1e-9&&JSON.stringify(before.cells)===JSON.stringify(latest.route.cells),'Mounted worker route stale');
  check(paleoLatest.description!==description,'Mounted paleo readout unchanged');
  await act(async()=>root!.unmount());root=undefined;host.remove();
  return {identity,geometry,firstMs,secondMs:performance.now()-secondStart,coldHash,reopenedHash,freeform:{spanKm:free.window.spanKm,metresPerCell:free.metresPerCell,worldPerCellX:free.worldPerCellX},mountedRoute:{beforeKm:before.km,afterKm:latest.route.km,beforeHours:before.hours,afterHours:latest.route.hours},mountedPaleo:{before:description,after:paleoLatest.description},closed:clients.every(c=>c.workerSessionCount===0&&c.cacheSize===0)};
 }finally{if(root)await act(async()=>root!.unmount());for(const c of clients)c.dispose();}
}
