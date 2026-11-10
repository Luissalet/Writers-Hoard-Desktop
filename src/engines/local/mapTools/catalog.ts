import {db} from '@/db';
import {assertWorldEra,listWorldDocuments,readWorldDocument} from '@/services/worldEras/store';
import type {WorldEraScope} from '@/services/worldEras/types';
import {getLocalToolCatalog,listLocalToolDefinitions,localToolEngineId} from '../definitions';
import {resolveProjectLocalTool} from '../releases';
import {listSourceToolDocuments,readSourceToolDocument} from '../documents/store';
import {assertLocalMapDocumentBinding,localToolMapTarget,sameLocalMapTarget,type LocalMapAuthority,type LocalMapResolvedBinding,type LocalToolMapContext,type LocalToolMapPanelSpec,type LocalToolMapTarget} from './contracts';

export interface LocalMapTargetSummary {target:LocalToolMapTarget;title:string;version:string;provenance:'base'|'variant'}
export interface LocalMapDocumentSummary {id:string;title:string;revision:number;version:string;target:LocalToolMapTarget}
export interface LocalMapToolSummary {
 namespace:string;name:{en:string;es:string};description?:{en:string;es:string};enabled:boolean;status:string;
 contentHash:string|null;pinRevision:number|null;mapPanel:LocalToolMapPanelSpec|null;documents:LocalMapDocumentSummary[];
}
const fail=(message:string):never=>{throw Error(message);};
function targetKey(target:LocalToolMapTarget){return JSON.stringify([target.kind,target.documentId]);}
/** Data catalogue only. Representative metadata never selects executable code. */
export function listLocalMapTools(scope:WorldEraScope,target?:LocalToolMapTarget):Promise<{targets:LocalMapTargetSummary[];tools:LocalMapToolSummary[]}> {
 if(target!==undefined&&!localToolMapTarget(target))return Promise.reject(Error('local_tool_map_target_invalid'));
 return db.transaction('r',db.tables,async()=>{
  const project=await assertWorldEra(scope),targets:LocalMapTargetSummary[]=[];
  for(const kind of ['maps','worldgen'] as const){
   for(const read of await listWorldDocuments(scope,kind)){
    const root=read.document.root;
    if(root.projectId!==scope.projectId)continue;
    targets.push({target:{kind,documentId:root.id},title:String(root.title??root.id),version:read.version,provenance:read.provenance});
   }
  }
  targets.sort((a,b)=>a.title.localeCompare(b.title)||a.target.kind.localeCompare(b.target.kind)||a.target.documentId.localeCompare(b.target.documentId));
  const availableTargets=new Map(targets.map(row=>[targetKey(row.target),row])),documents=await listSourceToolDocuments(scope);
  const representatives=listLocalToolDefinitions(),namespaces=new Set([...representatives.map(definition=>definition.namespace),...Object.keys(project.localToolInstallations??{})]),tools:LocalMapToolSummary[]=[];
  for(const namespace of namespaces){
   const pin=project.localToolInstallations?.[namespace],catalog=getLocalToolCatalog(namespace);
   let definition:ReturnType<typeof resolveProjectLocalTool>|undefined,status='available';
   try{definition=resolveProjectLocalTool(namespace,project);}catch(error){status=error instanceof Error?error.message:String(error);}
   const representative=catalog?.development??[...catalog?.releases.values()??[]][0]?.definition;
   // Unavailable selected code may be described as unavailable, never used to
   // reinterpret documents using a different candidate's descriptor.
   if(definition?!definition.mapPanel:!representative?.mapPanel)continue;
   const metadata=definition??representative!,panel=definition?.mapPanel??null,rows:LocalMapDocumentSummary[]=[];
   if(panel){
    for(const document of documents.filter(row=>row.namespace===namespace)){
     const value=document.data&&typeof document.data==='object'&&!Array.isArray(document.data)?document.data[panel.targetField]:undefined;
     if(!localToolMapTarget(value)||target&&!sameLocalMapTarget(value,target)||!availableTargets.has(targetKey(value)))continue;
     try{assertLocalMapDocumentBinding(document,panel,value);}catch{continue;}
     const read=await readSourceToolDocument(scope,document.id,namespace);if(!read)continue;
     rows.push({id:document.id,title:document.title,revision:document.revision,version:read.version,target:{...value}});
    }
   }
   tools.push({namespace,name:{...metadata.name},description:{...metadata.description},enabled:project.enabledEngines.includes(localToolEngineId(namespace)),status,contentHash:pin?.contentHash??null,pinRevision:pin?.revision??null,mapPanel:panel?structuredClone(panel):null,documents:rows});
  }
  tools.sort((a,b)=>a.namespace.localeCompare(b.namespace));return{targets,tools};
 });
}
/** Read actual selected code and effective root; caller supplies genuine host presentation. */
export function readLocalMapBinding(scope:WorldEraScope,target:LocalToolMapTarget,namespace:string,options:{readOnly?:boolean;presentation?:LocalToolMapContext['presentation']}={}):Promise<LocalMapResolvedBinding> {
 if(!localToolMapTarget(target))return Promise.reject(Error('local_tool_map_target_invalid'));
 return db.transaction('r',db.tables,async()=>{
  const project=await assertWorldEra(scope),definition=resolveProjectLocalTool(namespace,project),panel=definition.mapPanel;
  if(!panel||!definition.document||!panel.kinds.includes(target.kind))return fail('local_tool_map_panel_unavailable');
  if(!project.enabledEngines.includes(localToolEngineId(namespace)))return fail('local_tool_engine_disabled');
  if(!project.enabledEngines.includes(target.kind))return fail('local_tool_map_engine_disabled');
  const read=await readWorldDocument(scope,target.kind,target.documentId);
  if(!read||read.document.root.id!==target.documentId||read.document.root.projectId!==scope.projectId)return fail('local_tool_map_target_unavailable');
  const pin=project.localToolInstallations?.[namespace];
  const presentation=options.presentation??{kind:'current'};
  if(presentation.kind==='map-version'){
   const versions=read.document.root.versions;
   if(target.kind!=='maps'||!Array.isArray(versions)||!versions.some(version=>version&&typeof version==='object'&&'id'in version&&version.id===presentation.versionId))return fail('local_tool_map_presentation_unavailable');
  }
  return{scope:{...scope},target:{...target},namespace,definition,mapPanel:panel,pinRevision:pin?.revision??null,contentHash:pin?.contentHash??null,context:{target:{...target},title:String(read.document.root.title??target.documentId),targetVersion:read.version,provenance:read.provenance,readOnly:!!options.readOnly||presentation.kind==='map-version',presentation:structuredClone(presentation)}};
 });
}
/** Source writes call this before and after their normal writer in the SAME RW. */
export async function assertLocalMapAuthority(authority:LocalMapAuthority,documentId?:string):Promise<void> {
 const current=()=>{if(!authority.isCurrent())throw Error('local_tool_context_expired');};
 current();if(authority.readOnly||!authority.context)throw Error('local_tool_query_is_read_only');
 const selected=await readLocalMapBinding(authority.scope,authority.target,authority.namespace,{presentation:authority.context.presentation});current();
 if(selected.definition!==authority.definition||selected.contentHash!==authority.contentHash||selected.pinRevision!==authority.pinRevision||JSON.stringify(selected.mapPanel)!==JSON.stringify(authority.mapPanel))throw Error('local_tool_pin_conflict');
 if(!sameLocalMapTarget(authority.context.target,authority.target))throw Error('local_tool_map_binding_invalid');
 if(documentId!==undefined){
  const read=await readSourceToolDocument(authority.scope,documentId,authority.namespace);current();
  if(!read)throw Error('source_tool_document_missing');assertLocalMapDocumentBinding(read.document,selected.mapPanel,authority.target);
 }
 current();
}
export function localMapTargetPath(scope:WorldEraScope,target:LocalToolMapTarget):string {
 if(!localToolMapTarget(target))throw Error('local_tool_map_target_invalid');
 const query=new URLSearchParams({[target.kind==='maps'?'map':'world']:target.documentId});if(scope.eraId)query.set('era',scope.eraId);
 return '/project/'+encodeURIComponent(scope.projectId)+'/'+target.kind+'?'+query;
}
