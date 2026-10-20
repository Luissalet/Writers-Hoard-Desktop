import {useMemo} from 'react';
import {Puzzle} from 'lucide-react';
import {getEngine,registerEngine,type EngineDefinition} from '@/engines/_registry';
import {registerLocaleStrings} from '@/i18n/useTranslation';
import {db} from '@/db';
import {defineLocalTool,type LocalToolDefinition} from './sdk';
import {createLocalToolClient} from './storage';
const sources=new Map<string,string>();
export const localToolEngineId=(namespace:string)=>`local-tool-${namespace}`;
/** Source extensions are trusted application code. This registry is an
 * integration adapter, never an isolation boundary for third-party code. */
export function registerLocalToolModules(modules:Record<string,unknown>):EngineDefinition[]{
  const seen=new Set<string>(),prepared=Object.entries(modules).map(([path,module])=>{
    if(!module||typeof module!=='object'||!('default'in module))throw new Error('local_tool_default_export_required');
    const source=(module as {default:LocalToolDefinition}).default;if(source.apiVersion!==1)throw new Error('local_tool_api_version');const definition=defineLocalTool(source);
    if(path!==`./installed/${definition.namespace}/module.tsx`||seen.has(definition.namespace)||sources.has(definition.namespace)&&sources.get(definition.namespace)!==path)throw new Error('local_tool_namespace_collision');
    const id=localToolEngineId(definition.namespace);if(getEngine(id)&&!sources.has(definition.namespace))throw new Error('local_tool_engine_collision');seen.add(definition.namespace);return {path,definition,id};
  });
  return prepared.map(({path,definition,id})=>{
    function LocalToolEngine({projectId}:{projectId:string}){const client=useMemo(()=>createLocalToolClient(projectId,definition),[projectId]);const Component=definition.component;return <Component key={projectId} projectId={projectId} client={client}/>;}
    const engine:EngineDefinition={id,name:definition.name.en,description:definition.description.en,icon:Puzzle,category:'creative',tables:{},component:LocalToolEngine,countProjectItems:async projectId=>(await db.projects.get(projectId))?.localToolStates?.[definition.namespace]?1:0};
    registerLocaleStrings({en:{[`engines.${id}.name`]:definition.name.en,[`engines.${id}.description`]:definition.description.en},es:{[`engines.${id}.name`]:definition.name.es,[`engines.${id}.description`]:definition.description.es}});sources.set(definition.namespace,path);registerEngine(engine);return engine;
  });
}
