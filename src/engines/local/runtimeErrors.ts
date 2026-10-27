import {getLocalToolCatalog} from './definitions';
import {localToolNamespace} from './stateTypes';
import {localToolContentHash} from './releaseFormat.mjs';

export const RUNTIME_ERROR_PHASES=['load','factory','prepare','persist','publish','notify','render','operation'] as const;
export type RuntimeErrorPhase=typeof RUNTIME_ERROR_PHASES[number];
export type RuntimeErrorType='Error'|'TypeError'|'RangeError'|'SyntaxError'|'Unknown';
export interface RuntimeErrorIdentity {packageNamespace:string;contentHash:string;namespace?:string;kind?:'tool'|'app'}
export interface RuntimeErrorFilters {namespace?:string;contentHash?:string;phase?:RuntimeErrorPhase}
export interface RuntimeErrorEntry extends RuntimeErrorIdentity {id:string;firstAt:number;lastAt:number;count:number;phase:RuntimeErrorPhase;code:string;message:string;errorType:RuntimeErrorType;mountId?:string;operation?:string}
const messages:Record<RuntimeErrorPhase,string>={load:'The local package could not be loaded.',factory:'The local package factory failed.',prepare:'The local package could not be prepared.',persist:'The local package could not be saved.',publish:'The local package could not be published.',notify:'The local package was published but its change notification failed.',render:'The local package view failed.',operation:'The local package operation failed.'};
const entries=new Map<string,Readonly<RuntimeErrorEntry>>(),listeners=new Set<()=>void>();
let nextId=0,snapshot:readonly Readonly<RuntimeErrorEntry>[]=Object.freeze([]);
function publish(){snapshot=Object.freeze([...entries.values()]);for(const changed of listeners)try{changed();}catch{/* Diagnostics must not change a confirmed product result. */}}
export const subscribeRuntimeErrors=(changed:()=>void)=>{listeners.add(changed);return()=>{listeners.delete(changed);};};
export const getRuntimeErrorSnapshot=()=>snapshot;
/** Resolve only an exact known runtime member; compiled Source/1 never enters this feed. */
export function runtimeErrorIdentity(namespace:string,contentHash:string|null|undefined):RuntimeErrorIdentity|undefined{
 if(!contentHash)return;const manifest=getLocalToolCatalog(namespace)?.releases.get(contentHash)?.manifest;
 if(manifest?.format!=='writers-hoard-local-runtime-member/1')return;
 return{packageNamespace:manifest.packageNamespace,contentHash:manifest.contentHash,namespace,kind:manifest.kind};
}
/** Preserve the original category across loader wrappers without copying a thrown message/stack. */
export function runtimeErrorType(error:unknown):RuntimeErrorType{
 try{const preserved=error&&typeof error==='object'?(error as {runtimeErrorType?:unknown}).runtimeErrorType:undefined;
 if(['Error','TypeError','RangeError','SyntaxError','Unknown'].includes(String(preserved)))return preserved as RuntimeErrorType;
 if(error instanceof TypeError)return'TypeError';if(error instanceof RangeError)return'RangeError';if(error instanceof SyntaxError)return'SyntaxError';return error instanceof Error?'Error':'Unknown';
 }catch{return'Unknown';}
}
/** The caller supplies a verified packet or resolved runtime member, never author content. */
export function recordRuntimeError(identity:RuntimeErrorIdentity,phase:RuntimeErrorPhase,error:unknown,context:{mountId?:string;operation?:string}={}){
 if(!localToolNamespace(identity.packageNamespace)||!localToolContentHash(identity.contentHash)||!RUNTIME_ERROR_PHASES.includes(phase)||identity.namespace!==undefined&&!localToolNamespace(identity.namespace))return;
 const key=JSON.stringify([identity.contentHash,identity.namespace??null,phase,context.mountId??null,context.operation??null]),old=entries.get(key),now=Date.now();
 entries.set(key,Object.freeze({...identity,id:old?.id??'runtime-error-'+ ++nextId,firstAt:old?.firstAt??now,lastAt:now,count:(old?.count??0)+1,phase,code:'local_runtime_'+phase+'_failed',message:messages[phase],errorType:runtimeErrorType(error),...(context.mountId?{mountId:context.mountId}:{}),...(context.operation?{operation:context.operation}:{})}));publish();
}
function filters(value:RuntimeErrorFilters){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['namespace','contentHash','phase'].includes(key))||value.namespace!==undefined&&!localToolNamespace(value.namespace)||value.contentHash!==undefined&&!localToolContentHash(value.contentHash)||value.phase!==undefined&&!RUNTIME_ERROR_PHASES.includes(value.phase))throw Error('local_runtime_error_filter_invalid');
 return value;
}
const matches=(entry:Readonly<RuntimeErrorEntry>,filter:RuntimeErrorFilters)=>(filter.namespace===undefined||filter.namespace===entry.packageNamespace||filter.namespace===entry.namespace)&&(filter.contentHash===undefined||filter.contentHash===entry.contentHash)&&(filter.phase===undefined||filter.phase===entry.phase);
export function listRuntimeErrors(input:RuntimeErrorFilters={}){const filter=filters(input);return{errors:snapshot.filter(entry=>matches(entry,filter)).map(entry=>({...entry})),sessionOnly:true as const};}
/** Explicit session-history clear only; inventory, loader state and boundaries are untouched. */
export function clearRuntimeErrors(input:RuntimeErrorFilters={}){const filter=filters(input);let cleared=0;for(const[key,entry]of entries)if(matches(entry,filter)){entries.delete(key);cleared++;}if(cleared)publish();return{cleared,sessionOnly:true as const};}
