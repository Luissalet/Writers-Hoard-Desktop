import {saveFocusedMapPin,saveFocusedTimelineEvent,saveFocusedMapFields} from './focusedWrites';
import {useLocalToolAtomPending,LocalToolAtomPendingContext} from '@/engines/local/blocks/pending';
import {TreeEditor} from '@/engines/genealogy/components/RelationTreesWorkspace';
import {useEraProject} from '@/services/worldEras/hooks';
import {saveRelationTree,deleteRelationTree} from '@/engines/genealogy/relationTreeStore';
import {duplicateRelationTree} from '@/engines/genealogy/relationTrees';
import {ConfirmDialog} from '@/engines/_shared';
import {Suspense,lazy,useEffect,useMemo,useRef,useState,useContext,useId} from 'react';

import {useLiveQuery} from 'dexie-react-hooks';

import type {CodexEntry,MapFeature} from '@/types';

import {EnginePaneContext,activateEnginePane,useEnginePane,registerEnginePaneScope} from '@/engines/_shared/EnginePaneContext';

import {getEraProject,readEraRow} from '@/services/worldEras/store';

import PaneRouter from '@/components/project/workspace/PaneRouter';

import {workspaceRoute,routeInEra} from '@/components/project/workspace/routes';

import {flushPendingWrites} from '@/services/pendingWrites';

import {createLocalDraftStore} from '@/hooks/localDraftStore';

import {useCodexEntries} from '@/engines/codex/hooks';

import {saveCodexDraft} from '@/engines/codex/operations';

import CodexEntryForm from '@/components/codex/CodexEntryForm';

import {useWorldMaps,useMapPins} from '@/engines/maps/hooks';

import MapView,{type PinDraft} from '@/components/maps/MapView';

import ChangeGroundDialog from '@/components/maps/ChangeGroundDialog';

import {mapGroundCopy} from '@/components/maps/mapGroundCopy';

import {remapMapContent} from '@/components/maps/mapGround';

import {changeMapGround} from '@/engines/maps/operations';

import {useTranslation} from '@/i18n/useTranslation';

import {useBoards} from '@/engines/board/hooks';

import {useTimelineEvents} from '@/engines/timeline/hooks';

import TimelineView from '@/engines/timeline/components/TimelineView';

import {EmbeddedToolCloseContext,type EmbeddedCloseGuard,useEmbeddedToolCloseGuard} from './EmbeddedToolCloseContext';

import {toolDocumentPath,type ToolDocumentTarget} from './model';

const BoardCanvas=lazy(()=>import('@/engines/board/components/BoardCanvas'));

export type FocusedDocumentTarget=ToolDocumentTarget|{projectId:string;kind:'codex';documentId:string;label:string};

/** A single document editor, never an engine's collection/list surface. */

export default function FocusedToolDocumentEditor(props:{target:FocusedDocumentTarget;eraId?:string;locale:'es'|'en';onClose:()=>void}){return <FocusedSession key={JSON.stringify([props.target.projectId,props.eraId??null,props.target.kind,props.target.documentId])} {...props}/>;}

function FocusedSession({target,eraId,locale,onClose}:{target:FocusedDocumentTarget;eraId?:string;locale:'es'|'en';onClose:()=>void}){

 const reportPending=useContext(LocalToolAtomPendingContext),pendingToken=useId();
 const parent=useEnginePane(),[instanceId]=useState(()=>`focused-document-${crypto.randomUUID()}`),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),alive=useRef(true),guards=useRef(new Set<EmbeddedCloseGuard>()),body=useRef<HTMLDivElement>(null),forms=useRef(new Set<HTMLFormElement>());

 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);

 const formPending=useMemo(()=>()=>[...forms.current].some(form=>form.isConnected),[]);
 useEffect(()=>{const update=()=>reportPending?.(pendingToken,formPending()),observer=new MutationObserver(update);if(body.current)observer.observe(body.current,{childList:true,subtree:true});return()=>{observer.disconnect();reportPending?.(pendingToken,false);};},[reportPending,pendingToken,formPending]);
 const register=useMemo(()=>(guard:EmbeddedCloseGuard)=>{guards.current.add(guard);return()=>{guards.current.delete(guard);};},[]),projectId=target.projectId,kind=target.kind,documentId=target.documentId,openBeside=parent?.openBeside??parent?.navigate;

 const navigate=useMemo(()=>(to:string)=>openBeside?.(to),[openBeside]),pane=useMemo(()=>({instanceId,projectId,eraId,visible:parent?.visible??true,primary:false,navigate,openBeside}),[instanceId,projectId,eraId,parent?.visible,navigate,openBeside]);

 useEffect(()=>registerEnginePaneScope(instanceId,{projectId,eraId,navigate}),[instanceId,projectId,eraId,navigate]);

 const engineId=kind==='codex'?'codex':kind==='relation-tree'?'genealogy':kind,path=kind==='codex'?`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(documentId)}`:toolDocumentPath(target as ToolDocumentTarget),route=routeInEra(workspaceRoute(path),eraId);

 const close=async()=>{if(busy)return;setBusy(true);setBlocked(false);try{for(const guard of guards.current)if(!await guard()){if(alive.current)setBlocked(true);return;}const dirtyForms=[...forms.current].filter(form=>form.isConnected&&[...form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input:not([type="hidden"]):not([type="checkbox"]),textarea')].some(input=>input.value.trim()));if(dirtyForms.length){dirtyForms[0].querySelector<HTMLElement>('input,textarea')?.focus();setBlocked(true);return;}if((await flushPendingWrites()).ok){if(alive.current)onClose();}else if(alive.current)setBlocked(true);}finally{if(alive.current)setBusy(false);}};

 return <section className="min-w-0 space-y-3" data-focused-document={kind+':'+documentId}><div className="flex flex-wrap items-center gap-3"><span className="mr-auto text-xs text-text-muted">{locale==='es'?'Editor del documento enlazado':'Linked document editor'}</span><button type="button" className="min-h-10 rounded-lg border border-border px-3 text-sm disabled:opacity-50" disabled={busy} onClick={()=>void close()}>{locale==='es'?'Volver a lectura':'Return to preview'}</button></div>{blocked&&<p role="alert" className="text-sm text-danger">{locale==='es'?'Guarda o descarta el formulario pendiente antes de cerrar.':'Save or discard the pending form before closing.'}</p>}<div ref={body} data-tool-editor-surface data-engine-pane-id={instanceId} onKeyDown={event=>event.stopPropagation()} onFocusCapture={()=>activateEnginePane(instanceId)} onPointerDownCapture={()=>activateEnginePane(instanceId)} onInputCapture={event=>{const form=(event.target as HTMLElement).closest('form');if(form&&kind!=='codex'){forms.current.add(form);reportPending?.(pendingToken,true);}}} className="min-w-0 overflow-auto rounded-lg border border-border bg-deep p-3"><EmbeddedToolCloseContext.Provider value={register}><EnginePaneContext.Provider value={pane}><PaneRouter projectId={projectId} engineId={engineId} route={route} onNavigate={next=>navigate(next.pathname+next.search)} onBack={()=>{void close();}}><Suspense fallback={<p role="status">…</p>}>{kind==='codex'?<FocusedCodex projectId={projectId} documentId={documentId} eraId={eraId}/>:kind==='maps'?<FocusedMap projectId={projectId} documentId={documentId}/>:kind==='board'?<FocusedBoard projectId={projectId} documentId={documentId}/>:kind==='relation-tree'?<FocusedTree projectId={projectId} documentId={documentId}/>:kind==='timeline'?<FocusedTimeline projectId={projectId} documentId={documentId}/>:null}</Suspense></PaneRouter></EnginePaneContext.Provider></EmbeddedToolCloseContext.Provider></div></section>;

}

function FocusedCodex({projectId,documentId,eraId}:{projectId:string;documentId:string;eraId?:string}){const record=useLiveQuery(async()=>({entry:await readEraRow<CodexEntry>({projectId,eraId},'codexEntries',documentId),project:await getEraProject({projectId,eraId})}),[projectId,documentId,eraId]);if(!record)return <p role="status">…</p>;if(!record.entry)return <p role="alert">Document unavailable</p>;return <CodexFormSession projectId={projectId} eraId={eraId} entry={record.entry}/>;}

function CodexFormSession({projectId,eraId,entry}:{projectId:string;eraId?:string;entry:CodexEntry}){const [base,setBase]=useState(entry),[draftPending,setDraftPending]=useState(false),dirty=useRef(false);useLocalToolAtomPending(draftPending);useEmbeddedToolCloseGuard(()=>!dirty.current);return <CodexEntryForm key={JSON.stringify([base.id,base.updatedAt,base.content,base.fields])} projectId={projectId} entry={base} onDirtyChange={value=>{dirty.current=value;setDraftPending(value);}} onCancel={()=>{dirty.current=false;setBase({...entry});}} onSave={async(draft,baseline)=>{const saved=await saveCodexDraft(baseline??base,draft,{projectId,eraId});dirty.current=false;setBase(saved);}}/>;}

function FocusedMap({projectId,documentId}:{projectId:string;documentId:string}){const pane=useEnginePane(),eraId=pane?.eraId,{items:maps,editItem:editMap,refresh:refreshMaps}=useWorldMaps(projectId),{items:pins,addItem:addPin,removeItem:removePin,refresh:refreshPins}=useMapPins(documentId),{locale:uiLocale}=useTranslation(),[pendingGround,setPendingGround]=useState<string|null>(null),[groundEpoch,setGroundEpoch]=useState(0),{items:codexEntries}=useCodexEntries(projectId),map=maps.find(row=>row.id===documentId);

 const [featureDrafts]=useState(()=>createLocalDraftStore<MapFeature>(`wh.map-features-drafts.v1.${projectId}${eraId?`.era:${eraId}`:''}`,(value):value is MapFeature=>!!value&&typeof value==='object'&&typeof(value as MapFeature).id==='string'&&Array.isArray((value as MapFeature).points))),[pinDrafts]=useState(()=>createLocalDraftStore<PinDraft>(`wh.maps-drafts.v1.${projectId}${eraId?`.era:${eraId}`:''}`,(value):value is PinDraft=>!!value&&typeof value==='object'&&typeof(value as PinDraft).name==='string'&&typeof(value as PinDraft).description==='string'));

 if(!map)return <p role="status">…</p>;const uploadBackground=(backgroundImage:string)=>{if(!map.backgroundImage){void editMap(documentId,{backgroundImage,source:'uploaded',sourceWorldId:undefined,sourceRevision:undefined});return;}setPendingGround(backgroundImage);};return <><MapView key={groundEpoch} projectId={projectId} mapId={documentId} backgroundImage={map.backgroundImage} pins={pins} features={map.features} layerVisibility={map.layerVisibility} namedLayers={map.layers} featureDrafts={featureDrafts} drafts={pinDrafts} codexEntries={codexEntries} onChangeNamedLayers={async(layers,baseline)=>{if(!baseline)throw Error('focused_document_baseline_required');await saveFocusedMapFields({projectId,eraId},documentId,{layers:baseline},{layers});}} onChangeFeatures={async(features,baseline)=>{if(!baseline)throw Error('focused_document_baseline_required');return(await saveFocusedMapFields({projectId,eraId},documentId,{features:baseline},{features})).features;}} onChangeLayers={async(layerVisibility,baseline)=>{if(!baseline)throw Error('focused_document_baseline_required');await saveFocusedMapFields({projectId,eraId},documentId,{layerVisibility:baseline},{layerVisibility});}} onUploadBackground={uploadBackground} onAddPin={addPin} onEditPin={(_id,changes,baseline)=>{if(!baseline)throw Error('focused_document_baseline_required');return saveFocusedMapPin({projectId,eraId},baseline,changes);}} onDeletePin={removePin} onOpenEntry={id=>(pane?.openBeside??pane?.navigate)?.(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(id)}`)}/>{map.backgroundImage&&pendingGround&&<ChangeGroundDialog open oldImage={map.backgroundImage} newImage={pendingGround} features={map.features??[]} pins={pins} onCancel={()=>setPendingGround(null)} onChooseAnother={setPendingGround} onConfirm={async change=>{await changeMapGround(documentId,{image:pendingGround,...change,versionName:mapGroundCopy[uiLocale].versionName},{projectId,eraId});if(change.mode==='keep'&&change.oldSize&&featureDrafts.size)remapMapContent({features:[...featureDrafts.values()],pins:[]},change.oldSize,change.newSize,'keep').features.forEach(feature=>featureDrafts.set(feature.id,feature));await Promise.all([refreshMaps(),refreshPins()]);setPendingGround(null);setGroundEpoch(value=>value+1);}}/>}</>;}

function FocusedBoard({projectId,documentId}:{projectId:string;documentId:string}){const {items,editItem}=useBoards(projectId),board=items.find(row=>row.id===documentId);return board?<div className="h-[36rem] min-w-0"><BoardCanvas projectId={projectId} board={board} onViewportChange={viewport=>{void editItem(documentId,{viewport});}}/></div>:<p role="status">…</p>;}

function FocusedTimeline({projectId,documentId}:{projectId:string;documentId:string}){const pane=useEnginePane(),{events,addEvent,removeEvent}=useTimelineEvents(documentId);return <TimelineView projectId={projectId} timelineId={documentId} events={events} onAddEvent={addEvent} onEditEvent={async(_id,changes,baseline)=>{if(!baseline)throw Error('focused_document_baseline_required');await saveFocusedTimelineEvent({projectId,eraId:pane?.eraId},baseline,changes);}} onDeleteEvent={id=>{void removeEvent(id);}}/>;}


function FocusedTree({projectId,documentId}:{projectId:string;documentId:string}){const pane=useEnginePane(),project=useEraProject(projectId),{items:entries}=useCodexEntries(projectId),tree=project?.relationTrees?.find(row=>row.id===documentId),pending=useRef(false),[draftPending,setDraftPending]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState('');useLocalToolAtomPending(draftPending);useEmbeddedToolCloseGuard(()=>!pending.current);const changed=useMemo(()=>(value:boolean)=>{pending.current=value;setDraftPending(value);},[]);if(!tree)return <p role="alert">Document unavailable</p>;return <><TreeEditor projectId={projectId} current={tree} entries={entries} onPendingChange={changed} onSaved={()=>{}} onVariant={source=>{const copy=duplicateRelationTree(source,crypto.randomUUID(),source.title+' · Copy',Date.now());void saveRelationTree(projectId,copy,null,pane?.eraId).then(()=>{(pane?.openBeside??pane?.navigate)?.(`/project/${encodeURIComponent(projectId)}/genealogy?tree=${encodeURIComponent(copy.id)}`);}).catch(reason=>setError(String(reason)));}} onDelete={()=>setConfirm(true)}/>{error&&<p role="alert">{error}</p>}<ConfirmDialog open={confirm} destructive title="Delete linked tree" message={tree.title} onCancel={()=>setConfirm(false)} onConfirm={async()=>{try{await deleteRelationTree(projectId,tree.id,tree.revision,pane?.eraId);setConfirm(false);}catch(reason){setError(String(reason));}}}/></>;}
