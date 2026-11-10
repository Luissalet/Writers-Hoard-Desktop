import {BridgeError} from '@/services/aiBridge/tools/shared';
import type {WorldEraScope} from '@/services/worldEras/types';
import {readSourceToolDocument} from '../documents/store';
import {readLocalMapBinding} from './catalog';
import {assertLocalMapDocumentBinding,localToolMapTarget,sameLocalMapScope,type LocalToolMapKind,type LocalToolMapTarget} from './contracts';

export interface LocalMapHostSelection {
 projectId:string;eraId?:string;hostId:string;target:LocalToolMapTarget;namespace:string;documentId:string;expectedContentHash:string|null;
}
export interface LocalMapHostResult {available:boolean;applied:boolean;path?:string}
export interface LocalMapHostSnapshot {scope:WorldEraScope;target:LocalToolMapTarget|null;kind:LocalToolMapKind;readOnly:boolean;visible:boolean}
export interface MountedLocalMapHost {
 hostId:string;snapshot:()=>LocalMapHostSnapshot;open:(input:LocalMapHostSelection)=>Promise<LocalMapHostResult>;
}
const hosts=new Map<string,MountedLocalMapHost>();
export function registerLocalMapHost(host:MountedLocalMapHost):()=>void {
 hosts.set(host.hostId,host);return()=>{if(hosts.get(host.hostId)===host)hosts.delete(host.hostId);};
}
/** Only actual mounted surfaces are reported; no persisted host inventory. */
export function localMapHosts(scope:WorldEraScope){
 return [...hosts.values()].flatMap(host=>{
  const current=host.snapshot();return sameLocalMapScope(current.scope,scope)?[{hostId:host.hostId,...current,scope:{...current.scope},target:current.target?{...current.target}:null}]:[];
 });
}
/** A live host owns selection/flush. Missing hosts are never queued or started. */
export async function setLocalMapHostSelection(input:LocalMapHostSelection):Promise<LocalMapHostResult> {
 const host=hosts.get(input.hostId),scope={projectId:input.projectId,eraId:input.eraId};
 const available=()=>hosts.get(input.hostId)===host&&!!host&&sameLocalMapScope(host.snapshot().scope,scope);
 if(!host||!available())return{available:false,applied:false};
 if(!localToolMapTarget(input.target))throw new BridgeError('bad-args','A map or generated-world target is required.');
 const selected=await readLocalMapBinding(scope,input.target,input.namespace);
 if(!available())return{available:false,applied:false};
 if(selected.contentHash!==input.expectedContentHash)throw new BridgeError('conflict','The selected source release changed. Read the map catalogue again.');
 const read=await readSourceToolDocument(scope,input.documentId,input.namespace);
 if(!available())return{available:false,applied:false};
 if(!read)throw new BridgeError('not-found','The source document is unavailable in this map scope.');
 assertLocalMapDocumentBinding(read.document,selected.mapPanel,input.target);
 // The wrapper rechecks its genuine generation while awaiting normal flush.
 // Once that navigation is admitted, a cross-engine route may unmount the
 // originating host. Do not mislabel the admitted result as a late failure.
 return host.open(input);
}
