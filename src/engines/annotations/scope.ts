import {workspaceDocument} from '@/components/project/workspace/library/catalog';
import type {WorkspaceEngineId} from '@/components/project/workspace/library/types';
import {searchEntities} from '@/engines/_shared';
import { db } from '@/db';
import { eraAdapters } from '@/services/worldEras/adapters';
import { assertWorldEra, getEraProject, readEraRow, listEraRows } from '@/services/worldEras/store';
import { eraDocumentKinds, type EraDocumentKind, type EraRow, type WorldEraScope } from '@/services/worldEras/types';
import { getAnchorAdapter, htmlToText } from '@/engines/_shared/anchoring';
import { resolveEntityInEngine } from '@/engines/_shared/entityResolverRegistry';
import type { Annotation, AnnotationMention } from './types';
export function annotationInScope(row:Annotation,scope?:WorldEraScope):boolean{return(!scope || row.projectId===scope.projectId)&&(row.eraId??undefined)===(scope?.eraId??undefined);}
export async function annotationEntity(scope:WorldEraScope,engineId:string,entityId:string):Promise<{id:string;projectId:string;title:string;text:string|null;route?:string}|undefined>{
 await assertWorldEra(scope);
 if((eraDocumentKinds as readonly string[]).includes(engineId)){
  const adapter=eraAdapters[engineId as EraDocumentKind];let root:EraRow|undefined;let rootDocument=!adapter.table;
  if(adapter.table){for(const table of [adapter.table,...Object.keys(adapter.children??{})]){root=await readEraRow<EraRow>(scope,table,entityId);if(root){rootDocument=table===adapter.table;break;}}}
  else root=((await getEraProject(scope))[adapter.metadata!] as EraRow[]|undefined)?.find(row=>row.id===entityId);
  if(!root)return undefined;
  const body=typeof root.content==='string'?root.content:typeof root.text==='string'?root.text:typeof root.description==='string'?root.description:null;
  return{id:entityId,projectId:scope.projectId,title:String(root.title??root.name??root.text??entityId),route:rootDocument?workspaceDocument(scope.projectId,engineId as WorkspaceEngineId,entityId,String(root.title??root.name??entityId)).route:undefined,text:body===null?null:htmlToText(body)};
 }
 const resolved=await resolveEntityInEngine(engineId,entityId);if(!resolved||resolved.projectId!==scope.projectId)return undefined;
 const adapter=getAnchorAdapter(engineId);return{id:entityId,projectId:scope.projectId,title:resolved.title,text:await adapter?.getEntityText?.(entityId)??null};
}
export async function validateAnnotationMentions(scope:WorldEraScope,mentions:AnnotationMention[]=[]):Promise<AnnotationMention[]>{
 if(!Array.isArray(mentions))throw Error('annotation_mentions_invalid');const seen=new Set<string>(),result:AnnotationMention[]=[];
 for(const mention of mentions){if(!mention||typeof mention.engineId!=='string'||typeof mention.entityId!=='string'||!await annotationEntity(scope,mention.engineId,mention.entityId))throw Error('annotation_mention_missing');const key=JSON.stringify([mention.engineId,mention.entityId]);if(!seen.has(key)){seen.add(key);result.push({engineId:mention.engineId,entityId:mention.entityId});}}
 return result;
}
/** The local mention picker exposes real effective Codex entities, without inventing collaborators. */
export async function annotationMentionCandidates(scope:WorldEraScope,query:string):Promise<{id:string;title:string}[]>{const needle=query.trim().toLocaleLowerCase();return(await listEraRows<{id:string;title:string}>(scope,'codexEntries')).filter(row=>!needle||row.title.toLocaleLowerCase().includes(needle)).map(({id,title})=>({id,title}));}
export async function validateAnnotationSource(annotation:Annotation):Promise<void>{const scope={projectId:annotation.projectId,eraId:annotation.eraId};if(!await annotationEntity(scope,annotation.sourceEngineId,annotation.sourceEntityId))throw Error('annotation_source_missing');}
export async function readScopedAnnotation(scope:WorldEraScope,id:string):Promise<Annotation>{await assertWorldEra(scope);const row=await db.annotations.get(id);if(!row||!annotationInScope(row,scope))throw Error('annotation_missing');return row;}

export async function annotationReferenceCandidates(scope:WorldEraScope,engineId:string,query:string){
 const needle=query.trim().toLocaleLowerCase();if(!(eraDocumentKinds as readonly string[]).includes(engineId))return searchEntities(query,[engineId],scope.projectId);
 const adapter=eraAdapters[engineId as EraDocumentKind],rows:EraRow[]=[];
 if(adapter.table){rows.push(...await listEraRows<EraRow>(scope,adapter.table));const extra:Record<string,string>={maps:'mapPins',board:'boardNodes',timeline:'timelineEvents',worldgen:'worldWaypoints'};if(extra[engineId])rows.push(...await listEraRows<EraRow>(scope,extra[engineId]));}else rows.push(...((await getEraProject(scope))[adapter.metadata!] as EraRow[]|undefined)??[]);
 return rows.map(row=>({id:row.id,engineId,projectId:scope.projectId,type:engineId,title:String(row.title??row.name??row.text??row.id)})).filter(row=>row.title.toLocaleLowerCase().includes(needle));
}
