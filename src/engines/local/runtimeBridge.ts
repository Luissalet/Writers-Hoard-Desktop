import {createRuntimeTrial,keepRuntimeTrial,discardRuntimeTrial,type RuntimeTrialInput} from './runtimeTrials';
import {readRuntimeUsage} from './runtimeUsage';
import {BridgeError,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {exportLocalRuntimePackage,inspectLocalRuntimePackage,installLocalRuntimePackage,listLocalRuntimePackages} from './runtimePackages';
import type {RuntimePackageInput} from './runtimeTypes';
import {localToolNamespace} from './stateTypes';
import {localToolContentHash} from './releaseFormat.mjs';
async function normal<T>(run:()=>Promise<T>){try{return await run();}catch(error){const message=error instanceof Error?error.message:String(error),phase=(error as {runtimePhase?:string})?.runtimePhase;throw new BridgeError(message==='local_runtime_package_not_found'?'not-found':message==='local_runtime_package_identity_conflict'?'conflict':'bad-args',phase?`local_runtime_package_${phase}: ${message}`:message);}}
async function trialNormal<T>(run:()=>Promise<T>){try{return await run();}catch(error){const message=error instanceof Error?error.message:String(error);throw new BridgeError(message.endsWith('_not_found')?'not-found':['local_runtime_trial_marker_conflict','local_runtime_trial_pending'].includes(message)?'conflict':'bad-args',message);}}
export const LOCAL_RUNTIME_HANDLERS={
 wh_local_package_trial_create:(args:ToolArgs)=>trialNormal(()=>createRuntimeTrial(args as unknown as RuntimeTrialInput)),
 wh_local_package_trial_keep:(args:ToolArgs)=>trialNormal(()=>keepRuntimeTrial(args.projectId as string,args.contentHash as string)),
 wh_local_package_trial_discard:(args:ToolArgs)=>trialNormal(()=>discardRuntimeTrial(args.projectId as string,args.contentHash as string)),
 wh_local_package_usage:(args:ToolArgs)=>trialNormal(()=>readRuntimeUsage(args.contentHash as string)),
 wh_local_package_inspect:(args:ToolArgs)=>normal(()=>inspectLocalRuntimePackage(args.file as RuntimePackageInput)),
 wh_local_package_install:(args:ToolArgs)=>normal(()=>installLocalRuntimePackage(args.file as RuntimePackageInput)),
 wh_local_package_list:(args:ToolArgs)=>normal(()=>{if(args.namespace!==undefined&&!localToolNamespace(args.namespace))throw Error('local_runtime_package_namespace_invalid');return listLocalRuntimePackages(args.namespace as string|undefined);}),
 wh_local_package_export:(args:ToolArgs)=>normal(()=>{if(!localToolContentHash(args.contentHash))throw Error('local_runtime_package_hash_invalid');return exportLocalRuntimePackage(args.contentHash);}),
};
