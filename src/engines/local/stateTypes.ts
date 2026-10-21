/** Pure JSON contract: safe to import in Node/Electron without React or DOM. */
export type LocalToolJson = null | boolean | number | string | LocalToolJson[] | {[key:string]:LocalToolJson};
export interface LocalToolState<T extends LocalToolJson=LocalToolJson>{revision:number;updatedAt:number;data:T}
export type LocalToolStates=Record<string,LocalToolState>;
export const MAX_LOCAL_TOOL_STATE_BYTES=2*1024*1024;
export const MAX_PROJECT_TOOL_STATE_BYTES=20*1024*1024;
export const MAX_LOCAL_TOOL_NAMESPACES=128;
export const localToolNamespace=(value:unknown):value is string=>typeof value==='string'&&value.length<=80&&/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(value);
export type LocalToolErrorCode='invalid-json'|'state-too-large'|'project-too-large'|'invalid-namespace'|'missing-project'|'conflict'|'invalid-state'|'invalid-query';
export class LocalToolStateError extends Error{readonly code:LocalToolErrorCode;constructor(code:LocalToolErrorCode){super(code);this.code=code;this.name='LocalToolStateError';}}
const plain=(value:object)=>Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null;
/** Reject accessors, prototypes, holes, nonfinite numbers, cycles and silent
 * JSON omissions before stringify; never invoke an object's toJSON method. */
export function localToolJsonText(value:unknown,maxBytes=MAX_LOCAL_TOOL_STATE_BYTES):string{
  let nodes=0;const active=new Set<object>();
  const visit=(item:unknown,depth:number):void=>{
    if(++nodes>100000||depth>32)throw new LocalToolStateError('invalid-json');
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(typeof item!=='object'||!item||active.has(item))throw new LocalToolStateError('invalid-json');
    active.add(item);
    if(Array.isArray(item)){
      if(item.length>100000||Reflect.ownKeys(item).length!==item.length+1)throw new LocalToolStateError('invalid-json');
      for(let index=0;index<item.length;index++){const field=Object.getOwnPropertyDescriptor(item,String(index));if(!field||!('value'in field)||!field.enumerable)throw new LocalToolStateError('invalid-json');visit(field.value,depth+1);}
    }else{
      if(!plain(item))throw new LocalToolStateError('invalid-json');
      for(const key of Reflect.ownKeys(item)){if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))throw new LocalToolStateError('invalid-json');const field=Object.getOwnPropertyDescriptor(item,key)!;if(!('value'in field)||!field.enumerable)throw new LocalToolStateError('invalid-json');visit(field.value,depth+1);}
    }
    active.delete(item);
  };
  visit(value,0);const text=JSON.stringify(value);if(new TextEncoder().encode(text).byteLength>maxBytes)throw new LocalToolStateError('state-too-large');return text;
}
export function cloneLocalToolJson<T extends LocalToolJson>(value:T,maxBytes?:number):T{return JSON.parse(localToolJsonText(value,maxBytes))as T;}
export function validateLocalToolStates(value:unknown):asserts value is LocalToolStates|undefined{
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||!plain(value)||Reflect.ownKeys(value).length>MAX_LOCAL_TOOL_NAMESPACES)throw new LocalToolStateError('invalid-json');
  let bytes=2;for(const key of Reflect.ownKeys(value)){
    if(!localToolNamespace(key))throw new LocalToolStateError('invalid-namespace');
    const property=Object.getOwnPropertyDescriptor(value,key)!;if(!('value'in property)||!property.enumerable)throw new LocalToolStateError('invalid-json');
    const record=property.value;if(!record||typeof record!=='object'||Array.isArray(record)||!plain(record))throw new LocalToolStateError('invalid-json');
    const text=localToolJsonText(record);bytes+=new TextEncoder().encode(JSON.stringify(key)).byteLength+new TextEncoder().encode(text).byteLength+2;
    if(bytes-1>MAX_PROJECT_TOOL_STATE_BYTES)throw new LocalToolStateError('project-too-large');
    if(Reflect.ownKeys(record).length!==3||!Object.hasOwn(record,'data')||!Number.isSafeInteger(record.revision)||record.revision<0||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<0)throw new LocalToolStateError('invalid-json');
  }
}
/** JSON is opaque. Never guess that a string is a Codex ID or source path. */
export function cloneLocalToolStates(value:LocalToolStates|undefined):LocalToolStates|undefined{
  validateLocalToolStates(value);if(!value)return undefined;
  return Object.fromEntries(Object.entries(value).map(([namespace,record])=>[namespace,{...record,revision:0,data:JSON.parse(localToolJsonText(record.data))as LocalToolJson}]));
}

/** Base and era state travel together; only stored overrides consume bytes. */
export function validateLocalToolProjectStates(project:{localToolStates?:unknown;worldEras?:readonly {localToolStates?:unknown}[]}):void{
  const collections=[project.localToolStates,...(project.worldEras??[]).map(era=>era.localToolStates)];let bytes=0;
  for(const states of collections){validateLocalToolStates(states);if(states)bytes+=new TextEncoder().encode(JSON.stringify(states)).byteLength;}
  if(bytes>MAX_PROJECT_TOOL_STATE_BYTES)throw new LocalToolStateError('project-too-large');
}
