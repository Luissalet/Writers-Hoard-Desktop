import type {LocalToolClient,LocalToolSnapshot,LocalToolDefinition} from '../sdk';
import type {LocalToolJson} from '../stateTypes';
import {cloneLocalToolJson} from '../stateTypes';
import {validateLocalToolCodecState} from '../stateCodec';
import {createLocalToolStateActions} from '../stateRuntime';
import {createLocalToolClient} from '../storage';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {LocalToolOwnedBlockEnvelope,LocalToolBlockDataOwner} from './types';
import {validateBlockForDefinition,type LocalToolOwnedBlockDefinition} from './definitions';
export interface LocalToolBlockPort {read():LocalToolOwnedBlockEnvelope;commit(before:LocalToolOwnedBlockEnvelope,next:LocalToolOwnedBlockEnvelope):Promise<void>;subscribe(changed:()=>void):()=>void;identity:string}
const version=(envelope:LocalToolOwnedBlockEnvelope)=>JSON.stringify([envelope.id,envelope.revision,envelope.data]);
/** Host-only state; all world/reference facilities reuse the normal scoped read-only client. */
export function createOwnedBlockClient(scope:WorldEraScope,source:LocalToolDefinition,definition:LocalToolOwnedBlockDefinition,owner:LocalToolBlockDataOwner,port:LocalToolBlockPort,navigate?:(to:string)=>void):LocalToolClient<LocalToolJson>{
 const facilities=createLocalToolClient(scope.projectId,source,{eraId:scope.eraId,readOnly:true,navigate,isCurrent:()=>{try{port.read();return true;}catch{return false;}},assetDefaultsWritable:()=>{port.read();return true;},assetImportWritable:()=>{port.read();return true;}});
 const snapshot=(envelope:LocalToolOwnedBlockEnvelope):LocalToolSnapshot<LocalToolJson>=>({revision:envelope.revision,updatedAt:null,data:cloneLocalToolJson(envelope.data),block:{id:envelope.id,owner,version:version(envelope),lineage:port.identity}});
 let queue:Promise<unknown>=Promise.resolve();
 const atomic=<R,>(run:(transaction:{client:LocalToolClient<LocalToolJson>;identity:string;onCommit:(callback:()=>void)=>void;onAbort:(callback:()=>void)=>void})=>Promise<R>):Promise<R>=>{const operation=queue.then(async()=>{const before=port.read();validateBlockForDefinition(before,definition);let next=structuredClone(before);const committed:(()=>void)[]=[],aborted:(()=>void)[]=[];const transactionClient={...client,read:async()=>snapshot(next),save:async(data:LocalToolJson,revision:number|null,expectedVersion?:string)=>{if(revision!==next.revision||expectedVersion!==version(next))throw Error('local_tool_block_conflict');validateLocalToolCodecState(data,definition.codec);if(!definition.validateState(data))throw Error('local_tool_block_state_invalid');next={...next,data:cloneLocalToolJson(data),revision:next.revision+1};return snapshot(next);}};try{const result=await run({client:transactionClient,identity:port.identity,onCommit:callback=>committed.push(callback),onAbort:callback=>aborted.push(callback)});if(version(before)!==version(next))await port.commit(before,next);for(const callback of committed)callback();return result;}catch(error){for(const callback of aborted)callback();throw error;}});queue=operation.catch(()=>{});return operation;};
 const client:LocalToolClient<LocalToolJson>={...facilities,subscribe:changed=>{const off=facilities.subscribe?.(changed),own=port.subscribe(changed);return()=>{off?.();own();};},read:async()=>snapshot(port.read()),save:(data,revision,expectedVersion)=>atomic(({client})=>client.save(data,revision,expectedVersion)),state:createLocalToolStateActions(definition.codec,port.identity,atomic)};
 return Object.freeze(client);
}
