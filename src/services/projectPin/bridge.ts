import {withAudit,requireString,assertRowInScope,type ToolArgs,BridgeError} from '@/services/aiBridge/tools/shared';
import {setProjectPinned} from './store';
export const PROJECT_PIN_HANDLERS={wh_project_pin_set:async(args:ToolArgs)=>{
 const projectId=requireString(args,'projectId');assertRowInScope(args,projectId);
 if(typeof args.pinned!=='boolean'||typeof args.expectedPinned!=='boolean')throw new BridgeError('bad-args','Pass pinned and expectedPinned flags.');
 const result=await setProjectPinned(projectId,args.pinned,args.expectedPinned);
 return result.changed?withAudit(result,{projectId,entityId:projectId,kind:'update',summary:result.pinned?'Pinned project':'Unpinned project',before:{__projectPin:{from:result.previousPinned,to:result.pinned}}}):result;
}};
