import type {ComponentType} from 'react';
import type {LocalToolClient,LocalToolProps} from '../sdk';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {localToolCodecAdditions,validateLocalToolCodecState,type LocalToolStateCodec} from '../stateCodec';
import {localToolStateEqual,mergeLocalToolActions,type LocalToolStateAction} from '../stateActions';
import type {LocalToolPreviewSpec} from '../previewTypes';
import {validateLocalToolBlockEnvelope,type LocalToolBlockEnvelope,type LocalToolOwnedBlockEnvelope,type LocalToolWorldBlockQuery} from './types';
interface Common {key:string;name:{en:string;es:string};preview?:LocalToolPreviewSpec}
export interface LocalToolOwnedBlockDefinition<T extends LocalToolJson=LocalToolJson> extends Common {scope:'host';codecEvolution?:'additive';initialState:T;codec:LocalToolStateCodec;validateState:(data:LocalToolJson)=>data is T;component:ComponentType<LocalToolProps<T>>}
export interface LocalToolWorldBlockProps {projectId:string;client:Pick<LocalToolClient<LocalToolJson>,'projectId'|'namespace'|'eraId'|'world'|'queryCodex'|'refs'|'search'|'openDocument'|'subscribe'|'locale'>}
export interface LocalToolWorldBlockDefinition extends Common {scope:'world';world:LocalToolWorldBlockQuery;component:ComponentType<LocalToolWorldBlockProps>}
export type LocalToolBlockDefinition=LocalToolOwnedBlockDefinition|LocalToolWorldBlockDefinition;
/** Erase only the component's generic at the validated source-registration boundary. */
export function defineLocalToolBlock<T extends LocalToolJson>(definition:LocalToolOwnedBlockDefinition<T>):LocalToolOwnedBlockDefinition {if(definition.codecEvolution!==undefined&&definition.codecEvolution!=='additive')throw Error('local_tool_block_definition_changed');validateLocalToolCodecState(definition.initialState,definition.codec);if(!definition.validateState(cloneLocalToolJson(definition.initialState)))throw Error('local_tool_block_state_invalid');return definition as unknown as LocalToolOwnedBlockDefinition;}
export function createLocalToolBlockEnvelope(namespace:string,definition:LocalToolBlockDefinition,id:string=crypto.randomUUID()):LocalToolBlockEnvelope {const base={version:1 as const,id,namespace,key:definition.key,name:structuredClone(definition.name),...(definition.preview?{preview:structuredClone(definition.preview)}:{})};const envelope:LocalToolBlockEnvelope=definition.scope==='host'?{...base,scope:'host',revision:0,data:cloneLocalToolJson(definition.initialState),codec:structuredClone(definition.codec)}:{...base,scope:'world',world:structuredClone(definition.world)};validateLocalToolBlockEnvelope(envelope);return envelope;}
export function validateLocalToolBlockDefinition(namespace:string,definition:LocalToolBlockDefinition){createLocalToolBlockEnvelope(namespace,definition,'validate');if(typeof definition.component!=='function'&&typeof definition.component!=='object')throw Error('local_tool_block_component_invalid');}
function projectAddedFields(data:LocalToolJson,definition:LocalToolOwnedBlockDefinition,added:readonly string[]):LocalToolJson{
 const view=cloneLocalToolJson(data) as Record<string,LocalToolJson>,initial=definition.initialState as Record<string,LocalToolJson>;
 for(const key of added){
  if(!Object.hasOwn(initial,key))throw Error('local_tool_block_state_invalid');
  if(Object.hasOwn(view,key))continue;
  const field=definition.codec.fields[key];view[key]=field.kind==='list'?[]:field.kind==='map'?{}:cloneLocalToolJson(initial[key]);
 }
 validateLocalToolCodecState(view,definition.codec);if(!definition.validateState(cloneLocalToolJson(view)))throw Error('local_tool_block_state_invalid');return view;
}
/** The editable view is derived; callers retain the RAW envelope for CAS and portability. */
export function readOwnedBlockState(envelope:LocalToolOwnedBlockEnvelope,definition:LocalToolOwnedBlockDefinition):{data:LocalToolJson;pending:boolean}{
 validateLocalToolBlockEnvelope(envelope);if(envelope.key!==definition.key||definition.scope!=='host')throw Error('local_tool_block_definition_changed');
 let added:string[]=[];
 if(JSON.stringify(envelope.codec)!==JSON.stringify(definition.codec)){
  const compatible=definition.codecEvolution==='additive'?localToolCodecAdditions(envelope.codec,definition.codec):null;
  if(!compatible)throw Error('local_tool_block_state_invalid');added=compatible;
 }
 validateLocalToolCodecState(envelope.data,definition.codec);if(!definition.validateState(cloneLocalToolJson(envelope.data)))throw Error('local_tool_block_state_invalid');
 return{data:added.length?projectAddedFields(envelope.data,definition,added):cloneLocalToolJson(envelope.data),pending:added.length>0};
}
/** Explicit replacement; an equal pending view preserves RAW metadata/default absence. */
export function saveOwnedBlockState(envelope:LocalToolOwnedBlockEnvelope,definition:LocalToolOwnedBlockDefinition,data:LocalToolJson):LocalToolOwnedBlockEnvelope{
 const current=readOwnedBlockState(envelope,definition);validateLocalToolCodecState(data,definition.codec);if(!definition.validateState(cloneLocalToolJson(data)))throw Error('local_tool_block_state_invalid');
 const adopt=current.pending&&!localToolStateEqual(current.data,data),{preview:oldPreview,...base}=envelope;void oldPreview;
 const next:LocalToolOwnedBlockEnvelope=adopt?{...base,revision:envelope.revision+1,data:cloneLocalToolJson(data),codec:structuredClone(definition.codec),...(definition.preview?{preview:structuredClone(definition.preview)}:{})}:{...envelope,revision:envelope.revision+1,data:cloneLocalToolJson(current.pending?envelope.data:data)};
 validateLocalToolBlockEnvelope(next);return next;
}
export function applyOwnedBlockActions(envelope:LocalToolOwnedBlockEnvelope,definition:LocalToolOwnedBlockDefinition,baseline:LocalToolJson,actions:readonly LocalToolStateAction[]){
 const current=readOwnedBlockState(envelope,definition),added=current.pending?localToolCodecAdditions(envelope.codec,definition.codec)!:[];
 const before=current.pending?projectAddedFields(baseline,definition,added):baseline,merged=mergeLocalToolActions(definition.codec,before,current.data,actions),changed=!localToolStateEqual(current.data,merged.data);
 return{envelope:saveOwnedBlockState(envelope,definition,merged.data),changed};
}
export function validateBlockForDefinition(envelope:LocalToolBlockEnvelope,definition:LocalToolBlockDefinition){validateLocalToolBlockEnvelope(envelope);if(envelope.key!==definition.key||envelope.scope!==definition.scope)throw Error('local_tool_block_definition_changed');if(envelope.scope==='host'&&definition.scope==='host'){readOwnedBlockState(envelope,definition);}else if(envelope.scope==='world'&&definition.scope==='world'&&JSON.stringify(envelope.world)!==JSON.stringify(definition.world))throw Error('local_tool_block_definition_changed');}
