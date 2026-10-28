import {db} from '@/db';
import {assertEngineEnabled,BridgeError,optString,requireString,resolveProjectId,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {localToolEngineId} from '../definitions';
import {resolveProjectLocalTool} from '../releases';
import {createLocalToolClient} from '../storage';
import type {LocalToolJson,LocalToolSnapshot} from '../sdk';
import type {LocalToolConvergenceUpdate} from './types';

async function client(args:ToolArgs,readOnly=false){
 const projectId=resolveProjectId(args),namespace=requireString(args,'namespace'),documentId=requireString(args,'documentId'),project=await db.projects.get(projectId);
 if(!project)throw new BridgeError('not-found','Project not found.');
 if(!readOnly)await assertEngineEnabled(projectId,localToolEngineId(namespace));
 const definition=resolveProjectLocalTool(namespace,project),scoped=createLocalToolClient(projectId,definition,{documentId,eraId:optString(args,'eraId'),readOnly,requireSelectedRelease:true,releaseHash:project.localToolInstallations?.[namespace]?.contentHash??null});
 if(!scoped.convergence)throw new BridgeError('bad-args','This source document has no declarative state codec.');
 return scoped.convergence;
}
export const LOCAL_CONVERGENCE_HANDLERS={
 async wh_local_tool_convergence_start(args:ToolArgs){return(await client(args)).start(args.baseline as LocalToolSnapshot<LocalToolJson>);},
 async wh_local_tool_convergence_export(args:ToolArgs){return(await client(args,true)).export({stateVectorBase64:optString(args,'stateVectorBase64')});},
 async wh_local_tool_convergence_import(args:ToolArgs){return(await client(args)).import(args.update as LocalToolConvergenceUpdate);},
};
