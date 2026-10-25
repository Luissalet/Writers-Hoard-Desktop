import LocalToolContextMenuHost from './LocalToolContextMenuHost';
import LocalToolTutorialHost from './LocalToolTutorialHost';
import {useLocalToolAudioLifecycle} from './useLocalToolAudioLifecycle';
import {useRichProseHostContext} from './RichProseEditor';
import {LocalToolUndoBoundary} from './LocalToolUndoBoundary';
import {registerAnchorAdapter,navigateTo} from '@/engines/_shared/anchoring';
import {useLocation} from 'react-router-dom';
import SourceToolWorkspace from './documents/SourceToolWorkspace';
import {useMemo} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {resolveProjectLocalTool} from './releases';
import {useTranslation} from '@/i18n/useTranslation';
import {localToolReleaseMessage} from './releaseCopy';
import {readLocalToolState} from './clientContract';
import {validateLocalToolRelease,type LocalToolReleaseManifest} from './releaseFormat.mjs';
import {Puzzle} from 'lucide-react';
import {getEngine,registerEngine,type EngineDefinition} from '@/engines/_registry';
import {registerLocaleStrings} from '@/i18n/useTranslation';
import {useWorldEraScope} from '@/services/worldEras/hooks';
import {rememberLocalToolDefinition,localToolEngineId} from './definitions';
import {usePaneNavigate} from '@/engines/_shared/usePaneNavigate';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {db} from '@/db';
import {defineLocalTool,type LocalToolDefinition} from './sdk';
import {createLocalToolClient} from './storage';
const sources=new Map<string,string>();
export {localToolEngineId} from './definitions';
/** Source extensions are trusted application code. This registry is an
 * integration adapter, never an isolation boundary for third-party code. */
export function registerLocalToolModules(modules:Record<string,unknown>,manifests:Record<string,unknown>={}):EngineDefinition[]{
  const seen=new Set<string>(),prepared=Object.entries(modules).map(([path,module])=>{
    if(!module||typeof module!=='object'||!('default'in module))throw new Error('local_tool_default_export_required');
    const source=(module as {default:LocalToolDefinition}).default;if(source.apiVersion!==1)throw new Error('local_tool_api_version');const definition=defineLocalTool(source);
    let manifest:LocalToolReleaseManifest|undefined;const releasePath=path.match(/^\.\/installed\/([^/]+)\/versions\/([a-f0-9]{64})\/module\.tsx$/);if(releasePath){const value=manifests[path.replace(/module\.tsx$/,'release.json')];validateLocalToolRelease(value);if(value.namespace!==definition.namespace||value.namespace!==releasePath[1]||value.contentHash!==releasePath[2])throw Error('local_tool_release_path_mismatch');manifest=value;}const identity=manifest?`${definition.namespace}:${manifest.contentHash}`:definition.namespace;
    if(!manifest&&path!==`./installed/${definition.namespace}/module.tsx`||seen.has(identity)||sources.has(identity)&&sources.get(identity)!==path)throw new Error('local_tool_namespace_collision');
    const id=localToolEngineId(definition.namespace);if(getEngine(id)&&![...sources.keys()].some(key=>key===definition.namespace||key.startsWith(definition.namespace+':')))throw new Error('local_tool_engine_collision');seen.add(identity);return {path,definition,id,manifest,identity};
  });
  return prepared.map(({path,definition,id,manifest,identity})=>{
    function LocalToolEngine({projectId}:{projectId:string}){const {locale}=useTranslation(),location=useLocation(),query=new URLSearchParams(location.search),documentId=query.get('document')||undefined,legacy=query.get('legacy')==='1';const scope=useWorldEraScope(projectId),navigate=usePaneNavigate(),openBeside=useEnginePane()?.openBeside,record=useLiveQuery(async()=>({project:await db.projects.get(projectId)}),[projectId]);let selected:LocalToolDefinition|undefined,error='';if(record)try{if(!record.project)throw Error('project_missing');selected=resolveProjectLocalTool(definition.namespace,record.project);if(!selected.document||legacy)readLocalToolState(record.project,selected,scope.eraId);}catch(reason){error=reason instanceof Error?reason.message:String(reason);}const releaseHash=record?.project?.localToolInstallations?.[definition.namespace]?.contentHash??null;const client=useMemo(()=>selected?createLocalToolClient(projectId,selected,{eraId:scope.eraId,navigate,openBeside,requireSelectedRelease:true,releaseHash}):undefined,[projectId,selected,scope.eraId,navigate,openBeside,releaseHash]);useLocalToolAudioLifecycle(client?.audio);const richContext=useRichProseHostContext({view:'editor',canEdit:true,scope},client,selected?(record?.project?.localToolContracts?.[selected.namespace]??selected.codec):undefined);if(!record)return <p className="p-5">{locale==='es'?'Abriendo herramienta local…':'Opening source tool…'}</p>;if(!selected||!client||error)return <section role="alert" className="space-y-2 p-5"><h2 className="font-display text-xl">{definition.name[locale==='es'?'es':'en']}</h2><p>{localToolReleaseMessage(error,locale)}</p></section>;if(selected.document&&!legacy)return <SourceToolWorkspace projectId={projectId} definition={selected} eraId={scope.eraId} documentId={documentId} navigate={navigate} releaseHash={releaseHash}/>;const Component=selected.component;return <LocalToolUndoBoundary><LocalToolTutorialHost definition={selected} context={richContext} releaseHash={releaseHash} identity={client}>{tutorialContext=><LocalToolContextMenuHost context={tutorialContext} releaseHash={releaseHash} identity={client}>{menuContext=><Component key={`${projectId}:era:${scope.eraId??'base'}:release:${record.project?.localToolInstallations?.[definition.namespace]?.contentHash??'development'}`} projectId={projectId} client={client} context={menuContext}/>}</LocalToolContextMenuHost>}</LocalToolTutorialHost></LocalToolUndoBoundary>;}
    const engine:EngineDefinition={id,name:definition.name.en,description:definition.description.en,icon:Puzzle,category:'creative',tables:{},component:LocalToolEngine,countProjectItems:async projectId=>{const project=await db.projects.get(projectId);return(project?.sourceToolDocuments??[]).filter(row=>row.namespace===definition.namespace).length+(project?.localToolStates?.[definition.namespace]?1:0);}};
    registerLocaleStrings({en:{[`engines.${id}.name`]:definition.name.en,[`engines.${id}.description`]:definition.description.en},es:{[`engines.${id}.name`]:definition.name.es,[`engines.${id}.description`]:definition.description.es}});sources.set(identity,path);rememberLocalToolDefinition(definition,manifest);registerEngine(engine);if(definition.document)registerAnchorAdapter({engineId:id,supportsTextRange:false,getEngineChipLabel:()=>definition.name.en,getEntityTitle:async documentId=>{const projects=await db.projects.toArray();return projects.flatMap(project=>project.sourceToolDocuments??[]).find(row=>row.id===documentId&&row.namespace===definition.namespace)?.title??null;},navigateToEntity:(documentId,projectId,navigate)=>{if(projectId)(navigate??navigateTo)(`/project/${encodeURIComponent(projectId)}/${id}?document=${encodeURIComponent(documentId)}`);}});return engine;
  });
}
