import type {ComponentType} from 'react';
import type {CodexEntryType} from '@/types';
import {cloneLocalToolJson,localToolNamespace,LocalToolStateError,type LocalToolJson} from './stateTypes';
export type {LocalToolJson,LocalToolState} from './stateTypes';
export interface LocalToolSnapshot<T extends LocalToolJson>{revision:number|null;updatedAt:number|null;data:T}
export interface LocalToolCodexCard{id:string;title:string;type:CodexEntryType;tags:string[];fields:Record<string,string>;truncated:boolean}
export interface LocalToolCodexQuery{query?:string;type?:CodexEntryType;ids?:readonly string[];limit?:number}
export interface LocalToolClient<T extends LocalToolJson>{readonly projectId:string;readonly namespace:string;read():Promise<LocalToolSnapshot<T>>;save(data:T,expectedRevision:number|null):Promise<LocalToolSnapshot<T>>;queryCodex(query?:LocalToolCodexQuery):Promise<LocalToolCodexCard[]>}
export interface LocalToolProps<T extends LocalToolJson>{projectId:string;client:LocalToolClient<T>}
export interface LocalToolDefinition<T extends LocalToolJson=LocalToolJson>{readonly apiVersion:1;namespace:string;name:{en:string;es:string};description:{en:string;es:string};initialState:T;validateState:(value:LocalToolJson)=>value is T;component:ComponentType<LocalToolProps<T>>}
export function defineLocalTool<T extends LocalToolJson>(definition:Omit<LocalToolDefinition<T>,'apiVersion'>):LocalToolDefinition<T>{
  if(!localToolNamespace(definition.namespace))throw new LocalToolStateError('invalid-namespace');
  for(const copy of [definition.name,definition.description])for(const locale of ['en','es']as const)if(typeof copy?.[locale]!=='string'||!copy[locale].trim()||copy[locale].length>500)throw new Error('invalid_local_tool_metadata');
  const initialState=cloneLocalToolJson(definition.initialState);if(definition.validateState(initialState)!==true)throw new LocalToolStateError('invalid-state');
  return Object.freeze({...definition,initialState,apiVersion:1 as const});
}
