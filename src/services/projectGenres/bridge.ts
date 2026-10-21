import {db} from '@/db';
import {BridgeError,resolveProjectId,withAudit,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {normalizeProjectGenres} from './types';
import {setProjectGenres} from './store';
export const PROJECT_GENRE_HANDLERS={
 async wh_project_genres_get(args:ToolArgs){const projectId=resolveProjectId(args),project=await db.projects.get(projectId);if(!project)throw new BridgeError('not-found','Project not found.');return{projectId,genres:normalizeProjectGenres(project.genres)};},
 async wh_project_genres_set(args:ToolArgs){try{const result=await setProjectGenres(resolveProjectId(args),args.genres,args.expectedGenres),{previousGenres,...publicResult}=result;return withAudit(publicResult,{projectId:result.projectId,entityId:result.projectId,kind:'update',summary:'Update project genres',before:{__projectGenres:{from:previousGenres,to:result.genres}}});}catch(error){if(error instanceof Error&&error.message==='project_genres_conflict')throw new BridgeError('conflict','Project genres changed. Read them again before applying this edit.');throw error;}},
};
