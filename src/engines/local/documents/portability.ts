/** Semantic copying may fork the trusted core; portable validators remain in types.ts without it. */
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {sourceDefaultEntries} from '../stateCodecFormat';
import {projectSourceDefaults} from '../convergence/sourceAdditive';
import {remapLocalToolReferences,type LocalToolRichProseRemap} from '../stateCodec';
import {worldDocumentPrefixes} from '@/services/worldEras/documentPrefixes';
import {remapLocalToolIndexReferences} from '../documentIndex';
import {convergenceHash} from '../convergence/format';
import {prepareLocalToolFork,inspectLocalToolConvergence} from '../convergence/replica';
import {validateSourceToolDocument,validateSourceToolDocuments,type SourceToolDocument} from './types';
export function validateSourceDocumentCheckpoint(document:SourceToolDocument):void {
 const state=document.convergence;
 if(!state)return;
 if(!document.codec)throw Error('source_tool_convergence_invalid');
 const {checkpoint}=state;
 // For an old conflict, prove that the selected data is a retained snapshot
 // with valid bindings without requiring its executable validator.
 const selected=state.conflict?convergenceHash(projectSourceDefaults(document.data,sourceDefaultEntries(document.codec))):undefined;
 const contract={namespace:document.namespace,codec:document.codec,validationId:checkpoint.validationId,schemaEpoch:checkpoint.schemaEpoch,
  validateState:(value:LocalToolJson):value is LocalToolJson=>selected===undefined||convergenceHash(value)===selected};
 const view=inspectLocalToolConvergence(checkpoint,{authorId:'source-portable-read',contract});
 if(view.pending||convergenceHash(view.data)!==convergenceHash(document.data)||
    convergenceHash(view.conflict)!==convergenceHash(state.conflict??null))throw Error('local_tool_source_additive_history_invalid');
}
/** Full copies and restores validate additive history before reseeding. */
export function validateSourceListDocumentHistory(document:SourceToolDocument):void{
 if(document.convergence?.checkpoint.engine.version==='8')validateSourceDocumentCheckpoint(document);
}
/** New identity/branch starts from the admitted view and keeps the old bytes intact. */
export function forkSourceToolDocument(document:SourceToolDocument):SourceToolDocument{
 validateSourceListDocumentHistory(document);
 return forkValidatedSourceToolDocument(document);
}
function forkValidatedSourceToolDocument(document:SourceToolDocument):SourceToolDocument{
 if(!document.convergence)return document;
 if(!document.codec)throw Error('source_tool_convergence_invalid');
 const {validationId,schemaEpoch}=document.convergence.checkpoint;
 const {data,checkpoint}=prepareLocalToolFork(document.data,{namespace:document.namespace,codec:document.codec,validationId,schemaEpoch});
 return {...document,data,convergence:{checkpoint}};
}
/** Stable item IDs and opaque strings survive; only real document refs remap. */
export function remapSourceToolDocument(value:SourceToolDocument,remap:(id:string,prefix:string)=>string,remapRich?:LocalToolRichProseRemap):SourceToolDocument{validateSourceToolDocument(value);validateSourceListDocumentHistory(value);const next=forkValidatedSourceToolDocument({...structuredClone(value),id:remap(value.id,'source-tool'),...(value.generation?{generation:remap(value.generation,'source-tool-generation')}:{}),revision:0,data:remapSourceIndexData(value,remap,remapRich)});validateSourceToolDocument(next);return next;}
export function remapSourceToolDocuments(value:SourceToolDocument[]|undefined,remap:(id:string,prefix:string)=>string,remapRich?:LocalToolRichProseRemap):SourceToolDocument[]|undefined{validateSourceToolDocuments(value);return value?.map(document=>remapSourceToolDocument(document,remap,remapRich));}

function remapSourceIndexData(value:SourceToolDocument,remap:(id:string,prefix:string)=>string,remapRich?:LocalToolRichProseRemap):LocalToolJson{const mapped=new Map<string,string>(),targets=new Set<string>(),map=(id:string,prefix:string)=>{const key=JSON.stringify([prefix,id]),known=mapped.get(key);if(known)return known;const target=remap(id,prefix);mapped.set(key,target);targets.add(target);return target;};const data=value.codec?remapLocalToolReferences(value.data,value.codec,(kind,id)=>map(id,worldDocumentPrefixes[kind]),(kind,id)=>map(id,kind==='image'?'img':kind==='file'?'asset-file':'media'),remapRich):cloneLocalToolJson(value.data);return value.index?remapLocalToolIndexReferences(data,value.index,(id,prefix)=>targets.has(id)?id:map(id,prefix)):data;}
