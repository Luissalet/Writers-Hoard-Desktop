import {validateLocalToolCodec,validateLocalToolCodecState,validateLocalToolReference,type LocalToolStateCodec} from './stateCodecFormat';
export {validateLocalToolCodec,validateLocalToolCodecState,validateLocalToolReference,localToolFieldKey,isLocalToolPlainField,localToolHasPlainFields,isLocalToolRichBlockField,localToolRichLinks,localToolRichTables,localToolRichTableAxes} from './stateCodecFormat';
export type {LocalToolDocumentReference,LocalToolFieldCodec,LocalToolStateCodec} from './stateCodecFormat';
import {validateLocalAssetRef,type LocalAssetRef} from './assets';
/** Portable opt-in state identities; no database or application bootstrap. */
import type {EraDocumentKind} from '@/services/worldEras/types';
import {cloneLocalToolJson,localToolNamespace,type LocalToolJson,type LocalToolStates} from './stateTypes';
export type LocalToolRichProseRemap=(html:string)=>string;
export type LocalToolContracts=Record<string,LocalToolStateCodec>;
export const LOCAL_TOOL_CONTRACTS_KEY='localToolContracts' as const;
const object=(value:unknown):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Compatible additions only; descriptor properties are primitives, and their order is immaterial. */
export function localToolCodecAdditions(stored:LocalToolStateCodec,current:LocalToolStateCodec):string[]|null{
 validateLocalToolCodec(stored);validateLocalToolCodec(current);
 for(const[key,field]of Object.entries(stored.fields)){
  const next=current.fields[key];if(!next)return null;
  const before=Object.entries(field),after=Object.entries(next);
  if(before.length!==after.length||before.some(([name,value])=>!Object.hasOwn(next,name)||(next as unknown as Record<string,unknown>)[name]!==value))return null;
 }
 return Object.keys(current.fields).filter(key=>!Object.hasOwn(stored.fields,key));
}
export function validateLocalToolContracts(value:unknown):asserts value is LocalToolContracts|undefined{if(value===undefined)return;const safe=cloneLocalToolJson(value as LocalToolJson);if(!object(safe))throw Error('local_tool_contracts_invalid');for(const [namespace,codec]of Object.entries(safe)){if(!localToolNamespace(namespace))throw Error('local_tool_contracts_invalid');validateLocalToolCodec(codec);}}
/** Remap declared references only; opaque strings/prose and stable local item IDs remain exact. */
export function remapLocalToolReferences<T extends LocalToolJson>(data:T,codec:LocalToolStateCodec,remap:(kind:EraDocumentKind,id:string)=>string,remapAsset?:(kind:'media'|'image'|'file',id:string)=>string,remapRich?:LocalToolRichProseRemap):T{
 validateLocalToolCodecState(data,codec);const next=cloneLocalToolJson(data) as Record<string,LocalToolJson>;const ref=(value:LocalToolJson)=>{if(value===null)return value;validateLocalToolReference(value);return{kind:value.kind,documentId:remap(value.kind,value.documentId)};};
 const asset=(value:LocalToolJson)=>{if(value===null)return value;validateLocalAssetRef(value);const ref=value as LocalAssetRef;return ref.kind==='source'?ref:{...ref,id:remapAsset?remapAsset(ref.kind,ref.id):ref.kind==='media'?remap('media',ref.id):ref.id};};
 for(const [key,field]of Object.entries(codec.fields)){const value=next[key];if(value===undefined)continue;if(field.kind==='prose'&&field.format==='rich'){if(!remapRich)throw Error('local_tool_rich_prose_remap_required');next[key]=remapRich(value as string);}else if(field.kind==='reference')next[key]=ref(value);else if(field.kind==='asset-reference')next[key]=asset(value);else if(field.kind==='map'&&field.assetReferenceValues)next[key]=Object.fromEntries(Object.entries(value as Record<string,LocalToolJson>).map(([name,value])=>[name,asset(value)]));else if(field.kind==='map'&&field.referenceValues)next[key]=Object.fromEntries(Object.entries(value as Record<string,LocalToolJson>).map(([name,value])=>[name,ref(value)]));else if(field.kind==='list'&&field.referenceKey){const referenceKey=field.referenceKey;next[key]=(value as Record<string,LocalToolJson>[]).map(item=>({...item,...(item[referenceKey]!==undefined?{[referenceKey]:ref(item[referenceKey])}:{})}));}}
 return next as T;
}

export function validateLocalToolContractStates(project:{localToolContracts?:unknown;localToolStates?:LocalToolStates;worldEras?:readonly {localToolStates?:LocalToolStates}[]}):void{validateLocalToolContracts(project.localToolContracts);for(const [namespace,codec]of Object.entries(project.localToolContracts??{}))for(const states of [project.localToolStates,...(project.worldEras??[]).map(era=>era.localToolStates)])if(states?.[namespace])validateLocalToolCodecState(states[namespace].data,codec);}

/** Explicit opt-in; legacy plain/rich prose stays atomic. */

