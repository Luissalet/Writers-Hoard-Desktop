/** Ephemeral host requests. This public module has no DOM/app imports. */
export type LocalToolMenuEntry =
 | {kind:'item';id:string;label:string;disabled?:boolean;variant?:'default'|'destructive';onSelect:()=>void|Promise<void>}
 | {kind:'submenu';id:string;label:string;disabled?:boolean;entries:readonly LocalToolMenuEntry[]}
 | {kind:'separator'}
 | {kind:'label';label:string};
export interface LocalToolMenuTrigger {
 readonly currentTarget:EventTarget|null;
 readonly type?:string;readonly clientX?:number;readonly clientY?:number;
 readonly key?:string;readonly shiftKey?:boolean;readonly detail?:number;
 preventDefault():void;stopPropagation():void;
}
export interface LocalToolContextMenuPort {
 open(event:LocalToolMenuTrigger,entries:readonly LocalToolMenuEntry[],options:{label:string}):boolean;
 close():void;
}
const unavailable:LocalToolContextMenuPort=Object.freeze({open:()=>false,close:()=>{}});
export function useLocalToolContextMenu(context?:{readonly contextMenu?:LocalToolContextMenuPort}):LocalToolContextMenuPort{return context?.contextMenu??unavailable;}
/** Host-owned copy: never freeze or retain the author's container. */
export function copyLocalToolMenuEntries(entries:readonly LocalToolMenuEntry[]):readonly LocalToolMenuEntry[]|null{
 if(!Array.isArray(entries))return null;
 type Frame={source:readonly LocalToolMenuEntry[];result:LocalToolMenuEntry[];index:number;items:number;branch?:Extract<LocalToolMenuEntry,{kind:'submenu'}>};
 const seen=new Set<string>(),ancestors=new Set<readonly LocalToolMenuEntry[]>(),stack:Frame[]=[{source:entries,result:[],index:0,items:0}];ancestors.add(entries);
 while(stack.length){
  const frame=stack[stack.length-1];
  if(frame.index===frame.source.length){
   if(!frame.items)return null;
   const copy=Object.freeze(frame.result);ancestors.delete(frame.source);stack.pop();
   if(!stack.length)return copy;
   const parent=stack[stack.length-1],branch=frame.branch!;parent.items+=frame.items;
   parent.result.push(Object.freeze({kind:'submenu',id:branch.id,label:branch.label,...(branch.disabled!==undefined?{disabled:branch.disabled}:{}),entries:copy}));continue;
  }
  const row=frame.source[frame.index++];
  if(!row||typeof row!=='object')return null;
  if(row.kind==='separator'){frame.result.push(Object.freeze({kind:'separator'}));continue;}
  if(typeof row.label!=='string'||!row.label.trim())return null;
  if(row.kind==='label'){frame.result.push(Object.freeze({kind:'label',label:row.label}));continue;}
  if(row.kind!=='item'&&row.kind!=='submenu'||typeof row.id!=='string'||!row.id.trim()||seen.has(row.id)||row.disabled!==undefined&&typeof row.disabled!=='boolean')return null;
  seen.add(row.id);
  if(row.kind==='submenu'){
   if(!Array.isArray(row.entries)||ancestors.has(row.entries))return null;
   const branch={kind:'submenu' as const,id:row.id,label:row.label,...(row.disabled!==undefined?{disabled:row.disabled}:{}),entries:[]};
   ancestors.add(row.entries);stack.push({source:row.entries,result:[],index:0,items:0,branch});continue;
  }
  if(typeof row.onSelect!=='function'||row.variant!==undefined&&!['default','destructive'].includes(row.variant))return null;
  frame.items++;frame.result.push(Object.freeze({kind:'item',id:row.id,label:row.label,onSelect:row.onSelect,...(row.disabled!==undefined?{disabled:row.disabled}:{}),...(row.variant!==undefined?{variant:row.variant}:{})}));
 }
 return null;
}
type RecordedEntry={kind:'item';id:string;label:string;disabled?:boolean;variant?:'default'|'destructive'}|{kind:'submenu';id:string;label:string;disabled?:boolean;entries:RecordedEntry[]}|{kind:'separator'}|{kind:'label';label:string};
export interface LocalToolRecordedMenuRequest {label:string;entries:readonly RecordedEntry[]}
function recordEntries(entries:readonly LocalToolMenuEntry[]):RecordedEntry[]{
 const result:RecordedEntry[]=[],stack=[{source:entries,result}];
 while(stack.length){const frame=stack.pop()!;for(const row of frame.source){
  if(row.kind==='submenu'){const entry:Extract<RecordedEntry,{kind:'submenu'}>={kind:'submenu',id:row.id,label:row.label,...(row.disabled!==undefined?{disabled:row.disabled}:{}),entries:[]};frame.result.push(entry);stack.push({source:row.entries,result:entry.entries});}
  else frame.result.push(row.kind==='item'?{kind:'item',id:row.id,label:row.label,...(row.disabled!==undefined?{disabled:row.disabled}:{}),...(row.variant!==undefined?{variant:row.variant}:{})}:row.kind==='label'?{kind:'label',label:row.label}:{kind:'separator'});
 }}return result;
}
/** Records only detached metadata. No event access, callbacks or presentation. */
export function createRecordingLocalToolContextMenu(){
 const requests:LocalToolRecordedMenuRequest[]=[];
 const port:LocalToolContextMenuPort=Object.freeze({open:(_event:LocalToolMenuTrigger,entries:readonly LocalToolMenuEntry[],options:{label:string})=>{
  const copy=copyLocalToolMenuEntries(entries);if(!copy||typeof options?.label!=='string'||!options.label.trim())return false;
  requests.push({label:options.label,entries:recordEntries(copy)});return false;
 },close:()=>{}});
 return{port,requests};
}
