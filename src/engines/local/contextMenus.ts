/** Ephemeral host requests. This public module has no DOM/app imports. */
export type LocalToolMenuEntry =
 | {kind:'item';id:string;label:string;disabled?:boolean;variant?:'default'|'destructive';onSelect:()=>void|Promise<void>}
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
 const seen=new Set<string>(),result:LocalToolMenuEntry[]=[];let items=0;
 for(const row of entries){
  if(!row||typeof row!=='object')return null;
  if(row.kind==='separator'){result.push(Object.freeze({kind:'separator'}));continue;}
  if(typeof row.label!=='string'||!row.label.trim())return null;
  if(row.kind==='label'){result.push(Object.freeze({kind:'label',label:row.label}));continue;}
  if(row.kind!=='item'||typeof row.id!=='string'||!row.id.trim()||seen.has(row.id)||typeof row.onSelect!=='function'||row.disabled!==undefined&&typeof row.disabled!=='boolean'||row.variant!==undefined&&!['default','destructive'].includes(row.variant))return null;
  seen.add(row.id);items++;
  result.push(Object.freeze({kind:'item',id:row.id,label:row.label,onSelect:row.onSelect,...(row.disabled!==undefined?{disabled:row.disabled}:{}),...(row.variant!==undefined?{variant:row.variant}:{})}));
 }
 return items?Object.freeze(result):null;
}
export interface LocalToolRecordedMenuRequest {label:string;entries:readonly ({kind:'item';id:string;label:string;disabled?:boolean;variant?:'default'|'destructive'}|{kind:'separator'}|{kind:'label';label:string})[]}
/** Records only detached metadata. No event access, callbacks or presentation. */
export function createRecordingLocalToolContextMenu(){
 const requests:LocalToolRecordedMenuRequest[]=[];
 const port:LocalToolContextMenuPort=Object.freeze({open:(_event:LocalToolMenuTrigger,entries:readonly LocalToolMenuEntry[],options:{label:string})=>{
  const copy=copyLocalToolMenuEntries(entries);if(!copy||typeof options?.label!=='string'||!options.label.trim())return false;
  requests.push({label:options.label,entries:copy.map(row=>row.kind==='item'?{kind:'item',id:row.id,label:row.label,...(row.disabled!==undefined?{disabled:row.disabled}:{}),...(row.variant!==undefined?{variant:row.variant}:{})}:row.kind==='label'?{kind:'label',label:row.label}:{kind:'separator'})});return false;
 },close:()=>{}});
 return{port,requests};
}
