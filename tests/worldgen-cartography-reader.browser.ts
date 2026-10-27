import {createRoot} from 'react-dom/client';
import {createElement} from 'react';
import {EnginePaneContext} from '../src/engines/_shared/EnginePaneContext';
import CartoMap from '../src/engines/worldgen/components/CartoMap';
import {drawAnnotations} from '../src/engines/worldgen/cartography/annotations';
import type {StoryMark} from '../src/engines/worldgen/cartography/storyMarks';
import {renderCartoCanvas} from '../src/engines/worldgen/cartography/texture';
import {THEME_SURVEY} from '../src/engines/worldgen/cartography/theme';
import {generateWorld} from '../src/engines/worldgen/core/pipeline';
import {DEFAULT_PARAMS,type WorldData} from '../src/engines/worldgen/core/types';
import {adoptDomainDocument} from '../src/engines/worldgen/core/domainDocument';
import {domainSourceKey} from '../src/engines/worldgen/core/worldDomain';
import {DOMAIN_GRIDS,replayDomain} from '../src/engines/worldgen/core/domainReplay';

type Point={kind:'M'|'L'|'A';x:number;y:number;r?:number};
type Record2D={path:Point[];strokes:Point[][];dots:Point[]};
const check=(v:unknown,message:string)=>{if(!v)throw Error(message);};
const ink=(v:unknown)=>String(v).replace(/\s/g,'')==='rgba(70,46,24,0.92)';
const sha=async(v:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',v))).map(n=>n.toString(16).padStart(2,'0')).join('');
const signature=async(w:WorldData)=>({metadata:JSON.stringify({params:w.params,domain:w.domain,width:w.width,height:w.height,revision:w.revision}),arrays:await Promise.all(DOMAIN_GRIDS.map(k=>{const a=w[k]!;return sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}))});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export async function run(){
 await document.fonts.ready;
 const legacy=generateWorld({...DEFAULT_PARAMS,width:64,seed:'own-carto-reader-consumer-r1',starter:'land',erosion:0,glaciation:0});
 const doc=adoptDomainDocument(legacy,'',{version:1,sourceKey:domainSourceKey(legacy.params,''),entries:[]},{x:0,y:0,width:64,height:32});
 const finite=replayDomain(legacy,doc,1);
 check(finite.domain?.topology==='finite','HEALTH actual finite adoption');
 check(same((await signature(legacy)).arrays,(await signature(finite)).arrays),'HEALTH same fourteen generated grids');
 const before=await Promise.all([signature(legacy),signature(finite)]);
 const diagnostic:{phase:string;observations:Record<string,unknown>;before:unknown;after?:unknown}={phase:'generated',observations:{},before};
 Reflect.set(window,'__cartographyReaderDiagnostic',diagnostic);
 const proto=CanvasRenderingContext2D.prototype,names=['beginPath','moveTo','lineTo','arc','stroke','fill'] as const;
 const descriptors=names.map(n=>[n,Object.getOwnPropertyDescriptor(proto,n)!] as const);
 let records=new WeakMap<CanvasRenderingContext2D,Record2D>();
 const record=(ctx:CanvasRenderingContext2D)=>{let r=records.get(ctx);if(!r){r={path:[],strokes:[],dots:[]};records.set(ctx,r);}return r;};
 const canvases:HTMLCanvasElement[]=[];
 try{
  for(const[name,d]of descriptors)Object.defineProperty(proto,name,{...d,value:function(this:CanvasRenderingContext2D,...args:unknown[]){
   const r=record(this);
   if(name==='beginPath')r.path=[];
   if(name==='moveTo'||name==='lineTo')r.path.push({kind:name==='moveTo'?'M':'L',x:args[0] as number,y:args[1] as number});
   if(name==='arc')r.path.push({kind:'A',x:args[0] as number,y:args[1] as number,r:args[2] as number});
   if(name==='stroke'&&ink(this.strokeStyle)&&r.path.length===2&&r.path.every(p=>p.kind!=='A'))r.strokes.push(structuredClone(r.path));
   if(name==='fill'&&ink(this.fillStyle)&&r.path.length===1&&r.path[0].kind==='A')r.dots.push({...r.path[0]});
   return Reflect.apply(d.value,this,args);
  }});
  const take=async(world:WorldData,kind:'off'|'dots'|'trail')=>{
   records=new WeakMap();
   const canvas=renderCartoCanvas(world,{theme:THEME_SURVEY,width:800,height:320,view:{x:-10,y:0,w:80,h:32},layers:{relief:false,forests:false,rivers:false,coastRings:false,shading:false,biomeTint:false,labels:false,settlements:false,roads:false,borders:false,graticule:false,frame:false,compass:false,scaleBar:false,contours:false},townDots:kind==='dots'?[{x:0,y:10},{x:63,y:10}]:undefined,trail:kind==='trail'?[{x:2,y:10},{x:60,y:10}]:undefined});
   canvases.push(canvas);
   const ctx=canvas.getContext('2d');check(ctx,'HEALTH real Canvas2D');
   const c=ctx!,r=records.get(c)??{path:[],strokes:[],dots:[]};
   const pixels=c.getImageData(0,0,800,320).data,band=c.getImageData(350,100,100,10).data;
   return {size:[canvas.width,canvas.height],strokes:r.strokes,dots:r.dots,pixels:await sha(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength)),band:await sha(new Uint8Array(band.buffer,band.byteOffset,band.byteLength)),nonUniform:pixels.some((v,i)=>i%4!==3&&v!==pixels[i%4])};
  };
  const observed=async(world:WorldData,kind:'off'|'dots'|'trail',label:string)=>{diagnostic.phase=label;const value=await take(world,kind);diagnostic.observations[label]=value;return value;};
  const legacyOff=await observed(legacy,'off','legacyOff'),legacyOffAgain=await observed(legacy,'off','legacyOffAgain'),legacyDots=await observed(legacy,'dots','legacyDots'),legacyTrail=await observed(legacy,'trail','legacyTrail'),legacyRestored=await observed(legacy,'off','legacyRestored');
  diagnostic.phase='legacy-health-checks';
  const expectedLegacy=[[{kind:'M',x:125,y:105},{kind:'L',x:65,y:105}],[{kind:'M',x:765,y:105},{kind:'L',x:705,y:105}]];
  const xs=(r:typeof legacyDots)=>r.dots.map(p=>p.x).sort((a,b)=>a-b);
  check(same(legacyOff.size,[800,320])&&legacyOff.nonUniform&&legacyOff.pixels===legacyOffAgain.pixels,'HEALTH legacy real deterministic nonuniform raster');
  check(same(xs(legacyDots),[95,105,735,745])&&legacyDots.pixels!==legacyOff.pixels,'HEALTH legacy dot copies');
  check(same(legacyTrail.strokes,expectedLegacy)&&legacyTrail.pixels!==legacyOff.pixels&&legacyTrail.band===legacyOff.band,'HEALTH legacy shortest seam trail');
  check(legacyRestored.pixels===legacyOff.pixels,'HEALTH legacy OFF exact restoration');
  const finiteOff=await observed(finite,'off','finiteOff'),finiteDots=await observed(finite,'dots','finiteDots'),finiteTrail=await observed(finite,'trail','finiteTrail'),finiteRestored=await observed(finite,'off','finiteRestored');
  const after=await Promise.all([signature(legacy),signature(finite)]);
  diagnostic.after=after;diagnostic.phase='finite-contract-checks';
  const failures:string[]=[];
  if(!same(xs(finiteDots),[105,735])||finiteDots.pixels===finiteOff.pixels)failures.push('FINITE_DOTS_ONCE');
  if(!same(finiteTrail.strokes,[[{kind:'M',x:125,y:105},{kind:'L',x:705,y:105}]])||finiteTrail.band===finiteOff.band)failures.push('FINITE_WIDE_TRAIL_LITERAL');
  if(finiteRestored.pixels!==finiteOff.pixels)failures.push('FINITE_OFF_EXACT');
  if(!same(before,after))failures.push('FOURTEEN_AND_METADATA_EXACT');
  const observations={legacyOff,legacyOffAgain,legacyDots,legacyTrail,legacyRestored,finiteOff,finiteDots,finiteTrail,finiteRestored};
  return {passed:failures.length===0,attribution:'Actual renderCartoCanvas → renderCartography, native Canvas2D CPU raster and delegated observations; not Map2D/Carta UI/export file/Native/Brave',legacyHealthy:true,failures,observations,before,after};
 }finally{
  for(const[name,d]of descriptors)Object.defineProperty(proto,name,d);
  for(const canvas of canvases){canvas.remove();canvas.width=canvas.height=0;}
 }
}

/** Shipping entry: a resolved failed result must never become a focused-runner PASS. */
export async function testWorldgenCartographyReader(){
 try{
  const result=await run();
  if(!result.passed)throw Error('FINITE_CARTOGRAPHY_FAILURE '+JSON.stringify(result));
  const trace={attribution:result.attribution,legacyHealthy:result.legacyHealthy,failures:result.failures,observations:result.observations,fourteenAndMetadataExact:same(result.before,result.after)};
  return [
   'Cartography legacy deterministic real CPU raster',
   'Cartography legacy four town-dot copies',
   'Cartography legacy two shortest seam trails',
   'Cartography legacy OFF restores exact pixels',
   'Cartography finite town dots appear once',
   'Cartography finite wide trail keeps literal direction and centre ink',
   'Cartography finite OFF restores exact pixels',
   'Cartography fourteen fields and metadata remain exact',
   'Cartography trace '+JSON.stringify(trace),
  ];
 }catch(error){
  const message=error instanceof Error?error.stack:String(error);
  throw Error(message+'\nCARTOGRAPHY_DIAGNOSTIC '+JSON.stringify(Reflect.get(window,'__cartographyReaderDiagnostic')));
 }
}
namespace AnnotationsStory {

const check=(v:unknown,message:string)=>{if(!v)throw Error(message);};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sha=async(v:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',v))).map(n=>n.toString(16).padStart(2,'0')).join('');
const signature=async(w:WorldData)=>({metadata:JSON.stringify({params:w.params,domain:w.domain,width:w.width,height:w.height,revision:w.revision}),arrays:await Promise.all(DOMAIN_GRIDS.map(k=>{const a=w[k]!;return sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}))});
type Circle={x:number;y:number;r:number};
type Title={title:string;x:number;y:number};
type Record2D={path:Circle[];circles:Circle[];titles:Title[]};
const marks:StoryMark[]=[{id:'own-story-left',x:2.5,y:10.5,type:'meeting',status:'happened',title:'Own left'},{id:'own-story-right',x:60.5,y:10.5,type:'meeting',status:'happened',title:'Own right'}];

export async function run(){
 await document.fonts.ready;
 const legacy=generateWorld({...DEFAULT_PARAMS,width:64,seed:'own-story-copies-consumer-r1',starter:'land',erosion:0,glaciation:0});
 const doc=adoptDomainDocument(legacy,'',{version:1,sourceKey:domainSourceKey(legacy.params,''),entries:[]},{x:0,y:0,width:64,height:32});
 const finite=replayDomain(legacy,doc,1);
 check(finite.domain?.topology==='finite','HEALTH actual finite replay');
 const before=await Promise.all([signature(legacy),signature(finite)]);
 check(same(before[0].arrays,before[1].arrays),'HEALTH fourteen generated arrays agree');
 const diagnostic:{phase:string;observations:Record<string,unknown>;before:unknown;after?:unknown}={phase:'generated',observations:{},before};
 Reflect.set(window,'__storyCopiesDiagnostic',diagnostic);
 const proto=CanvasRenderingContext2D.prototype,names=['beginPath','arc','fill','fillText'] as const;
 const descriptors=names.map(n=>[n,Object.getOwnPropertyDescriptor(proto,n)!] as const);
 const records=new WeakMap<CanvasRenderingContext2D,Record2D>();
 const record=(ctx:CanvasRenderingContext2D)=>{let r=records.get(ctx);if(!r){r={path:[],circles:[],titles:[]};records.set(ctx,r);}return r;};
 const canvases:HTMLCanvasElement[]=[];
 try{
  for(const[name,d]of descriptors)Object.defineProperty(proto,name,{...d,value:function(this:CanvasRenderingContext2D,...args:unknown[]){
   const r=record(this);
   if(name==='beginPath')r.path=[];
   if(name==='arc')r.path.push({x:args[0] as number,y:args[1] as number,r:args[2] as number});
   if(name==='fill'&&this.fillStyle==='#2f6db3'&&r.path.length===1&&r.path[0].r===7.5)r.circles.push({...r.path[0]});
   if(name==='fillText'&&marks.some(m=>m.title===args[0]))r.titles.push({title:args[0] as string,x:(args[1] as number)-11.5,y:args[2] as number});
   return Reflect.apply(d.value,this,args);
  }});
  const take=async(world:WorldData,on:boolean,label:string)=>{
   const canvas=document.createElement('canvas');canvas.width=800;canvas.height=320;canvases.push(canvas);
   const ctx=canvas.getContext('2d');check(ctx,'HEALTH native Canvas2D');const c=ctx!;
   c.fillStyle='#f3ead3';c.fillRect(0,0,800,320);
   drawAnnotations(c,on?{story:marks}:undefined,world,x=>(x+10)*10,y=>y*10,10);
   const observed=record(c),pixels=c.getImageData(0,0,800,320).data;
   const bytes=(x:number,w:number)=>{const a=c.getImageData(x,0,w,320).data;return new Uint8Array(a.buffer,a.byteOffset,a.byteLength);};
   const value={circles:observed.circles,titles:observed.titles,pixels:await sha(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength)),west:await sha(bytes(0,100)),east:await sha(bytes(790,10))};
   diagnostic.phase=label;diagnostic.observations[label]=value;return value;
  };
  const legacyOff=await take(legacy,false,'legacyOff'),legacyOffAgain=await take(legacy,false,'legacyOffAgain'),legacyOn=await take(legacy,true,'legacyOn'),legacyRestored=await take(legacy,false,'legacyRestored');
  const centers=(circles:Circle[])=>circles.map(p=>[p.x,p.y]).sort((a,b)=>a[0]-b[0]);
  check(same(centers(legacyOn.circles),[[65,105],[125,105],[705,105],[765,105]]),'HEALTH legacy four blue circles');
  check(same(centers(legacyOn.titles.map(t=>({...t,r:0}))),[[65,105],[125,105],[705,105],[765,105]]),'HEALTH legacy four title centers');
  check(legacyOn.pixels!==legacyOff.pixels&&legacyOff.pixels===legacyOffAgain.pixels&&legacyOff.pixels===legacyRestored.pixels,'HEALTH legacy ON/OFF literal');
  const finiteOff=await take(finite,false,'finiteOff'),finiteOn=await take(finite,true,'finiteOn'),finiteRestored=await take(finite,false,'finiteRestored');
  const after=await Promise.all([signature(legacy),signature(finite)]);diagnostic.after=after;diagnostic.phase='finite-checks';
  const failures:string[]=[];
  if(!same(centers(finiteOn.circles),[[125,105],[705,105]]))failures.push('FINITE_STORY_CIRCLES_ONCE');
  if(!same(centers(finiteOn.titles.map(t=>({...t,r:0}))),[[125,105],[705,105]]))failures.push('FINITE_STORY_TITLES_ONCE');
  if(finiteOn.pixels===finiteOff.pixels)failures.push('FINITE_ON_VISIBLE');
  if(finiteOn.west!==finiteOff.west||finiteOn.east!==finiteOff.east)failures.push('FINITE_OUTSIDE_PAPER_UNCHANGED');
  if(finiteRestored.pixels!==finiteOff.pixels)failures.push('FINITE_OFF_EXACT');
  if(!same(before,after))failures.push('FOURTEEN_AND_METADATA_EXACT');
  return {passed:failures.length===0,legacyHealthy:true,failures,observations:diagnostic.observations,before,after,attribution:'Actual drawAnnotations/native Canvas2D with generate/adopt/replay; not mounted Engine, export, Native or Brave'};
 }finally{
  for(const[name,d]of descriptors)Object.defineProperty(proto,name,d);
  for(const canvas of canvases){canvas.remove();canvas.width=canvas.height=0;}
 }
}

}

namespace RasterStory {

const check=(v:unknown,message:string)=>{if(!v)throw Error(message);};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sha=async(v:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',v))).map(n=>n.toString(16).padStart(2,'0')).join('');
const signature=async(w:WorldData)=>({metadata:JSON.stringify({params:w.params,domain:w.domain,width:w.width,height:w.height,revision:w.revision}),arrays:await Promise.all(DOMAIN_GRIDS.map(k=>{const a=w[k]!;return sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}))});
type Circle={x:number;y:number;r:number};
type Title={title:string;x:number;y:number};
type Record2D={path:Circle[];circles:Circle[];titles:Title[]};
const marks:StoryMark[]=[{id:'own-story-left',x:2.5,y:10.5,type:'meeting',status:'happened',title:'Own left'},{id:'own-story-right',x:60.5,y:10.5,type:'meeting',status:'happened',title:'Own right'}];

export async function run(){
 await document.fonts.ready;
 const legacy=generateWorld({...DEFAULT_PARAMS,width:64,seed:'own-story-copies-consumer-r1',starter:'land',erosion:0,glaciation:0});
 const doc=adoptDomainDocument(legacy,'',{version:1,sourceKey:domainSourceKey(legacy.params,''),entries:[]},{x:0,y:0,width:64,height:32});
 const finite=replayDomain(legacy,doc,1);
 check(finite.domain?.topology==='finite','HEALTH actual finite replay');
 const before=await Promise.all([signature(legacy),signature(finite)]);
 check(same(before[0].arrays,before[1].arrays),'HEALTH fourteen generated arrays agree');
 const diagnostic:{phase:string;observations:Record<string,unknown>;before:unknown;after?:unknown}={phase:'generated',observations:{},before};
 Reflect.set(window,'__cartoExportStoryDiagnostic',diagnostic);
 const proto=CanvasRenderingContext2D.prototype,names=['beginPath','arc','fill','fillText'] as const;
 const descriptors=names.map(n=>[n,Object.getOwnPropertyDescriptor(proto,n)!] as const);
 const records=new WeakMap<CanvasRenderingContext2D,Record2D>();
 const record=(ctx:CanvasRenderingContext2D)=>{let r=records.get(ctx);if(!r){r={path:[],circles:[],titles:[]};records.set(ctx,r);}return r;};
 const canvases:HTMLCanvasElement[]=[];
 try{
  for(const[name,d]of descriptors)Object.defineProperty(proto,name,{...d,value:function(this:CanvasRenderingContext2D,...args:unknown[]){
   const r=record(this);
   if(name==='beginPath')r.path=[];
   if(name==='arc')r.path.push({x:args[0] as number,y:args[1] as number,r:args[2] as number});
   if(name==='fill'&&this.fillStyle==='#2f6db3'&&r.path.length===1&&r.path[0].r===7.5)r.circles.push({...r.path[0]});
   if(name==='fillText'&&marks.some(m=>m.title===args[0]))r.titles.push({title:args[0] as string,x:(args[1] as number)-11.5,y:args[2] as number});
   return Reflect.apply(d.value,this,args);
  }});
  const take=async(world:WorldData,on:boolean,label:string)=>{
   const canvas=renderCartoCanvas(world,{theme:THEME_SURVEY,width:800,height:320,view:{x:-10,y:0,w:80,h:32},layers:{relief:false,forests:false,rivers:false,coastRings:false,shading:false,biomeTint:false,labels:false,settlements:false,roads:false,borders:false,graticule:false,frame:false,compass:false,scaleBar:false,contours:false},story:on?marks:undefined});canvases.push(canvas);
   const ctx=canvas.getContext('2d');check(ctx,'HEALTH native Canvas2D');const c=ctx!;
   const observed=record(c),pixels=c.getImageData(0,0,800,320).data;
   const bytes=(x:number,w:number)=>{const a=c.getImageData(x,0,w,320).data;return new Uint8Array(a.buffer,a.byteOffset,a.byteLength);};
   const value={circles:observed.circles,titles:observed.titles,pixels:await sha(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength)),west:await sha(bytes(0,100)),east:await sha(bytes(790,10))};
   diagnostic.phase=label;diagnostic.observations[label]=value;return value;
  };
  const legacyOff=await take(legacy,false,'legacyOff'),legacyOffAgain=await take(legacy,false,'legacyOffAgain'),legacyOn=await take(legacy,true,'legacyOn'),legacyRestored=await take(legacy,false,'legacyRestored');
  const centers=(circles:Circle[])=>circles.map(p=>[p.x,p.y]).sort((a,b)=>a[0]-b[0]);
  check(same(centers(legacyOn.circles),[[65,105],[125,105],[705,105],[765,105]]),'HEALTH legacy four blue circles');
  check(same(centers(legacyOn.titles.map(t=>({...t,r:0}))),[[65,105],[125,105],[705,105],[765,105]]),'HEALTH legacy four title centers');
  check(legacyOn.pixels!==legacyOff.pixels&&legacyOff.pixels===legacyOffAgain.pixels&&legacyOff.pixels===legacyRestored.pixels,'HEALTH legacy ON/OFF literal');
  const finiteOff=await take(finite,false,'finiteOff'),finiteOn=await take(finite,true,'finiteOn'),finiteRestored=await take(finite,false,'finiteRestored');
  const after=await Promise.all([signature(legacy),signature(finite)]);diagnostic.after=after;diagnostic.phase='finite-checks';
  const failures:string[]=[];
  if(!same(centers(finiteOn.circles),[[125,105],[705,105]]))failures.push('FINITE_STORY_CIRCLES_ONCE');
  if(!same(centers(finiteOn.titles.map(t=>({...t,r:0}))),[[125,105],[705,105]]))failures.push('FINITE_STORY_TITLES_ONCE');
  if(finiteOn.pixels===finiteOff.pixels)failures.push('FINITE_ON_VISIBLE');
  if(finiteOn.west!==finiteOff.west||finiteOn.east!==finiteOff.east)failures.push('FINITE_OUTSIDE_PAPER_UNCHANGED');
  if(finiteRestored.pixels!==finiteOff.pixels)failures.push('FINITE_OFF_EXACT');
  if(!same(before,after))failures.push('FOURTEEN_AND_METADATA_EXACT');
  return {passed:failures.length===0,legacyHealthy:true,failures,observations:diagnostic.observations,before,after,attribution:'Actual renderCartoCanvas/native Canvas2D with generate/adopt/replay; not mounted Engine, export file, Native or Brave'};
 }finally{
  for(const[name,d]of descriptors)Object.defineProperty(proto,name,d);
  for(const canvas of canvases){canvas.remove();canvas.width=canvas.height=0;}
 }
}

}

namespace FitTerrain {

type Step={type:'mouseMove'|'mouseDown'|'mouseUp';x:number;y:number;button?:'left';clickCount?:1}|{type:'keyDown'|'keyUp';keyCode:'Enter'}|{type:'char';keyCode:'\r'};
const delay=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(v:unknown,message:string)=>{if(!v)throw Error(message);};
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
const signature=async(w:WorldData)=>({metadata:JSON.stringify({params:w.params,domain:w.domain,width:w.width,height:w.height,revision:w.revision}),arrays:await Promise.all(DOMAIN_GRIDS.map(k=>{const a=w[k]!;return hash(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}))});
const identify=(target:EventTarget|null)=>target instanceof Element?{tag:target.tagName,title:target.getAttribute('title'),text:target instanceof HTMLButtonElement?target.textContent:null,class:target.className}:null;

export async function run(){
 const diagnostic:{phase:string;events:unknown[];captures:unknown[];callbacks:unknown[];observations:unknown[];cleanup?:unknown}={phase:'init',events:[],captures:[],callbacks:[],observations:[]};
 Reflect.set(window,'__cartoFitDiagnostic',diagnostic);
 const legacy=generateWorld({...DEFAULT_PARAMS,width:64,seed:'own-carto-fit-control-r1',starter:'land',erosion:0,glaciation:0});
 const doc=adoptDomainDocument(legacy,'',{version:1,sourceKey:domainSourceKey(legacy.params,''),entries:[]},{x:48,y:0,width:32,height:64});
 const finite=replayDomain(legacy,doc,1),before=await Promise.all([signature(legacy),signature(finite)]);
 const host=document.createElement('div');host.style.cssText='position:relative;width:800px;height:500px;margin:20px';document.body.append(host);
 const control=document.createElement('button');control.textContent='Own native input control';control.style.cssText='position:fixed;left:850px;top:20px';document.body.append(control);let controlClicks=0;control.addEventListener('click',()=>controlClicks++);
 const channel=document.createElement('pre');channel.id='qa-carto-fit-input';channel.style.display='none';document.body.append(channel);
 let sequence=0,root:ReturnType<typeof createRoot>|undefined,currentLabel='init';const failures:string[]=[];
 const events=['pointermove','keypress','pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture','click','keydown','keyup'] as const;
 const listeners:(()=>void)[]=[];
 const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'setPointerCapture')!;
 const input=async(steps:Step[])=>{
  const id=String(++sequence);channel.removeAttribute('data-error');channel.textContent=JSON.stringify({id,steps});
  const end=Date.now()+15000;while(channel.getAttribute('data-completed-id')!==id){if(Date.now()>end)throw Error('HEALTH native input deadline');await delay();}
  check(!channel.getAttribute('data-error'),'HEALTH native input rejected: '+channel.getAttribute('data-error'));
 };
 const enter=()=>input([{type:'keyDown',keyCode:'Enter'},{type:'char',keyCode:'\r'},{type:'keyUp',keyCode:'Enter'}]);
 const fit=()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.title==='Encuadrar el mundo');
 const zoom=()=>Number((host.textContent?.match(/×([\d.]+)/)?.[1])??NaN);
 const picture=()=>{
  const canvas=host.querySelector<HTMLCanvasElement>('canvas.pointer-events-none');
  return {zoom:zoom(),canvas:canvas?{width:canvas.width,height:canvas.height,rect:canvas.getBoundingClientRect().toJSON()}:null,active:identify(document.activeElement),fit:fit()?{rect:fit()!.getBoundingClientRect().toJSON(),disabled:fit()!.disabled}:null};
 };
 const observe=async(label:string)=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));const value={label,time:performance.now(),picture:picture(),callbacks:structuredClone(diagnostic.callbacks),events:structuredClone(diagnostic.events),captures:structuredClone(diagnostic.captures)};diagnostic.observations.push(value);return value;};
 const wait=async(test:()=>boolean,ms:number)=>{const end=Date.now()+ms;while(!test()&&Date.now()<end)await delay();return test();};
 try{
  Object.defineProperty(Element.prototype,'setPointerCapture',{...descriptor,value:function(this:Element,pointerId:number){const result=Reflect.apply(descriptor.value,this,[pointerId]);diagnostic.captures.push({label:currentLabel,time:performance.now(),element:identify(this),pointerId,after:this.hasPointerCapture(pointerId)});return result;}});
  for(const name of events)for(const capture of [true,false]){
   const listener=(event:Event)=>{const e=event as PointerEvent&KeyboardEvent;diagnostic.events.push({label:currentLabel,time:performance.now(),name,capture,target:identify(e.target),path:e.composedPath().map(identify).filter(Boolean),trusted:e.isTrusted,defaultPrevented:e.defaultPrevented,pointerId:e.pointerId,key:e.key,active:identify(document.activeElement)});};
   document.addEventListener(name,listener,{capture});listeners.push(()=>document.removeEventListener(name,listener,{capture}));
  }
  currentLabel='standalone-mouse';const rect=control.getBoundingClientRect(),at={x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
  await input([{type:'mouseMove',...at},{type:'mouseDown',...at,button:'left',clickCount:1},{type:'mouseUp',...at,button:'left',clickCount:1}]);await observe(currentLabel);
  diagnostic.observations.push({label:currentLabel,controlClicks});check(controlClicks===1,'HEALTH standalone native mouse click');
  currentLabel='standalone-enter-char';control.focus();await enter();await observe(currentLabel);
  diagnostic.observations.push({label:currentLabel,controlClicks});check(controlClicks===2&&diagnostic.events.some((e:any)=>e.label===currentLabel&&e.name==='click'&&e.target?.text==='Own native input control'&&e.trusted),'HEALTH standalone native Enter-char click');
  control.remove();
  for(const[label,world]of [['legacy',legacy],['finite',finite]] as const){
   currentLabel=label;diagnostic.phase=label+'-mount';root=createRoot(host);
   root.render(createElement(EnginePaneContext.Provider,{value:{instanceId:'qa-carto-fit-own',visible:true,primary:true}},createElement(CartoMap,{world,theme:THEME_SURVEY,layers:{relief:false,forests:false,rivers:false,coastRings:false,shading:false,biomeTint:false,labels:false,settlements:false,roads:false,borders:false,graticule:false,frame:false,compass:false,scaleBar:false,contours:false},density:1,reliefAmount:1,onViewChange:view=>diagnostic.callbacks.push({label,time:performance.now(),kind:'view',view}),onViewportChange:viewport=>diagnostic.callbacks.push({label,time:performance.now(),kind:'viewport',viewport})})));
   check(await wait(()=>!!fit()&&host.querySelector('canvas')?.width===800,10000),'HEALTH mounted actual Carta');
   await observe(label+'-initial');
   const plus=[...host.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.textContent==='+');check(plus&&!plus.disabled,'HEALTH real plus');
   currentLabel=label+'-plus-enter';plus!.focus();await enter();await wait(()=>zoom()>1,3000);const healthy=await observe(currentLabel);
   check(healthy.picture.zoom>1&&diagnostic.events.some((e:any)=>e.label===currentLabel&&e.name==='click'&&e.target?.tag==='BUTTON'&&e.target.text==='+'),'HEALTH real Enter did not activate plus');
   currentLabel=label+'-terrain-drag';
   const viewBefore=(diagnostic.callbacks as {label:string;kind:string;view?:{x:number;y:number;w:number;h:number}}[]).filter(v=>v.label===label&&v.kind==='view').at(-1)?.view;
   check(viewBefore,'HEALTH public pre-drag view');const beforeView={...viewBefore!};
   const terrainCanvas=host.querySelector<HTMLCanvasElement>('canvas.block');check(terrainCanvas,'HEALTH normal ground Canvas');
   const groundRect=terrainCanvas!.getBoundingClientRect(),start={x:Math.round(groundRect.left+groundRect.width/2),y:Math.round(groundRect.top+groundRect.height/2)},end={x:start.x+30,y:start.y+30};
   const dragEventStart=diagnostic.events.length,dragCaptureStart=diagnostic.captures.length;
   await input([{type:'mouseMove',...start},{type:'mouseDown',...start,button:'left',clickCount:1},{type:'mouseMove',...end},{type:'mouseUp',...end,button:'left',clickCount:1}]);
   const lastView=()=>((diagnostic.callbacks as {label:string;kind:string;view?:{x:number;y:number;w:number;h:number}}[]).filter(v=>v.label===label&&v.kind==='view').at(-1)?.view);
   await wait(()=>JSON.stringify(lastView())!==JSON.stringify(beforeView),3000);const afterView=lastView();
   const expected={x:label==='finite'&&beforeView.w>=world.width?beforeView.x:beforeView.x-30/800*beforeView.w,y:Math.min(world.height-beforeView.h,Math.max(0,beforeView.y-30/500*beforeView.h)),w:beforeView.w,h:beforeView.h};
   const dragCapture=diagnostic.captures.slice(dragCaptureStart) as {label:string;element:{tag:string};after:boolean}[];
   diagnostic.observations.push({label,phase:'terrain-drag-before-check',beforeView,afterView,expected,picture:picture(),capture:dragCapture,events:diagnostic.events.slice(dragEventStart)});
   check(afterView&&Object.entries(expected).every(([key,value])=>Math.abs(afterView[key as keyof typeof afterView]-value)<1e-7),'TERRAIN_DRAG_PUBLIC_VIEW_EXACT');
   check(dragCapture.some(v=>v.label===currentLabel&&v.element.tag==='DIV'&&v.after),'TERRAIN_DRAG_HOST_CAPTURE');
   check(zoom()===1.6,'TERRAIN_DRAG_ZOOM_UNCHANGED');
   currentLabel=label+'-fit-mouse';const button=fit()!,rect=button.getBoundingClientRect(),at={x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
   const mouseEventStart=diagnostic.events.length;
   await input([{type:'mouseMove',...at},{type:'mouseDown',...at,button:'left',clickCount:1},{type:'mouseUp',...at,button:'left',clickCount:1}]);
   await wait(()=>zoom()===1,3000);const mouse=await observe(currentLabel);
   currentLabel=label+'-fit-enter';fit()!.focus();await enter();await wait(()=>zoom()===1,3000);const keyboard=await observe(currentLabel);
   check(keyboard.picture.zoom===1&&diagnostic.events.some((e:any)=>e.label===currentLabel&&e.name==='click'&&e.target?.title==='Encuadrar el mundo'),'HEALTH real Enter did not activate Fit');
   const reported=(diagnostic.callbacks as {label:string;kind:string;view?:{x:number;y:number;w:number;h:number}}[]).filter(v=>v.label===label&&v.kind==='view').at(-1)?.view;
   diagnostic.observations.push({label,phase:'fit-public-geometry-before-check',reported,world:{width:world.width,height:world.height},picture:picture()});
   if(label==='finite')check(reported&&reported.x<=0&&reported.y<=0&&reported.x+reported.w>=world.width&&reported.y+reported.h>=world.height,'HEALTH keyboard Fit did not contain finite sheet');
   if(mouse.picture.zoom!==1)failures.push(label+'_FIT_MOUSE_NOT_EQUAL_ENTER');
   diagnostic.observations.push({label,summary:{mouseZoom:mouse.picture.zoom,keyboardZoom:keyboard.picture.zoom,mouseEvents:diagnostic.events.slice(mouseEventStart).filter((e:any)=>e.label===label+'-fit-mouse')}});
   root.unmount();root=undefined;await delay();
  }
  const after=await Promise.all([signature(legacy),signature(finite)]);diagnostic.observations.push({before,after});check(JSON.stringify(before)===JSON.stringify(after),'HEALTH readonly14metadata');
  return {passed:failures.length===0,failures,diagnostic,attribution:'Mounted actual CartoMap/native terrain drag plus Fit; public callbacks observed, no parent Engine/Brave/export claim'};
 }finally{
  root?.unmount();for(const remove of listeners)remove();Object.defineProperty(Element.prototype,'setPointerCapture',descriptor);host.remove();channel.remove();control.remove();diagnostic.cleanup={unmounted:true,observerRestored:true,ownDOMRemoved:!host.isConnected&&!channel.isConnected&&!control.isConnected};
 }
}

}

export async function testWorldgenCartographyStory(){
 const annotations=await AnnotationsStory.run(),raster=await RasterStory.run();
 if(!annotations.passed||!raster.passed)throw Error('CARTOGRAPHY_STORY_FAILURE '+JSON.stringify({annotations,raster}));
 return ['Cartography annotations six finite criteria and legacy controls','Cartography raster six finite criteria and legacy controls','Cartography story trace '+JSON.stringify({annotations,raster})];
}
export async function runWorldgenCartographyFit(){
 try{const result=await FitTerrain.run();if(!result.passed)throw Error('CARTOGRAPHY_FIT_FAILURE '+JSON.stringify(result));return result;}
 catch(error){throw Error((error instanceof Error?error.stack:String(error))+'\nCARTOGRAPHY_FIT_DIAGNOSTIC '+JSON.stringify(Reflect.get(window,'__cartoFitDiagnostic')));}
}
