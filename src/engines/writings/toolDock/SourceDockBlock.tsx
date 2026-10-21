import {useLayoutEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {db} from '@/db';
import {listWorldDocuments} from '@/services/worldEras/store';
import type {WorldEraScope} from '@/services/worldEras/types';
import {createLocalToolClient} from '@/engines/local/storage';
import {LOCAL_TOOL_PREVIEW_CSS} from '@/engines/local/previewTypes';
import {resolveProjectLocalTool} from '@/engines/local/releases';
import {createOwnedBlockClient} from '@/engines/local/blocks/client';
import {validateBlockForDefinition} from '@/engines/local/blocks/definitions';
import {localToolBlockPreview,renderLocalToolPreview} from '@/engines/local/blocks/preview';
import type {LocalToolBlockEnvelope,LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';
import type {LocalToolClient,LocalToolJson} from '@/engines/local/sdk';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {replaceWritingToolDockEnvelope,type ToolDockRead} from './store';
import type {ToolDockOwner} from './types';

// One host-local external subscription; each committed setup emits a fresh lease.
function clientBinding<T,>(metadata:T){
 let client:LocalToolClient<LocalToolJson>|undefined;const listeners=new Set<()=>void>();
 return{metadata,subscribe:(changed:()=>void)=>{listeners.add(changed);return()=>{listeners.delete(changed);};},snapshot:()=>client,start:(connect:(publish:(client:LocalToolClient<LocalToolJson>)=>void)=>()=>void)=>connect(value=>{client=value;for(const changed of listeners)changed();})};
}
export default function SourceDockBlock({scope,owner,read,envelope,locale,readOnly,onSaved,onFailed}:{scope:WorldEraScope;owner:ToolDockOwner;read:ToolDockRead;envelope:LocalToolBlockEnvelope;locale:'es'|'en';readOnly:boolean;onSaved:(read:ToolDockRead)=>void;onFailed:(next:LocalToolOwnedBlockEnvelope,error:unknown)=>void}){
 const project=useLiveQuery(()=>db.projects.get(scope.projectId),[scope.projectId]),documents=useLiveQuery(()=>envelope.scope==='world'?listWorldDocuments(scope,envelope.world.kind).then(rows=>rows.map(row=>row.document)):undefined,[scope.projectId,scope.eraId,envelope.scope,envelope.scope==='world'?envelope.world.kind:'']),pane=useEnginePane(),navigate=pane?.openBeside??pane?.navigate;
 let source:ReturnType<typeof resolveProjectLocalTool>|undefined;try{if(project)source=resolveProjectLocalTool(envelope.namespace,project);}catch{/* Portable preview retains saved payload when the source is absent. */}
 const definition=source?.blocks?.find(row=>row.key===envelope.key),hash=project?.localToolInstallations?.[envelope.namespace]?.contentHash??null;
 let compatible=false;try{if(definition){validateBlockForDefinition(envelope,definition);compatible=true;}}catch{/* A changed definition never overwrites saved data. */}
 const canEdit=!readOnly&&!read.inherited&&compatible&&!!project?.enabledEngines.includes('writings')&&project.enabledEngines.includes('local-tool-'+envelope.namespace),latest=useRef({read,envelope,onSaved,onFailed}),changes=useMemo(()=>new Set<()=>void>(),[]);
 useLayoutEffect(()=>{latest.current={read,envelope,onSaved,onFailed};for(const changed of changes)changed();},[read,envelope,onSaved,onFailed,changes]);
 const ownerKey=JSON.stringify(owner),generation=read.layout?.generation,projectId=scope.projectId,eraId=scope.eraId,blockId=envelope.id;
 const binding=useMemo(()=>clientBinding({source,definition,canEdit,hash,projectId,eraId,ownerKey,generation,blockId,navigate}),[source,definition,canEdit,hash,projectId,eraId,ownerKey,generation,blockId,navigate]);
 useLayoutEffect(()=>binding.start(publish=>{
   let active=true;if(!source||!definition||definition.scope!=='host'||!canEdit)return()=>{active=false;};
   const valid=()=>active,owner=JSON.parse(ownerKey) as ToolDockOwner;
   const current=()=>{if(!valid())throw Error('tool_dock_context_expired');const actual=latest.current.envelope;if(actual.scope!=='host'||actual.id!==blockId||latest.current.read.layout?.generation!==generation)throw Error('tool_dock_context_expired');return structuredClone(actual);};
   const client=createOwnedBlockClient({projectId,eraId},source,definition,owner.kind==='project'?{kind:'project',documentId:projectId}:owner,{identity:JSON.stringify([projectId,eraId??null,owner,blockId,generation,hash,crypto.randomUUID()]),read:current,subscribe:changed=>{changes.add(changed);return()=>{changes.delete(changed);};},commit:async(before,next)=>{current();try{const result=await replaceWritingToolDockEnvelope({projectId,eraId},owner,latest.current.read.version,before,next,valid,hash);if(valid()){const actual=result.layout?.blocks.find(row=>row.id===blockId);if(actual?.kind==='owned')latest.current={...latest.current,read:result,envelope:actual.envelope};latest.current.onSaved(result);for(const changed of changes)changed();}}catch(error){if(valid())latest.current.onFailed(next,error);throw error;}}},navigate);
   publish(client);return()=>{active=false;changes.clear();};
 }),[binding,source,definition,canEdit,hash,projectId,eraId,ownerKey,generation,blockId,navigate,changes]);
 const client=useSyncExternalStore(binding.subscribe,binding.snapshot),Component=definition?.component;
 const worldClient=useMemo(()=>source&&definition?.scope==='world'?createLocalToolClient(projectId,source,{eraId,readOnly:true,navigate}):undefined,[projectId,eraId,source,definition,navigate]);
 const WorldComponent=definition?.scope==='world'?definition.component:undefined;
 const preview=useMemo(()=>localToolBlockPreview(envelope,locale,documents),[envelope,locale,documents]);
 return <div data-tool-editor-surface onKeyDown={event=>event.stopPropagation()}><style>{LOCAL_TOOL_PREVIEW_CSS}</style>{(!source||!compatible)&&<p className="mb-2 text-xs text-text-muted">{locale==='es'?'Fuente no disponible; contenido guardado.':'Source unavailable; saved content.'}</p>}{WorldComponent&&worldClient&&compatible?<WorldComponent projectId={projectId} client={worldClient}/>:Component&&client&&canEdit?<Component projectId={projectId} client={client} context={{view:'embed',canEdit:true,scope}}/>:<div className="prose prose-sm max-w-none break-words" dangerouslySetInnerHTML={{__html:renderLocalToolPreview(preview,false)}}/>}</div>;
}
