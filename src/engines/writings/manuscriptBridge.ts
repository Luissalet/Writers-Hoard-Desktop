import {assertEngineEnabled,optString,requireString,resolveProjectId,withAudit,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {listManuscripts,setManuscript} from './manuscriptStore';
import type {Manuscript} from './manuscripts';
export const WRITING_MANUSCRIPT_HANDLERS={
 wh_writing_manuscripts:(args:ToolArgs)=>listManuscripts(resolveProjectId(args)),
 wh_writing_manuscript_set:async(args:ToolArgs)=>{const projectId=resolveProjectId(args);await assertEngineEnabled(projectId,'writings');const action=requireString(args,'action');if(!['create','update','archive','restore'].includes(action))throw Error('manuscript_action_invalid');const id=optString(args,'manuscriptId')??(action==='create'?`manuscript_${crypto.randomUUID()}`:'main');const result=await setManuscript(projectId,id,action as 'create'|'update'|'archive'|'restore',(args.metadata??{}) as Partial<Manuscript>,Number(args.expectedRevision));return withAudit(result,{projectId,entityId:id,kind:action==='create'?'create':'update',summary:`${action} manuscript`,before:{__manuscript:result.receipt}});},
};
