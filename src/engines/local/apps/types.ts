import type {ComponentType,ReactNode} from 'react';
import type {LocalToolClient,LocalToolJson,LocalToolPreviewSpec,LocalToolSnapshot,LocalToolStateAction,LocalToolStateCodec} from '../sdk';

export type LocalAppMember={
  id:string;
  document:{kind:'local-tool';documentId:string};
  variant:'panel'|'plain';
}
export type LocalAppState=Record<string,LocalToolJson>&{children:LocalAppMember[]};
export type LocalAppPreset='instance-documents'|'world-wiki';
export interface LocalAppDescriptor {
  format:'writers-hoard-local-app/1';
  id:string;
  name:{en:string;es:string};
  description:{en:string;es:string};
  version:string;
  subRoutes:boolean;
  tools:readonly string[];
  state:{initialState:LocalToolJson;codec:LocalToolStateCodec;preview:LocalToolPreviewSpec};
  publishPreset?:LocalAppPreset;
}
export interface LocalAppDefinition<T extends LocalToolJson=LocalToolJson> {
  id:string;
  name:{en:string;es:string};
  description:{en:string;es:string};
  version:string;
  subRoutes?:boolean;
  tools:readonly string[];
  state:{initialState:T;codec:LocalToolStateCodec;validateState:(value:LocalToolJson)=>value is T;preview?:LocalToolPreviewSpec};
  Host:ComponentType<{children:ReactNode}>;
  Surface:ComponentType<{variant:'panel'|'plain';children:ReactNode}>;
  publishPreset?:LocalAppPreset;
}
/** Runtime functions stay in compiled definitions; the descriptor is portable data. */
export interface LocalAppDetails {
  descriptor:LocalAppDescriptor;
  Host:LocalAppDefinition['Host'];
  Surface:LocalAppDefinition['Surface'];
}
export interface LocalAppRouteResult {available:boolean;applied:boolean;path?:string}
export interface LocalAppRoute {
  get():{path:string};
  subscribe(changed:()=>void):()=>void;
  set(path:string,options?:{replace?:boolean}):Promise<LocalAppRouteResult>;
}
export interface LocalAppServices<T extends LocalToolJson=LocalToolJson> {
  hostId:string;
  appId:string;
  instanceId:string;
  scope:{projectId:string;eraId?:string};
  readOnly:boolean;
  stateClient:LocalToolClient<T>;
  tools:readonly string[];
  route:LocalAppRoute;
  members:{apply(actions:readonly LocalToolStateAction[],baseline?:LocalToolSnapshot<T>):Promise<{applied:boolean}>};
}
