/** Semantic copying may fork the trusted core; portable validators remain in types.ts without it. */
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {remapLocalToolReferences,type LocalToolRichProseRemap} from '../stateCodec';
import {worldDocumentPrefixes} from '@/services/worldEras/documentPrefixes';
import {remapLocalToolIndexReferences} from '../documentIndex';
import {forkLocalToolGenesis} from '../convergence/replica';
import {validateSourceToolDocument,validateSourceToolDocuments,type SourceToolDocument,type SourceToolConvergence} from './types';
/** New identity/branch starts from the admitted view, never from patched opaque causal bytes. */
export function forkSourceToolConvergence(document:SourceToolDocument):SourceToolConvergence|undefined{
 if(!document.convergence)return undefined;
 if(!document.codec)throw Error('source_tool_convergence_invalid');
 const {validationId,schemaEpoch}=document.convergence.checkpoint;
 return{checkpoint:forkLocalToolGenesis(document.data,{namespace:document.namespace,codec:document.codec,validationId,schemaEpoch})};
}
/** Stable item IDs and opaque strings survive; only real document refs remap. */
export function remapSourceToolDocument(value:SourceToolDocument,remap:(id:string,prefix:string)=>string,remapRich?:LocalToolRichProseRemap):SourceToolDocument{validateSourceToolDocument(value);const next={...structuredClone(value),id:remap(value.id,'source-tool'),...(value.generation?{generation:remap(value.generation,'source-tool-generation')}:{}),revision:0,data:remapSourceIndexData(value,remap,remapRich)};if(value.convergence)next.convergence=forkSourceToolConvergence(next)!;validateSourceToolDocument(next);return next;}
export function remapSourceToolDocuments(value:SourceToolDocument[]|undefined,remap:(id:string,prefix:string)=>string,remapRich?:LocalToolRichProseRemap):SourceToolDocument[]|undefined{validateSourceToolDocuments(value);return value?.map(document=>remapSourceToolDocument(document,remap,remapRich));}

function remapSourceIndexData(value:SourceToolDocument,remap:(id:string,prefix:string)=>string,remapRich?:LocalToolRichProseRemap):LocalToolJson{const mapped=new Map<string,string>(),targets=new Set<string>(),map=(id:string,prefix:string)=>{const key=JSON.stringify([prefix,id]),known=mapped.get(key);if(known)return known;const target=remap(id,prefix);mapped.set(key,target);targets.add(target);return target;};const data=value.codec?remapLocalToolReferences(value.data,value.codec,(kind,id)=>map(id,worldDocumentPrefixes[kind]),(kind,id)=>map(id,kind==='image'?'img':kind==='file'?'asset-file':'media'),remapRich):cloneLocalToolJson(value.data);return value.index?remapLocalToolIndexReferences(data,value.index,(id,prefix)=>targets.has(id)?id:map(id,prefix)):data;}
