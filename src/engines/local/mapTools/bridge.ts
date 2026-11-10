import {BridgeError,optString,requireString,resolveProjectId,type ToolArgs} from '@/services/aiBridge/tools/shared';
import type {LocalToolMapTarget} from './contracts';
import {listLocalMapTools} from './catalog';
import {localMapHosts,setLocalMapHostSelection} from './ports';

function mapTarget(value:unknown):LocalToolMapTarget{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BridgeError('bad-args','target must identify a map or generated world.');
 const input=value as Record<string,unknown>;
 if(Object.keys(input).some(key=>key!=='kind'&&key!=='documentId')||
  input.kind!=='maps'&&input.kind!=='worldgen'||typeof input.documentId!=='string'||!input.documentId.trim()){
  throw new BridgeError('bad-args','target must contain only kind (maps or worldgen) and a nonempty documentId.');
 }
 return {kind:input.kind,documentId:input.documentId};
}

export const LOCAL_MAP_TOOL_HANDLERS={
 async wh_local_tool_map_list(args:ToolArgs){
  const scope={projectId:resolveProjectId(args),eraId:optString(args,'eraId')};
  const catalogue=await listLocalMapTools(scope,args.target===undefined?undefined:mapTarget(args.target));
  return {...catalogue,hosts:localMapHosts(scope)};
 },
 async wh_local_tool_map_open(args:ToolArgs){
  if(!Object.hasOwn(args,'expectedContentHash')||args.expectedContentHash!==null&&
   (typeof args.expectedContentHash!=='string'||!args.expectedContentHash.trim())){
   throw new BridgeError('bad-args','expectedContentHash must be the selected hash or null for the development definition.');
  }
  return setLocalMapHostSelection({
   projectId:resolveProjectId(args),eraId:optString(args,'eraId'),hostId:requireString(args,'hostId'),
   target:mapTarget(args.target),namespace:requireString(args,'namespace'),documentId:requireString(args,'documentId'),
   expectedContentHash:args.expectedContentHash,
  });
 },
};
