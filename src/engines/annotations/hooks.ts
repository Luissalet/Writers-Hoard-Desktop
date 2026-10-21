import { useCallback,useEffect,useMemo,useState } from 'react';
import { liveQuery } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { getAnnotationsForEntity,getReferenceForAnnotation,getBacklinksForEntity,getAnnotationsForProject,reanchorEntityAnnotations } from './operations';
import { annotationEntity } from './scope';
import type { AnnotationWithReference,BacklinkPreview } from './types';
interface EntityKey {engineId:string;entityId:string;projectId?:string;eraId?:string}
/** Live reads share the existing annotation aggregate and discard superseded contexts. */
function useHydratedList<T>(key:string|null,fetcher:(()=>Promise<T[]>)|null){
 const [state,setState]=useState<{key:string|null;items:T[];error:unknown}>({key:null,items:[],error:null}),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!key||!fetcher)return;let active=true;const subscription=liveQuery(fetcher).subscribe({next:items=>{if(active)setState({key,items,error:null});},error:error=>{if(active)setState({key,items:[],error});}});return()=>{active=false;subscription.unsubscribe();};},[key,revision,fetcher]);
 const refresh=useCallback(async()=>{setRevision(value=>value+1);},[]);
 return{items:state.key===key?state.items:[],loading:!!key&&state.key!==key,error:state.key===key?state.error:null,refetching:false,refresh};
}
export function useAnnotationsForEntity(key:EntityKey|undefined){
 const paneScope=useWorldEraScope(key?.projectId),explicitEra=key?.eraId,scope=useMemo(()=>explicitEra!==undefined?{...paneScope,eraId:explicitEra}:paneScope,[paneScope,explicitEra]),owner=scope.projectId?scope:undefined,engineId=key?.engineId,entityId=key?.entityId;
 const cache=engineId&&entityId?JSON.stringify([owner?.projectId,owner?.eraId,engineId,entityId]):null;
 const text=useLiveQuery(async()=>engineId&&entityId&&owner?(await annotationEntity(owner,engineId,entityId))?.text:null,[owner,engineId,entityId]);
 useEffect(()=>{if(engineId&&entityId)void reanchorEntityAnnotations(engineId,entityId,owner).catch(error=>console.error('[annotations] Reanchor failed',error));},[owner,engineId,entityId,text]);
 const fetch=useCallback(async()=>engineId&&entityId?Promise.all((await getAnnotationsForEntity(engineId,entityId,owner)).map(async ann=>ann.noteType==='reference'?{...ann,reference:await getReferenceForAnnotation(ann.id)}:ann)):[],[engineId,entityId,owner]);
 return useHydratedList<AnnotationWithReference>(cache,fetch);
}
export function useEntityBacklinks(key:EntityKey|undefined){
 const paneScope=useWorldEraScope(key?.projectId),explicitEra=key?.eraId,scope=useMemo(()=>explicitEra!==undefined?{...paneScope,eraId:explicitEra}:paneScope,[paneScope,explicitEra]),owner=scope.projectId?scope:undefined,engineId=key?.engineId,entityId=key?.entityId;
 const fetch=useCallback(async()=>engineId&&entityId?Promise.all((await getBacklinksForEntity(engineId,entityId,owner)).map(async({annotation})=>({annotationId:annotation.id,sourceEngineId:annotation.sourceEngineId,sourceEntityId:annotation.sourceEntityId,sourceEntityTitle:owner?(await annotationEntity(owner,annotation.sourceEngineId,annotation.sourceEntityId))?.title??annotation.sourceEntityId:annotation.sourceEntityId,anchorSnippet:annotation.anchor.selectedText,noteType:annotation.noteType,noteBody:annotation.noteBody,createdAt:annotation.createdAt}))):[],[owner,engineId,entityId]);
 return useHydratedList<BacklinkPreview>(engineId&&entityId?JSON.stringify([owner?.projectId,owner?.eraId,engineId,entityId]):null,fetch);
}
export function useAnnotationsForProject(projectId:string|undefined){
 const scope=useWorldEraScope(projectId),eraId=scope.eraId,fetch=useCallback(async()=>projectId?Promise.all((await getAnnotationsForProject(projectId,eraId)).map(async annotation=>({...annotation,reference:annotation.noteType==='reference'?await getReferenceForAnnotation(annotation.id):undefined,mentionTitles:await Promise.all([...annotation.mentions??[],...(annotation.replies??[]).flatMap(reply=>reply.mentions??[])].map(async mention=>(await annotationEntity({projectId,eraId},mention.engineId,mention.entityId))?.title??mention.entityId))}))):[],[projectId,eraId]);return useHydratedList<AnnotationWithReference>(projectId?JSON.stringify([projectId,eraId]):null,fetch);
}
export function useOrphanCount(projectId:string|undefined){const {items,error,refresh}=useAnnotationsForProject(projectId);return{count:items.filter(row=>row.isOrphaned).length,error,refresh};}
