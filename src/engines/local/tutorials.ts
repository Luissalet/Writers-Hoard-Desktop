import {cloneLocalToolJson,type LocalToolJson} from './stateTypes';
/** Plain descriptors and an inert author-test port; no host, DOM or persistence. */
export type LocalToolTourText={en:string;es:string}|{key:string};
export type LocalToolTourAdvance={type:'manual'}|{type:'event';name:string}|{type:'element-appears';target:string};
export interface LocalToolTourStep{id:string;target:string;title:LocalToolTourText;body:LocalToolTourText;advanceOn?:LocalToolTourAdvance}
export interface LocalToolTourSpec{id:string;revision:number;title:LocalToolTourText;steps:readonly LocalToolTourStep[]}
export interface LocalToolTutorialSnapshot{available:boolean;active?:{id:string;step:number};tours:{id:string;revision:number;status:'not-started'|'in-progress'|'done';step:number}[]}
export interface LocalToolTutorialPort{show(id:string,options?:{resume?:boolean}):Promise<{shown:boolean;reason?:'unavailable'|'cancelled'|'missing'}>;signal(name:string):void;getSnapshot():LocalToolTutorialSnapshot;subscribe(changed:()=>void):()=>void}
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function text(value:unknown):boolean{return record(value)&&(Object.keys(value).length===1&&typeof value.key==='string'&&!!value.key||Object.keys(value).length===2&&typeof value.en==='string'&&typeof value.es==='string');}
function nonempty(value:unknown):value is string{return typeof value==='string'&&value.length>0;}
/** Capture only the documented JSON vocabulary, rejecting extra non-JSON fields. */
export function prepareLocalToolTours(input:unknown):readonly LocalToolTourSpec[]{
 const value=cloneLocalToolJson(input as LocalToolJson,Infinity);
 if(!Array.isArray(value))throw Error('local_tool_tours_invalid');
 const ids=new Set<string>();
 for(const tour of value){
  if(!record(tour)||!nonempty(tour.id)||ids.has(tour.id)||!Number.isSafeInteger(tour.revision)||Number(tour.revision)<1||!text(tour.title)||!Array.isArray(tour.steps)||!tour.steps.length||Object.keys(tour).some(key=>!['id','revision','title','steps'].includes(key)))throw Error('local_tool_tours_invalid');
  ids.add(tour.id);const steps=new Set<string>();
  for(const step of tour.steps){
   if(!record(step)||!nonempty(step.id)||steps.has(step.id)||!nonempty(step.target)||!text(step.title)||!text(step.body)||Object.keys(step).some(key=>!['id','target','title','body','advanceOn'].includes(key)))throw Error('local_tool_tours_invalid');
   steps.add(step.id);const mode=step.advanceOn;
   if(mode!==undefined&&(!record(mode)||!(mode.type==='manual'&&Object.keys(mode).length===1||mode.type==='event'&&Object.keys(mode).length===2&&nonempty(mode.name)||mode.type==='element-appears'&&Object.keys(mode).length===2&&nonempty(mode.target))))throw Error('local_tool_tours_invalid');
  }
 }
 const clone=JSON.parse(JSON.stringify(value)) as LocalToolTourSpec[];
 const freeze=(item:unknown):void=>{if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}};freeze(clone);return clone;
}
export function localToolTourProgressKey(namespace:string,tour:LocalToolTourSpec):string{return JSON.stringify(['local-tool-tour',namespace,tour.id,tour.revision,tour.steps.map(step=>[step.id,step.target,step.advanceOn?.type==='event'?['event',step.advanceOn.name]:step.advanceOn?.type==='element-appears'?['element-appears',step.advanceOn.target]:['manual']])]);}
export function createRecordingLocalToolTutorial(tours:readonly LocalToolTourSpec[]=[]){
 tours=prepareLocalToolTours(tours);
 const commands:({type:'show';id:string;resume:boolean}|{type:'signal';name:string})[]=[];
 const port:LocalToolTutorialPort=Object.freeze({show:async(id:string,options?:{resume?:boolean})=>{commands.push({type:'show',id,resume:options?.resume===true});return{shown:false,reason:'unavailable' as const};},signal:(name:string)=>{commands.push({type:'signal',name});},getSnapshot:()=>({available:false,tours:tours.map(tour=>({id:tour.id,revision:tour.revision,status:'not-started' as const,step:0}))}),subscribe:()=>()=>{}});
 return{port,commands};
}
