import { resolveProjectId, requireString, optString, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { previewProjectDuplicate, duplicateProject, undoProjectDuplicate } from './service';
export const PROJECT_DUPLICATE_HANDLERS:Record<string,(args:ToolArgs)=>Promise<unknown>>={
  wh_project_duplicate_preview:async args=>previewProjectDuplicate({projectId:resolveProjectId(args),title:optString(args,'title')}),
  wh_project_duplicate:async args=>{const result=await duplicateProject({projectId:resolveProjectId(args),title:requireString(args,'title'),operationId:requireString(args,'operationId'),expectedSourceVersion:requireString(args,'expectedSourceVersion')});return withAudit(result,{projectId:result.projectId,entityId:result.projectId,summary:`Duplicated project (${result.complete?'complete':'native completion pending'})`,before:{__projectDuplicateOperation:result.operationId}});},
  wh_project_duplicate_undo:async args=>undoProjectDuplicate(requireString(args,'operationId')),
};
