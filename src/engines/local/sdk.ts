export {localAssetFile} from './assets';
export {useLocalToolAsset} from './useLocalToolAsset';
export type {LocalAssetRef,LocalAssetSpec,LocalAssetManifest,LocalAssetResolved,LocalAssetOverrides,LocalToolAssets} from './assets';
import {HOST_ASSET_NAMESPACE,validateLocalAssetManifest,type LocalAssetManifest,type LocalAssetFiles} from './assets';
export {defineLocalToolBlock} from './blocks/definitions';
export {useLocalToolWorldList,useLocalToolWorldRead} from './useLocalToolWorld';
export {useSound,useAudioPlayer} from './useLocalToolAudio';
export type {LocalToolAudio,LocalAudioRef,LocalAudioOptions,LocalAudioUpdate,LocalAudioState,LocalAudioBus,LocalAudioFocus} from './audio';
export type {LocalToolWorldClient} from './useLocalToolWorld';
export type {LocalToolBlockDefinition,LocalToolOwnedBlockDefinition,LocalToolWorldBlockDefinition,LocalToolWorldBlockProps} from './blocks/definitions';
export type {LocalToolBlockEnvelope,LocalToolOwnedBlockEnvelope,LocalToolWorldBlockEnvelope,LocalToolBlockOwner,LocalToolBlockDataOwner} from './blocks/types';
export type {LocalToolPreviewSpec} from './previewTypes';
import {validateLocalToolBlockDefinition,type LocalToolBlockDefinition} from './blocks/definitions';
import {validateLocalToolPreviewSpec,type LocalToolPreviewSpec} from './previewTypes';
import {validateLocalToolCodec,validateLocalToolCodecState,type LocalToolStateCodec} from './stateCodec';
import type {createLocalToolReferences} from './references';
import type {LocalToolStateActions} from './stateRuntime';
export type {LocalToolStateCodec,LocalToolContracts,LocalToolDocumentReference} from './stateCodec';
export type {LocalToolStateAction} from './stateActions';
export type {LocalToolActionResult,LocalToolStateActions} from './stateRuntime';
import type {ComponentType} from 'react';
import type {CodexEntryType} from '@/types';
import {cloneLocalToolJson,localToolNamespace,LocalToolStateError,type LocalToolJson} from './stateTypes';
import type { BridgeTool, BridgeToolSchema } from '@/services/aiBridge/schema';
import type { EraDocument, EraDocumentKind, EraDocumentRead } from '@/services/worldEras/types';
import type { LocalMediaAsset } from '@/engines/media/types';
import type { ContentSearchHit } from '@/services/projectSearchIndex';
import {validateLocalOperationSchema} from './operationSchema';
import {validateLocalToolIndexSpec,type LocalToolDocumentQuery,type LocalToolIndexRow,type LocalToolIndexSpec} from './documentIndex';
export {evaluateLocalToolIndex,queryLocalToolIndexRows} from './documentIndex';
export type {LocalToolDocumentQuery,LocalToolIndexSpec,LocalToolIndexRow,LocalToolIndexPredicate} from './documentIndex';
export type {LocalToolJson,LocalToolState} from './stateTypes';
export type {EraDocument,EraDocumentKind,EraDocumentRead} from '@/services/worldEras/types';
export interface LocalToolSnapshot<T extends LocalToolJson>{revision:number|null;updatedAt:number|null;data:T;document?:{id:string;namespace:string;title:string;version:string;lineage:string};block?:{id:string;owner:import('./blocks/types').LocalToolBlockDataOwner;version:string;lineage:string};provenance?:'base'|'variant'}
export interface LocalToolWorldRead extends EraDocumentRead{projection?:{fields:Record<string,string>}}
export interface LocalToolCodexCard{id:string;title:string;type:CodexEntryType;tags:string[];fields:Record<string,string>;truncated:boolean}
export interface LocalToolCodexQuery{query?:string;type?:CodexEntryType;ids?:readonly string[];limit?:number}
export interface LocalToolClient<T extends LocalToolJson>{
  readonly assets:import('./assets').LocalToolAssets;
  readonly audio?:import('./audio').LocalToolAudio;
  readonly projectId:string;readonly namespace:string;readonly documentId?:string;readonly eraId?:string;
  readonly refs:ReturnType<typeof createLocalToolReferences>;readonly state?:LocalToolStateActions<T>;
  subscribe?(changed:()=>void):()=>void;
  read():Promise<LocalToolSnapshot<T>>;save(data:T,expectedRevision:number|null,expectedDocumentVersion?:string):Promise<LocalToolSnapshot<T>>;
  queryCodex(query?:LocalToolCodexQuery):Promise<LocalToolCodexCard[]>;
  world:{list(kind:EraDocumentKind):Promise<LocalToolWorldRead[]>;read(kind:EraDocumentKind,id:string):Promise<LocalToolWorldRead|undefined>;variants?:{save(kind:EraDocumentKind,document:EraDocument,expectedVersion:string|null):Promise<EraDocumentRead>;hide(kind:EraDocumentKind,id:string,expectedVersion:string):Promise<void>}};
  tools():Promise<BridgeTool[]>;
  callTool(name:string,args?:Record<string,LocalToolJson>):Promise<LocalToolJson>;
  media:{list():Promise<LocalMediaAsset[]>;import(file:File):Promise<LocalMediaAsset>};
  search(query:string,limit?:number):Promise<ContentSearchHit[]>;
  queryDocuments(query?:LocalToolDocumentQuery):Promise<LocalToolIndexRow[]>;
  openDocument(kind:EraDocumentKind,id:string):Promise<void>;
}
export interface LocalToolOperation<T extends LocalToolJson=LocalToolJson>{id:string;description:{en:string;es:string};writes:boolean;inputSchema:BridgeToolSchema;run:(input:Record<string,LocalToolJson>,client:LocalToolClient<T>)=>Promise<LocalToolJson>}
export interface LocalToolHostContext {view:'editor'|'embed'|'fullscreen';canEdit:boolean;scope:{projectId:string;eraId?:string};document?:{id:string;namespace:string;title:string}}
export interface LocalToolProps<T extends LocalToolJson>{projectId:string;client:LocalToolClient<T>;context?:LocalToolHostContext}
export interface LocalToolDefinition<T extends LocalToolJson=LocalToolJson>{readonly apiVersion:1;assets?:LocalAssetManifest;assetFiles?:LocalAssetFiles;blocks?:readonly LocalToolBlockDefinition[];codec?:LocalToolStateCodec;index?:LocalToolIndexSpec;document?:{defaultTitle:{en:string;es:string};embed?:'preview'|'interactive'};preview?:LocalToolPreviewSpec;namespace:string;name:{en:string;es:string};description:{en:string;es:string};initialState:T;validateState:(value:LocalToolJson)=>value is T;component:ComponentType<LocalToolProps<T>>;operations?:readonly LocalToolOperation<T>[]}
export function defineLocalTool<T extends LocalToolJson>(definition:Omit<LocalToolDefinition<T>,'apiVersion'>):LocalToolDefinition<T>{
  if(definition.namespace===HOST_ASSET_NAMESPACE)throw Error('local_tool_reserved_namespace');
  if(definition.assets)validateLocalAssetManifest(definition.assets,definition.assetFiles??{});
  if(!localToolNamespace(definition.namespace))throw new LocalToolStateError('invalid-namespace');
  for(const copy of [definition.name,definition.description])for(const locale of ['en','es']as const)if(typeof copy?.[locale]!=='string'||!copy[locale].trim()||copy[locale].length>500)throw new Error('invalid_local_tool_metadata');
  if(definition.document)for(const locale of ['en','es']as const)if(typeof definition.document.defaultTitle?.[locale]!=='string'||!definition.document.defaultTitle[locale].trim())throw Error('source_tool_document_invalid');
  if(definition.document?.embed&&!['preview','interactive'].includes(definition.document.embed))throw Error('source_tool_document_invalid');if(definition.preview)validateLocalToolPreviewSpec(definition.preview);
  if(definition.codec)validateLocalToolCodec(definition.codec);
  if(definition.index)validateLocalToolIndexSpec(definition.index);
  const blockKeys=new Set<string>();for(const block of definition.blocks??[]){if(blockKeys.has(block.key))throw Error('local_tool_block_key_duplicate');blockKeys.add(block.key);validateLocalToolBlockDefinition(definition.namespace,block);}
  const initialState=cloneLocalToolJson(definition.initialState);if(definition.validateState(initialState)!==true)throw new LocalToolStateError('invalid-state');
  if(definition.codec)validateLocalToolCodecState(initialState,definition.codec);
  const seen=new Set<string>();
  const operations=(definition.operations??[]).map(operation=>{
    if(!/^[a-z][a-z0-9_]{0,79}$/.test(operation.id)||seen.has(operation.id)||typeof operation.writes!=='boolean'||typeof operation.run!=='function')throw new Error('invalid_local_tool_operation');
    seen.add(operation.id);
    for(const locale of ['en','es']as const)if(!operation.description?.[locale]?.trim())throw new Error('invalid_local_tool_operation_description');
    const schema=cloneLocalToolJson(operation.inputSchema as unknown as LocalToolJson) as unknown as BridgeToolSchema;
    if(schema.type!=='object'||!schema.properties||Array.isArray(schema.properties))throw new Error('invalid_local_tool_operation_schema');
    validateLocalOperationSchema(schema);
    return Object.freeze({...operation,description:{...operation.description},inputSchema:schema});
  });
  return Object.freeze({...definition,...(definition.index?{index:cloneLocalToolJson(definition.index as unknown as LocalToolJson) as unknown as LocalToolIndexSpec}:{}),...(definition.codec?{codec:cloneLocalToolJson(definition.codec as unknown as LocalToolJson) as unknown as LocalToolStateCodec}:{}),initialState,operations:Object.freeze(operations),apiVersion:1 as const});
}
