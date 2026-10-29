import {sha256Hex} from '@/services/aiRuntime/recipe';
import {localToolNamespace,type LocalToolJson} from '../stateTypes';
import {validateLocalToolCodec,localToolHasPlainFields,type LocalToolStateCodec} from '../stateCodec';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata,LocalToolConvergenceReceipt,LocalToolConvergenceUpdate,LocalToolValidationConflict,LocalToolPlainRange,LocalToolConvergenceIdentityV1,LocalToolConvergenceIdentityV2} from './types';

export const LOCAL_TOOL_CONVERGENCE_ENGINE:LocalToolConvergenceIdentityV1['engine']=Object.freeze({id:'writers-hoard-yjs-registers',version:'1',updateFormat:'yjs-v1',libraryVersion:'13.6.33'});
export const LOCAL_TOOL_PLAIN_ENGINE:LocalToolConvergenceIdentityV2['engine']=Object.freeze({...LOCAL_TOOL_CONVERGENCE_ENGINE,version:'2'});
export const convergenceEngine=(codec:LocalToolStateCodec):LocalToolConvergenceIdentity['engine']=>localToolHasPlainFields(codec)?LOCAL_TOOL_PLAIN_ENGINE:LOCAL_TOOL_CONVERGENCE_ENGINE;
const fail=():never=>{throw Error('local_tool_convergence_format_invalid');};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
/** Causal envelopes may contain wrapped state/history larger or deeper than one state.
 * State limits remain enforced on data by the existing codec/writer, not on its envelope. */
export function convergenceClone<T>(value:T):T {
 const active=new Set<object>();
 const visit=(value:unknown):unknown=>{
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||active.has(value))return fail();active.add(value);
  try{
   if(Array.isArray(value)){
    if(Reflect.ownKeys(value).length!==value.length+1)return fail();
    return Array.from({length:value.length},(_,index)=>{const property=Object.getOwnPropertyDescriptor(value,String(index));if(!property||!('value'in property)||!property.enumerable)return fail();return visit(property.value);});
   }
   if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return fail();
   return Object.fromEntries(Reflect.ownKeys(value).map(key=>{if(typeof key!=='string')return fail();const property=Object.getOwnPropertyDescriptor(value,key)!;if(!('value'in property)||!property.enumerable)return fail();return[key,visit(property.value)];}));
  }finally{active.delete(value);}
 };
 return visit(value) as T;
}
/** Canonical object keys only; array order and opaque strings remain literal. */
export function convergenceCanonical(value:unknown):string {
 const safe=convergenceClone(value) as LocalToolJson;
 const canonical=(value:LocalToolJson):LocalToolJson=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 return JSON.stringify(canonical(safe));
}
export const convergenceHash=(value:unknown):string=>sha256Hex(convergenceCanonical(value));
export function convergenceCodecHash(codec:LocalToolStateCodec):string {validateLocalToolCodec(codec);return convergenceHash(codec);}
export function convergenceBase64(bytes:Uint8Array):string {
 let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}
export function convergenceBytes(base64:string):Uint8Array {
 // Repeating one character avoids overflowing the regexp stack on large envelopes.
 if(typeof base64!=='string'||base64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(base64))return fail();
 const binary=atob(base64),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));if(convergenceBase64(bytes)!==base64)return fail();return bytes;
}
export function validateConvergenceMetadata(value:LocalToolConvergenceMetadata):void {
 if(!object(value)||!localToolNamespace(value.namespace)||!text(value.validationId)||!text(value.schemaEpoch))fail();
 validateLocalToolCodec(value.codec);
}
export function convergenceIdentity(metadata:LocalToolConvergenceMetadata,genesisId:string):LocalToolConvergenceIdentity {
 validateConvergenceMetadata(metadata);if(!text(genesisId))fail();const fields={namespace:metadata.namespace,genesisId,codecHash:convergenceCodecHash(metadata.codec),validationId:metadata.validationId,schemaEpoch:metadata.schemaEpoch},engine=convergenceEngine(metadata.codec);if(engine.version==='1')return{...fields,engine};return{...fields,engine};
}
const identityKeys=['namespace','genesisId','engine','codecHash','validationId','schemaEpoch'] as const;
export function validateConvergenceIdentity(value:unknown):asserts value is LocalToolConvergenceIdentity {
 if(!object(value)||!localToolNamespace(value.namespace)||!text(value.genesisId)||!text(value.validationId)||!text(value.schemaEpoch)||typeof value.codecHash!=='string'||! /^[a-f0-9]{64}$/.test(value.codecHash)||![LOCAL_TOOL_CONVERGENCE_ENGINE,LOCAL_TOOL_PLAIN_ENGINE].some(engine=>convergenceCanonical(value.engine)===convergenceCanonical(engine)))fail();
}
/** JSON-only shape validation. Does not execute an engine, registry or package callback. */
export function validateLocalToolConvergenceCheckpoint(value:unknown):asserts value is LocalToolConvergenceCheckpoint {
 convergenceClone(value);validateConvergenceIdentity(value);
 if(!exact(value as unknown as Record<string,unknown>,['format',...identityKeys,'checkpointBase64','stateVectorBase64'])||(value as LocalToolConvergenceCheckpoint).format!=='writers-hoard-local-convergence/1')fail();
 convergenceBytes((value as LocalToolConvergenceCheckpoint).checkpointBase64);convergenceBytes((value as LocalToolConvergenceCheckpoint).stateVectorBase64);
}
export function validateLocalToolConvergenceUpdate(value:unknown):asserts value is LocalToolConvergenceUpdate {
 convergenceClone(value);validateConvergenceIdentity(value);
 if(!exact(value as unknown as Record<string,unknown>,['format',...identityKeys,'updateBase64'])||(value as LocalToolConvergenceUpdate).format!=='writers-hoard-local-convergence-update/1')fail();
 convergenceBytes((value as LocalToolConvergenceUpdate).updateBase64);
}
export function convergenceIdentityOf(value:LocalToolConvergenceIdentity):LocalToolConvergenceIdentity {
 return Object.fromEntries(identityKeys.map(key=>[key,structuredClone(value[key])])) as unknown as LocalToolConvergenceIdentity;
}
export function assertConvergenceIdentity(value:LocalToolConvergenceIdentity,expected:LocalToolConvergenceIdentity):void {
 if(convergenceCanonical(convergenceIdentityOf(value))!==convergenceCanonical(expected))throw Error('local_tool_convergence_identity_mismatch');
}
export function validateLocalToolConvergenceReceipt(value:unknown):asserts value is LocalToolConvergenceReceipt {
 convergenceClone(value);
 if(!object(value)||!exact(value,['format','id','identity','mode','record'])||value.format!=='writers-hoard-local-convergence-receipt/1'||!text(value.id)||!['undo','redo'].includes(value.mode as string)||!object(value.identity)||!exact(value.identity,identityKeys)||!object(value.record))fail();
 validateConvergenceIdentity((value as {identity:unknown}).identity);
}
export function validateLocalToolValidationConflict(value:unknown):asserts value is LocalToolValidationConflict|null {
 if(value===null)return;convergenceClone(value);
 if(!object(value)||!exact(value,['kind','policy','validationId','rawFingerprint','raw'])||value.kind!=='validation'||value.policy!=='authored-valid-snapshot/1'||!text(value.validationId)||typeof value.rawFingerprint!=='string'||convergenceHash(value.raw)!==value.rawFingerprint)fail();
}

/** Causal selection envelope, not an admitted-state JSON budget. Never starts a history. */
export function validateLocalToolPlainRange(value:unknown):asserts value is LocalToolPlainRange {
 convergenceClone(value);
 if(!object(value)||!exact(value,['format','identity','field','afterPlacementId','deleteIds'])||value.format!=='writers-hoard-local-plain-range/1'||!text(value.field)||value.afterPlacementId!==null&&!text(value.afterPlacementId)||!Array.isArray(value.deleteIds)||value.deleteIds.some(id=>!text(id))||new Set(value.deleteIds).size!==value.deleteIds.length)return fail();
 validateConvergenceIdentity(value.identity);if(!exact(value.identity as unknown as Record<string,unknown>,identityKeys)||value.identity.engine.version!=='2')fail();
}
