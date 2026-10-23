import {db} from '@/db';
import type {CodexEntry} from '@/types';
import {getEraProject,listEraRows} from '@/services/worldEras/store';
import {BridgeError,optString,resolveProjectForEngine,resolveProjectId,withAudit,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {buildWorldGraph,filterWorldGraph} from './model';
import {DEFAULT_GRAPH_DISPLAY,type WorldGraphDisplay,type WorldGraphFilters} from './types';
import {saveWorldGraphSettings} from './store';
import {graphStamp} from '@/services/aiBridge/undoStamp';
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
},
async wh_world_graph_settings(args:ToolArgs){
 const projectId=await resolveProjectForEngine(args,'codex'),project=await db.projects.get(projectId);if(!project)throw new BridgeError('not-found','Project not found.');
 const layout=project.codexGraphLayout??{positions:{}},action=optString(args,'action')??'read',before={__graphSettings:{display:layout.display??null,hiddenIds:layout.hiddenIds??[],views:layout.views??[]}};
 const shape=(next:typeof layout)=>({display:{...DEFAULT_GRAPH_DISPLAY,...next.display},hiddenIds:next.hiddenIds??[],hidden:(next.hiddenIds??[]).map(id=>({id})),views:(next.views??[]).map(view=>({id:view.id,name:view.name,filters:view.filters,display:view.display})),pins:Object.keys(next.positions??{}).length});
 const audit=(summary:string,after:typeof layout)=>({projectId,entityId:projectId,kind:'update' as const,summary,before:{...before,__after:graphStamp(after)}});
 if(action==='read')return shape(layout);
 if(action==='display'){const raw=(args.display&&typeof args.display==='object'?args.display:{}) as Partial<WorldGraphDisplay>;if(raw.names!==undefined&&!['all','main','hover'].includes(raw.names))throw new BridgeError('bad-args','names is all, main or hover.');if(raw.nodeSize!==undefined&&!['small','medium','large'].includes(raw.nodeSize))throw new BridgeError('bad-args','nodeSize is small, medium or large.');const next=await saveWorldGraphSettings(projectId,{display:{...DEFAULT_GRAPH_DISPLAY,...layout.display,...raw}});return withAudit(shape(next),audit('changed how the world graph is drawn',next));}
 if(action==='hide'||action==='show'){const ids=Array.isArray(args.entryIds)?args.entryIds.filter((id):id is string=>typeof id==='string'):[];if(!ids.length)throw new BridgeError('bad-args','entryIds lists the cards.');const known=new Set(await db.codexEntries.where('projectId').equals(projectId).primaryKeys() as string[]);const unknown=ids.filter(id=>!known.has(id));if(unknown.length)throw new BridgeError('not-found',`Not cards of this project: ${unknown.join(', ')}.`);const current=new Set(layout.hiddenIds??[]);for(const id of ids){if(action==='hide')current.add(id);else current.delete(id);}const next=await saveWorldGraphSettings(projectId,{hiddenIds:[...current]});return withAudit(shape(next),audit(`${action==='hide'?'hid':'showed'} ${ids.length} card(s) in the world graph`,next));}
 if(action==='save-view'){const name=(optString(args,'name')??'').trim();if(!name)throw new BridgeError('bad-args','name is required.');const filters=readFilters(args.filters),views=layout.views??[],existing=views.find(view=>view.name.toLocaleLowerCase()===name.toLocaleLowerCase());const entry={id:existing?.id??crypto.randomUUID(),name,filters,display:{...DEFAULT_GRAPH_DISPLAY,...layout.display,...(args.display&&typeof args.display==='object'?args.display as Partial<WorldGraphDisplay>:{})}};const next=await saveWorldGraphSettings(projectId,{views:existing?views.map(view=>view.id===existing.id?entry:view):[...views,entry]});return withAudit(shape(next),audit(`saved the graph "${name}"`,next));}
 if(action==='remove-view'){const name=(optString(args,'name')??'').trim(),views=layout.views??[],found=views.find(view=>view.name.toLocaleLowerCase()===name.toLocaleLowerCase());if(!found)throw new BridgeError('not-found',`No saved graph "${name}"; saved: ${views.map(view=>view.name).join(', ')||'none'}.`);const next=await saveWorldGraphSettings(projectId,{views:views.filter(view=>view.id!==found.id)});return withAudit(shape(next),audit(`removed the graph "${found.name}"`,next));}
 throw new BridgeError('bad-args','action is read, display, hide, show, save-view or remove-view.');
}};