import {workspaceFocusTargets,setWorkspaceFocus} from '@/components/project/workspace/workspaceFocus';
import {BridgeError,requireString,optString,type ToolArgs} from './shared';
export async function whWorkspaceFocusGet(args:ToolArgs){const projectId=requireString(args,'projectId');return{projectId,targets:workspaceFocusTargets(projectId,{eraId:optString(args,'eraId'),namespace:optString(args,'namespace'),documentId:optString(args,'documentId')})};}
export async function whWorkspaceFocusSet(args:ToolArgs){
 const projectId=requireString(args,'projectId'),hostId=requireString(args,'hostId');if(typeof args.active!=='boolean')throw new BridgeError('bad-args','active must be boolean.');
 const targets=workspaceFocusTargets(projectId,{eraId:optString(args,'eraId'),namespace:optString(args,'namespace'),documentId:optString(args,'documentId')});
 if(!targets.some(target=>target.hostId===hostId))return{available:false,active:false};
 return setWorkspaceFocus(projectId,hostId,args.active);
}
