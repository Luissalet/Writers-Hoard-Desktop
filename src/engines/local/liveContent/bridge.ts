import {liveDocumentHosts} from './host';
import {optString,requireString,resolveProjectId,type ToolArgs} from '@/services/aiBridge/tools/shared';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolStateAction} from '../stateActions';
function host(args:ToolArgs){const projectId=resolveProjectId(args),eraId=optString(args,'eraId'),namespace=requireString(args,'namespace'),documentId=requireString(args,'documentId'),instanceId=requireString(args,'instanceId');const host=[...liveDocumentHosts].find(h=>h.instanceId===instanceId&&h.client.projectId===projectId&&h.client.eraId===eraId&&h.client.namespace===namespace&&h.client.documentId===documentId);if(!host)throw Error('local_tool_live_host_unavailable');return host.port;}
export const LOCAL_LIVE_CONTENT_HANDLERS={
 wh_local_tool_live_query:(args:ToolArgs)=>host(args).query(),
 wh_local_tool_live_rich_capture:(args:ToolArgs)=>host(args).capture(requireString(args,'field'),args.request as LocalToolJson),
 wh_local_tool_live_apply:(args:ToolArgs)=>{if(!Array.isArray(args.actions)||!args.actions.length)throw Error('local_tool_live_actions_required');return host(args).apply(requireString(args,'field'),args.actions as LocalToolStateAction[]);},
 wh_local_tool_live_control:(args:ToolArgs)=>{if(!['undo','redo','save','leave'].includes(String(args.action)))throw Error('local_tool_live_control_invalid');return host(args).control(args.action as 'undo'|'redo'|'save'|'leave',optString(args,'field'));},
};
