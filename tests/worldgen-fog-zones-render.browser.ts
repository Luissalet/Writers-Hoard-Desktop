import {renderCartoCanvas} from '../src/engines/worldgen/cartography/texture';
import {THEME_SURVEY} from '../src/engines/worldgen/cartography/theme';
import {drawReaderFog} from '../src/engines/worldgen/cartography/readerFogLayer';
import {fogMask} from '../src/engines/worldgen/core/readerFog';
import {generateWorld} from '../src/engines/worldgen/core/pipeline';
import {DEFAULT_PARAMS,type WorldData} from '../src/engines/worldgen/core/types';
import {adoptDomainDocument} from '../src/engines/worldgen/core/domainDocument';
import {domainSourceKey} from '../src/engines/worldgen/core/worldDomain';
import {DOMAIN_GRIDS,replayDomain} from '../src/engines/worldgen/core/domainReplay';
import type {WorldZone} from '../src/engines/worldgen/core/zones';
import type {WorldEdit} from '../src/engines/worldgen/core/edits';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const need=(v:unknown,m:string)=>{if(!v)throw Error('HEALTH '+m);};
const sha=async(v:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',v)),n=>n.toString(16).padStart(2,'0')).join('');
const signature=async(w:WorldData)=>({meta:JSON.stringify({params:w.params,domain:w.domain,width:w.width,height:w.height,revision:w.revision}),grids:await Promise.all(DOMAIN_GRIDS.map(k=>{const a=w[k]!;return sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}))});
type Point={x:number;y:number};
type Observed={path:Point[];polygons:Point[][];titles:{text:string;x:number;y:number}[];images:{x:number;y:number;width:number;height:number;sourceWidth:number;sourceHeight:number}[]};
export async function run(){
 await document.fonts.ready;
 const legacy=generateWorld({...DEFAULT_PARAMS,width:64,seed:'own-fog-zones-canvas-r1',starter:'land',erosion:0,glaciation:0});
 const documentDomain=adoptDomainDocument(legacy,'',{version:1,sourceKey:domainSourceKey(legacy.params,''),entries:[]},{x:0,y:0,width:64,height:32});
 const finite=replayDomain(legacy,documentDomain,1),before=await Promise.all([signature(legacy),signature(finite)]);
 need(finite.domain?.topology==='finite'&&same(before[0].grids,before[1].grids),'real finite replay/14 arrays');
 const diagnostic:any={before,observations:{},failures:[]};Reflect.set(window,'__fogZonesRenderDiagnostic',diagnostic);
 const proto=CanvasRenderingContext2D.prototype,names=['beginPath','moveTo','lineTo','stroke','fillText','drawImage'] as const;
 const descriptors=names.map(n=>[n,Object.getOwnPropertyDescriptor(proto,n)!] as const),records=new WeakMap<CanvasRenderingContext2D,Observed>(),canvases:HTMLCanvasElement[]=[];
 const rec=(ctx:CanvasRenderingContext2D)=>{let r=records.get(ctx);if(!r){r={path:[],polygons:[],titles:[],images:[]};records.set(ctx,r);}return r;};
 const small:WorldZone={id:'own-small',name:'Own zone',color:'#0a84e1',pattern:'outline',opacity:1,pts:[{x:2,y:10},{x:6,y:10},{x:6,y:14},{x:2,y:14}]};
 const wide:WorldZone={...small,id:'own-wide',pts:[{x:2,y:10},{x:60,y:10},{x:60,y:18},{x:2,y:18}]};
 const fog:WorldEdit={kind:'fog',op:'seen',chapter:1,stroke:{pts:[{x:2.5,y:10.5}],radius:2.5,softness:0.35,strength:1}};
 const mask=fogMask([fog],64,32,'blank',1),layer={mask,width:64,height:32,mode:'reader' as const};
 const sx=(x:number)=>(x+10)*10,sy=(y:number)=>y*10;
 const visible=(p:Point[])=>p.length>0&&Math.max(...p.map(q=>q.x))>0&&Math.min(...p.map(q=>q.x))<800&&Math.max(...p.map(q=>q.y))>0&&Math.min(...p.map(q=>q.y))<320;
 try{
  for(const[name,d]of descriptors)Object.defineProperty(proto,name,{...d,value:function(this:CanvasRenderingContext2D,...args:any[]){
   const r=rec(this);if(name==='beginPath')r.path=[];
   if(name==='moveTo'||name==='lineTo')r.path.push({x:args[0],y:args[1]});
   if(name==='stroke'&&['#0a84e1','rgba(10, 132, 225, 1)'].includes(String(this.strokeStyle))&&r.path.length===4)r.polygons.push(r.path.map(p=>({...p})));
   if(name==='fillText'&&String(args[0]).replace(/\u2009/g,'')==='OWN ZONE')r.titles.push({text:args[0],x:args[1],y:args[2]});
   if(name==='drawImage'){const image=args[0] as CanvasImageSource&{width?:number;height?:number};if(image.width===64&&image.height===32&&args.length===9)r.images.push({x:args[5],y:args[6],width:args[7],height:args[8],sourceWidth:image.width,sourceHeight:image.height});}
   return Reflect.apply(d.value,this,args);
  }});
  async function take(world:WorldData,kind:'off'|'zone'|'fog'|'fog-default',zone:WorldZone,label:string){
   const c=renderCartoCanvas(world,{theme:THEME_SURVEY,width:800,height:320,view:{x:-10,y:0,w:80,h:32},layers:{relief:false,forests:false,rivers:false,coastRings:false,shading:false,biomeTint:false,labels:false,settlements:false,roads:false,borders:false,graticule:false,frame:false,compass:false,scaleBar:false,contours:false},...(kind==='zone'?{zones:[zone]}:kind==='fog'?{fog:layer}:{})});
   canvases.push(c);const ctx=c.getContext('2d');need(ctx,'native real rendered Canvas');const g=ctx!;
   if(kind==='fog-default')drawReaderFog(g,layer,sx,sy);
   const r=rec(g),all=g.getImageData(0,0,800,320).data,center=g.getImageData(390,130,40,20).data;
   const value={polygons:r.polygons.filter(visible),titles:r.titles.filter(p=>p.x>=0&&p.x<800&&p.y>=0&&p.y<320),images:r.images.filter(p=>p.x+p.width>0&&p.x<800&&p.y+p.height>0&&p.y<320),pixels:await sha(new Uint8Array(all.buffer,all.byteOffset,all.byteLength)),center:await sha(new Uint8Array(center.buffer,center.byteOffset,center.byteLength))};diagnostic.observations[label]=value;return value;
  }
  const legacyOff=await take(legacy,'off',small,'legacyOff'),legacyZone=await take(legacy,'zone',small,'legacyZone'),legacyFog=await take(legacy,'fog',small,'legacyFog'),legacyDefault=await take(legacy,'fog-default',small,'legacyDefault'),legacyRestored=await take(legacy,'off',small,'legacyRestored');
  need(same(legacyZone.polygons,[[{x:120,y:100},{x:160,y:100},{x:160,y:140},{x:120,y:140}],[{x:760,y:100},{x:800,y:100},{x:800,y:140},{x:760,y:140}]]),'legacy two visible zone outlines');
  need(same(legacyZone.titles.map(p=>[p.x,p.y]),[[140,120],[780,120]]),'legacy two zone names');
  need(same(legacyFog.images.map(p=>[p.x,p.y,p.width,p.height]),[[-540,0,640,320],[100,0,640,320],[740,0,640,320]]),'legacy three fog copies');
  need(same(legacyDefault.images.map(p=>[p.x,p.width]),[[100,640]]),'fog helper default already single');
  need(legacyZone.pixels!==legacyOff.pixels&&legacyFog.pixels!==legacyOff.pixels&&legacyRestored.pixels===legacyOff.pixels,'legacy real native ink/OFF');
  const finiteOff=await take(finite,'off',wide,'finiteOff'),finiteZone=await take(finite,'zone',wide,'finiteZone'),finiteFog=await take(finite,'fog',wide,'finiteFog'),finiteDefault=await take(finite,'fog-default',wide,'finiteDefault'),finiteRestored=await take(finite,'off',wide,'finiteRestored');
  const test=(v:unknown,name:string)=>{if(!v)diagnostic.failures.push(name);};
  test(same(finiteZone.polygons,[[{x:120,y:100},{x:700,y:100},{x:700,y:180},{x:120,y:180}]]),'FINITE_ZONE_LITERAL_WIDE_ONCE');
  test(same(finiteZone.titles.map(p=>[p.x,p.y]),[[410,140]]),'FINITE_ZONE_CENTROID_TITLE_ONCE');
  test(finiteZone.pixels!==finiteOff.pixels&&finiteZone.center!==finiteOff.center,'FINITE_ZONE_NATIVE_VISIBLE_CENTER');
  test(same(finiteFog.images.map(p=>[p.x,p.y,p.width,p.height]),[[100,0,640,320]]),'FINITE_FOG_COPY_ONCE');
  test(same(finiteDefault.images.map(p=>[p.x,p.width]),[[100,640]]),'FINITE_FOG_DEFAULT_HELPER_ALREADY_SINGLE');
  test(finiteFog.pixels!==finiteOff.pixels&&finiteRestored.pixels===finiteOff.pixels,'FINITE_NATIVE_FOG_OFF_EXACT');
  const after=await Promise.all([signature(legacy),signature(finite)]);diagnostic.after=after;test(same(before,after),'FOURTEEN_META_EXACT');
  return{...diagnostic,passed:diagnostic.failures.length===0,legacyHealthy:true,attribution:'Actual renderCartoCanvas CPU raster plus delegated native Canvas; generate/adopt/replay, local inputs. Not mounted WorldView, file/PNG API, Native or Brave'};
 }finally{for(const[name,d]of descriptors)Object.defineProperty(proto,name,d);for(const c of canvases){c.remove();c.width=c.height=0;}}
}


// Permanent focused-consumer adapter; no alternate raster or expectations.
export async function testWorldgenFogZonesRender(){
 const result=await run();
 if(!result.passed)throw Error('Fog consumer failed '+JSON.stringify(result.failures));
 return ['Fog zones render trace '+JSON.stringify(result)];
}
