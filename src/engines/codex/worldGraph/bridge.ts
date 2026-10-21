import {db} from '@/db';
import type {CodexEntry} from '@/types';
import {getEraProject,listEraRows} from '@/services/worldEras/store';
import {BridgeError,optString,resolveProjectId,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {buildWorldGraph,filterWorldGraph} from './model';
import type {WorldGraphFilters} from './types';
import {worldGraphCopy} from './copy';
function readFilters(value:unknown):Partial<WorldGraphFilters>{
 if(value===undefined)return{};const bad=()=>{throw new BridgeError('bad-args','Invalid graph filters.');};if(!value||typeof value!=='object'||Array.isArray(value))return bad();const row=value as Record<string,unknown>,categories=['character','location','item','faction','concept','magic','custom'],kinds=['mention','codex','reference','relationship'];
 for(const[key,item]of Object.entries(row)){
  if(['query','tag','focusId','templateId'].includes(key)){if(typeof item!=='string')bad();}
  else if(key==='type'){if(typeof item!=='string'||!['all',...categories].includes(item))bad();}
  else if(key==='types'||key==='kinds'){if(!Array.isArray(item)||item.some(part=>typeof part!=='string'||!(key==='types'?categories:kinds).includes(part)))bad();}
  else if(key==='includeDescendants'||key==='showIsolated'){if(typeof item!=='boolean')bad();}
  else if(key==='depth'){if(item!==1&&item!==2)bad();}
  else if(key==='nodeLimit'||key==='edgeLimit'){if(!Number.isSafeInteger(item)||Number(item)<(key==='nodeLimit'?1:0))bad();}
  else bad();
 }return row as Partial<WorldGraphFilters>;
}
export const WORLD_GRAPH_QUERY_HANDLERS={async wh_world_graph_query(args:ToolArgs){
 const scope={projectId:resolveProjectId(args),eraId:optString(args,'eraId')},project=await getEraProject(scope),entries=await listEraRows<CodexEntry>(scope,'codexEntries'),relationships=await db.relationships.where('projectId').equals(scope.projectId).toArray();
 const templates=project.codexTemplates??[],byTemplate=new Map(templates.map(item=>[item.id,item]));
 const referenceLabels=Object.fromEntries(entries.map(entry=>[entry.id,Object.fromEntries((byTemplate.get(entry.templateId??'')?.referenceFieldDefinitions??[]).map(item=>[item.key,item.label]))]));
 const copy=worldGraphCopy[args.locale==='en'?'en':'es'],graph=buildWorldGraph({projectId:scope.projectId,entries,relationships,referenceLabels,contentReferenceLabels:{link:copy.textLink,block:copy.codexBlock}}),filters:WorldGraphFilters={query:'',type:'all',tag:'',kinds:['mention','codex','reference','relationship'],focusId:'',depth:1,showIsolated:true,nodeLimit:150,edgeLimit:500,...readFilters(args.filters)};
 return{...scope,filters,stats:graph.stats,...filterWorldGraph(graph,filters,templates)};
}};
