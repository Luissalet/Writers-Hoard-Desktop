import {BridgeError,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {exportLocalRuntimePackage,inspectLocalRuntimePackage,installLocalRuntimePackage,listLocalRuntimePackages} from './runtimePackages';
import type {RuntimePackageInput} from './runtimeTypes';
import {localToolNamespace} from './stateTypes';
import {localToolContentHash} from './releaseFormat.mjs';
async function normal<T>(run:()=>Promise<T>){try{return await run();}catch(error){const message=error instanceof Error?error.message:String(error),phase=(error as {runtimePhase?:string})?.runtimePhase;throw new BridgeError(message==='local_runtime_package_not_found'?'not-found':message==='local_runtime_package_identity_conflict'?'conflict':'bad-args',phase?`local_runtime_package_${phase}: ${message}`:message);}}
export const LOCAL_RUNTIME_HANDLERS={
 wh_local_package_inspect:(args:ToolArgs)=>normal(()=>inspectLocalRuntimePackage(args.file as RuntimePackageInput)),
 wh_local_package_install:(args:ToolArgs)=>normal(()=>installLocalRuntimePackage(args.file as RuntimePackageInput)),
 wh_local_package_list:(args:ToolArgs)=>normal(()=>{if(args.namespace!==undefined&&!localToolNamespace(args.namespace))throw Error('local_runtime_package_namespace_invalid');return listLocalRuntimePackages(args.namespace as string|undefined);}),
 wh_local_package_export:(args:ToolArgs)=>normal(()=>{if(!localToolContentHash(args.contentHash))throw Error('local_runtime_package_hash_invalid');return exportLocalRuntimePackage(args.contentHash);}),
};
