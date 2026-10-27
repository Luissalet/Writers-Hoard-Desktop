import {localToolNamespace} from './stateTypes';
import {localToolContentHash} from './releaseFormat.mjs';

export interface LocalRuntimeTrial {
  projectId:string;
  packageHash:string;
  entryNamespace:string;
  documentId?:string;
}
/** Portable metadata only; no registry, execution or permission to delete. */
export function validateLocalRuntimeTrial(projectId:unknown,value:unknown):asserts value is LocalRuntimeTrial|undefined{
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('local_runtime_trial_marker_invalid');
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['projectId','packageHash','entryNamespace','documentId'].includes(key))||typeof projectId!=='string'||!projectId||row.projectId!==projectId||!localToolContentHash(row.packageHash)||!localToolNamespace(row.entryNamespace)||row.documentId!==undefined&&(typeof row.documentId!=='string'||!row.documentId))throw Error('local_runtime_trial_marker_invalid');
}
/** New project identities never acquire the original trial's delete controls. */
export function withoutLocalRuntimeTrial<T extends {localRuntimeTrial?:unknown}>(project:T):T{
  const copy={...project};delete copy.localRuntimeTrial;return copy;
}
