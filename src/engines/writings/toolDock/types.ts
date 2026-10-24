import type {LocalToolRichProseRemap} from '@/engines/local/stateCodec';
/** Portable dock metadata only. Safe for backup/bootstrap/Node without DB or UI. */
import {validateLocalToolBlockEnvelope,remapLocalToolBlockEnvelope,type LocalToolOwnedBlockEnvelope,type LocalToolWorldBlockEnvelope} from '@/engines/local/blocks/types';
import {localToolNamespace} from '@/engines/local/stateTypes';
import {worldDocumentPrefixes} from '@/services/worldEras/documentPrefixes';
export const TOOL_DOCK_DOCUMENT_KINDS=['codex','maps','board','timeline','genealogy','dictionary','tables','character-sheets','radar','model-viewer','local-tool'] as const;
export type ToolDockDocumentKind=typeof TOOL_DOCK_DOCUMENT_KINDS[number];
export interface ToolDockDocumentReference {kind:ToolDockDocumentKind;documentId:string;namespace?:string;label?:string}
/** A tile: its height, and on a wide dock how many of the two columns it spans (1 when absent). */
interface Slot {id:string;height?:number;span?:1|2}
export type ToolDockBlock=
 |Slot&{kind:'document';target:ToolDockDocumentReference;presentation?:'preview'|'editor'}
 |Slot&{kind:'owned';envelope:LocalToolOwnedBlockEnvelope}
 |Slot&{kind:'world';envelope:LocalToolWorldBlockEnvelope};
export interface ToolDockLayout {version:1;revision:number;generation:string;blocks:ToolDockBlock[]}
export type ToolDockValue=ToolDockLayout|null|undefined;
export type ToolDockOwner={kind:'project'}|{kind:'writings';documentId:string};
const identity=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&![...value].some(char=>char.charCodeAt(0)<32);
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('tool_dock_invalid');for(const key of Reflect.ownKeys(value)){if(typeof key!=='string'||!keys.includes(key))throw Error('tool_dock_invalid');const descriptor=Object.getOwnPropertyDescriptor(value,key)!;if(!descriptor.enumerable||!('value'in descriptor))throw Error('tool_dock_invalid');}return value as Record<string,unknown>;}
export function validateToolDockLayout(value:unknown):asserts value is ToolDockValue {
 if(value===undefined||value===null)return;const layout=record(value,['version','revision','generation','blocks']);if(layout.version!==1||!Number.isSafeInteger(layout.revision)||Number(layout.revision)<0||!identity(layout.generation)||!Array.isArray(layout.blocks))throw Error('tool_dock_invalid');const ids=new Set<string>();
 for(let index=0;index<layout.blocks.length;index++){const descriptor=Object.getOwnPropertyDescriptor(layout.blocks,String(index));if(!descriptor||!('value'in descriptor))throw Error('tool_dock_invalid');const block=record(descriptor.value,['id','height','span','kind','target','presentation','envelope']);if(!identity(block.id)||ids.has(block.id)||block.height!==undefined&&(typeof block.height!=='number'||!Number.isFinite(block.height)||block.height<=0)||block.span!==undefined&&block.span!==1&&block.span!==2)throw Error('tool_dock_invalid');ids.add(block.id);
  if(block.kind==='document'){if(Object.hasOwn(block,'envelope')||block.presentation!==undefined&&block.presentation!=='preview'&&block.presentation!=='editor')throw Error('tool_dock_invalid');const target=record(block.target,['kind','documentId','namespace','label']);if(!TOOL_DOCK_DOCUMENT_KINDS.includes(target.kind as ToolDockDocumentKind)||!identity(target.documentId)||target.label!==undefined&&typeof target.label!=='string'||(target.kind==='local-tool'?!localToolNamespace(target.namespace):target.namespace!==undefined))throw Error('tool_dock_reference_invalid');}
  else if(block.kind==='owned'||block.kind==='world'){if(Object.hasOwn(block,'target')||Object.hasOwn(block,'presentation'))throw Error('tool_dock_invalid');validateLocalToolBlockEnvelope(block.envelope);if(block.envelope.id!==block.id||block.envelope.scope!==(block.kind==='owned'?'host':'world'))throw Error('tool_dock_invalid');}
  else throw Error('tool_dock_invalid');
 }
 if(Reflect.ownKeys(layout.blocks).length!==layout.blocks.length+1)throw Error('tool_dock_invalid');
}
export function validateToolDockProjectMetadata(project:{writingToolDock?:unknown;worldEras?:readonly {defaults?:{writingToolDock?:unknown}}[]}):void{validateToolDockLayout(project.writingToolDock);for(const era of project.worldEras??[])validateToolDockLayout(era.defaults?.writingToolDock);}
export function validateToolDockWritingMetadata(writing:{toolDock?:unknown}):void{validateToolDockLayout(writing.toolDock);}
export function toolDockSourceEnvelopes(value:unknown):Array<LocalToolOwnedBlockEnvelope|LocalToolWorldBlockEnvelope>{validateToolDockLayout(value);return value?.blocks.flatMap(block=>block.kind==='document'?[]:[block.envelope])??[];}
export function renewToolDockGeneration<T extends ToolDockValue>(value:T,generation:string):T{validateToolDockLayout(value);if(!identity(generation))throw Error('tool_dock_generation_invalid');return(value?{...structuredClone(value),generation}:value) as T;}
export function remapToolDockLayout<T extends ToolDockValue>(value:T,remap:(id:string,prefix:string)=>string,remapRich?:LocalToolRichProseRemap):T{validateToolDockLayout(value);if(!value)return value;const blocks:ToolDockBlock[]=value.blocks.map(block=>{if(block.kind==='document')return{...structuredClone(block),id:remap(block.id,'tool-dock-block'),target:{...block.target,documentId:remap(block.target.documentId,worldDocumentPrefixes[block.target.kind])}};const envelope=remapLocalToolBlockEnvelope(block.envelope,remap,remapRich);return{...structuredClone(block),id:envelope.id,envelope} as ToolDockBlock;});const next={...value,generation:remap(value.generation,'tool-dock-generation'),revision:0,blocks};validateToolDockLayout(next);return next as T;}
