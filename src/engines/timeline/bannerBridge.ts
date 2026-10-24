import {readBannerCatalog,setBannerPreset} from './bannerPresets';
import {readEraRow} from '@/services/worldEras/store';
import {assertEngineEnabled,assertRowInScope,requireString,optString,withAudit,type ToolArgs,BridgeError} from '@/services/aiBridge/tools/shared';
import type {Timeline} from '@/types';
async function parent(args:ToolArgs){
 const timelineId=requireString(args,'timelineId'),eraId=optString(args,'eraId');
 // Parent first: callers may omit projectId on the legacy id-based surface.
 const projectId=optString(args,'projectId')??(await import('@/db')).db.timelines.get(timelineId).then(t=>t?.projectId);
 const id=await projectId;if(!id)throw new BridgeError('not-found','Timeline missing');
 const scope={projectId:id,eraId},timeline=await readEraRow<Timeline>(scope,'timelines',timelineId);
 if(!timeline)throw new BridgeError('not-found','Timeline missing');assertRowInScope(args,timeline.projectId);await assertEngineEnabled(timeline.projectId,'timeline');return {scope,timelineId};
}
export const TIMELINE_BANNER_HANDLERS={
 wh_timeline_banner_presets:async(args:ToolArgs)=>{const{scope,timelineId}=await parent(args);return readBannerCatalog(scope,timelineId);},
 wh_timeline_banner_preset_set:async(args:ToolArgs)=>{const{scope,timelineId}=await parent(args),action=requireString(args,'action');if(!['upsert','archive','restore'].includes(action))throw new BridgeError('bad-args','Invalid banner action');
 const result=await setBannerPreset(scope,timelineId,requireString(args,'expectedVersion'),action as 'upsert'|'archive'|'restore',requireString(args,'presetId'),optString(args,'name'),args.style);
 return withAudit(result,{projectId:scope.projectId,entityId:timelineId,kind:'update',summary:`${action} banner preset`,before:{__bannerReceipt:result.receiptId}});},
};
