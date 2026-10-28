import {validateLocalToolPreviewSpec,type LocalToolPreviewSpec} from '../previewTypes';
/** Pure portable documents. No code registry, DB, React or source module loading. */
import {cloneLocalToolJson,localToolNamespace,type LocalToolJson} from '../stateTypes';
import {validateLocalToolCodecState,type LocalToolStateCodec} from '../stateCodec';
import {validateLocalToolIndexSpec,type LocalToolIndexSpec} from '../documentIndex';
import type {LocalToolConvergenceCheckpoint,LocalToolValidationConflict} from '../convergence/types';
import {validateLocalToolConvergenceCheckpoint,validateLocalToolValidationConflict,convergenceCodecHash,convergenceClone} from '../convergence/format';
export interface SourceToolConvergence {checkpoint:LocalToolConvergenceCheckpoint;conflict?:LocalToolValidationConflict}
export interface SourceToolDocument {id:string;namespace:string;title:string;generation?:string;revision:number;createdAt:number;updatedAt:number;data:LocalToolJson;codec?:LocalToolStateCodec;preview?:LocalToolPreviewSpec;index?:LocalToolIndexSpec;convergence?:SourceToolConvergence}
export const SOURCE_TOOL_DOCUMENTS_KEY='sourceToolDocuments' as const;
export const SOURCE_TOOL_DOCUMENT_KIND='local-tool' as const;
export function validateSourceToolDocument(value:unknown):asserts value is SourceToolDocument{const row=convergenceClone(value) as unknown as SourceToolDocument;if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id||!localToolNamespace(row.namespace)||typeof row.title!=='string'||!row.title.trim()||!Number.isSafeInteger(row.revision)||row.revision<0||![row.createdAt,row.updatedAt].every(time=>Number.isSafeInteger(time)&&time>=0)||!Object.hasOwn(row,'data')||Object.keys(row).some(key=>!['id','namespace','title','generation','revision','createdAt','updatedAt','data','codec','preview','index','convergence'].includes(key)))throw Error('source_tool_document_invalid');cloneLocalToolJson(row.data);if(row.convergence!==undefined)validateSourceToolConvergence(row.convergence,row.namespace,row.codec);if(row.generation!==undefined&&(typeof row.generation!=='string'||!row.generation))throw Error('source_tool_document_invalid');if(row.codec)validateLocalToolCodecState(row.data,row.codec);if(row.preview)validateLocalToolPreviewSpec(row.preview);if(row.index)validateLocalToolIndexSpec(row.index);}
export function validateSourceToolDocuments(value:unknown):asserts value is SourceToolDocument[]|undefined{if(value===undefined)return;if(!Array.isArray(value))throw Error('source_tool_documents_invalid');const ids=new Set<string>();for(const document of value){validateSourceToolDocument(document);if(ids.has(document.id))throw Error('source_tool_documents_duplicate');ids.add(document.id);}}
/** Portable shape validation only: no Y engine, registry or package callback. */
export function validateSourceToolConvergence(value:unknown,namespace:string,codec:LocalToolStateCodec|undefined):asserts value is SourceToolConvergence{
 const row=convergenceClone(value) as unknown as SourceToolConvergence;
 if(!row||typeof row!=='object'||Array.isArray(row)||!codec||!Object.hasOwn(row,'checkpoint')||Object.keys(row).some(key=>!['checkpoint','conflict'].includes(key)))throw Error('source_tool_convergence_invalid');
 validateLocalToolConvergenceCheckpoint(row.checkpoint);
 if(row.checkpoint.namespace!==namespace||row.checkpoint.codecHash!==convergenceCodecHash(codec))throw Error('source_tool_convergence_identity_mismatch');
 if(row.conflict!==undefined){validateLocalToolValidationConflict(row.conflict);if(row.conflict===null||row.conflict.validationId!==row.checkpoint.validationId)throw Error('source_tool_convergence_conflict_invalid');}
}
