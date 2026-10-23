import {useLocalToolAudioLifecycle} from '../useLocalToolAudioLifecycle';
import {useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Maximize2} from 'lucide-react';
import {db} from '@/db';
import Modal from '@/components/common/Modal';
import {flushPendingWrites} from '@/services/pendingWrites';
import {EnginePaneContext,activateEnginePane,registerEnginePaneScope,useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {navigateTo} from '@/engines/_shared/anchoring';
import {useTranslation} from '@/i18n/useTranslation';
import {resolveProjectLocalTool} from '../releases';
import {createLocalToolClient} from '../storage';
import type {LocalToolHostContext,LocalToolDefinition,LocalToolClient,LocalToolJson} from '../sdk';
import {readSourceToolDocument} from './store';
import {sourceDocumentPreview,renderLocalToolPreview} from './preview';
import {LocalToolHostAncestors} from './hostContext';
import {LocalToolUndoBoundary} from '../LocalToolUndoBoundary';
export interface LocalToolDocumentHostProps {projectId:string;eraId?:string;documentId:string;namespace?:string;view?:LocalToolHostContext['view'];interactive?:boolean;readOnly?:boolean;chrome?:boolean}
/** Every surface mounts one real document; collection lists belong to its engine. */
export default function LocalToolDocumentHost(props:LocalToolDocumentHostProps){return <SourceDocumentSession key={JSON.stringify([props.projectId,props.eraId??null,props.documentId,props.namespace??null,props.view??'editor'])} {...props}/>;}
function SourceDocumentSession({projectId,eraId,documentId,namespace,view='editor',interactive=false,readOnly=false,chrome=true}:LocalToolDocumentHostProps){
 const {locale}=useTranslation(),es=locale==='es',parent=useEnginePane(),ancestors=useContext(LocalToolHostAncestors),identity=JSON.stringify([projectId,eraId??null,'local-tool',documentId]);
 const [instanceId]=useState(()=>`source-document-${crypto.randomUUID()}`),[fullscreen,setFullscreen]=useState(false),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),alive=useRef(true);
 useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const record=useLiveQuery(async()=>({read:await readSourceToolDocument({projectId,eraId},documentId,namespace),project:await db.projects.get(projectId)}),[projectId,eraId,documentId,namespace]);
 const document=record?.read?.document;let definition:LocalToolDefinition|undefined;let error='';if(record?.project&&document)try{definition=resolveProjectLocalTool(document.namespace,record.project);if(!definition.document)throw Error('local_tool_document_host_required');}catch(reason){error=String(reason);}
 const hash=document?record?.project?.localToolInstallations?.[document.namespace]?.contentHash??null:null;
 const canEdit=!!definition&&!!record?.project?.enabledEngines.includes('local-tool-'+document?.namespace)&&!readOnly&&(view!=='embed'||interactive&&definition.document?.embed==='interactive');
 const parentNavigate=parent?.navigate,parentOpenBeside=parent?.openBeside,documentNamespace=document?.namespace;
 const navigate=useMemo(()=>(to:string)=>{if(view==='embed'&&parentOpenBeside)parentOpenBeside(to);else(parentNavigate??navigateTo)(to);},[view,parentNavigate,parentOpenBeside]);
 // Every committed setup owns a new irrevocable lease. StrictMode cleanup
 // cannot reactivate an older emitted client when the surface sets up again.
 const [binding,setBinding]=useState<{client:LocalToolClient<LocalToolJson>;definition:LocalToolDefinition;namespace:string;hash:string|null;canEdit:boolean;navigate:typeof navigate}>();
 useLayoutEffect(()=>{let active=true;if(!definition||!documentNamespace){setBinding(undefined);return()=>{active=false;};}const client=createLocalToolClient(projectId,definition,{eraId,documentId,navigate,requireSelectedRelease:true,releaseHash:hash,readOnly:!canEdit,isCurrent:()=>active});setBinding({client,definition,namespace:documentNamespace,hash,canEdit,navigate});return()=>{active=false;};},[projectId,definition,eraId,documentId,navigate,hash,canEdit,documentNamespace]);
 const client=binding&&binding.definition===definition&&binding.namespace===documentNamespace&&binding.hash===hash&&binding.canEdit===canEdit&&binding.navigate===navigate?binding.client:undefined;
 useLocalToolAudioLifecycle(client?.audio);
 const visible=parent?.visible??true;
 const pane=useMemo(()=>({instanceId,projectId,eraId,visible,primary:false,navigate,openBeside:parentOpenBeside}),[instanceId,projectId,eraId,visible,navigate,parentOpenBeside]);
 useEffect(()=>registerEnginePaneScope(instanceId,{projectId,eraId,navigate}),[instanceId,projectId,eraId,navigate]);
 const changeFullscreen=async(next:boolean)=>{if(busy)return;setBusy(true);setBlocked(false);try{const result=await flushPendingWrites();if(alive.current){if(result.ok)setFullscreen(next);else setBlocked(true);}}finally{if(alive.current)setBusy(false);}};
 if(ancestors.includes(identity))return <p className="text-sm text-text-muted">{es?'Referencia circular al documento abierto.':'Circular reference to the open document.'}</p>;
 if(!record)return <p role="status">{es?'Cargando documento…':'Loading document…'}</p>;
 if(!document)return <p role="alert">{es?'El documento no está disponible en este contexto.':'This document is unavailable in this context.'}</p>;
 const Component=definition?.component,context:LocalToolHostContext={view,canEdit,scope:{projectId,eraId},document:{id:documentId,namespace:document.namespace,title:document.title}};
 const preview=sourceDocumentPreview(document,locale),fallback=!canEdit||!client||!Component;
 return <section className="min-w-0 space-y-3 text-text-primary" data-source-document-host={documentId} data-source-document-view={view}>
  {chrome&&<header className="flex flex-wrap items-center gap-3"><h3 className="min-w-0 flex-1 break-words font-display text-lg">{document.title}</h3>{view!=='fullscreen'&&<button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-elevated disabled:opacity-50" disabled={busy} onClick={()=>void changeFullscreen(true)}><Maximize2 size={15}/>{es?'Pantalla completa':'Fullscreen'}</button>}</header>}
  {blocked&&<p role="alert" className="text-sm text-danger">{es?'Guarda o revisa el borrador pendiente antes de cambiar de vista.':'Save or review the pending draft before changing views.'}</p>}
  {error&&<p role="status" className="text-sm text-text-muted">{es?'Fuente no disponible. Se conserva el contenido guardado.':'Source unavailable. Saved content is preserved.'}</p>}
  <LocalToolHostAncestors.Provider value={[...ancestors,identity]}><EnginePaneContext.Provider value={pane}><LocalToolUndoBoundary data-tool-editor-surface data-engine-pane-id={instanceId} onFocusCapture={()=>activateEnginePane(instanceId)} onPointerDownCapture={()=>activateEnginePane(instanceId)}>
   {fallback?<div className="prose prose-sm max-w-none break-words text-text-primary" dangerouslySetInnerHTML={{__html:renderLocalToolPreview(preview,false)}}/>:<Component key={`${documentId}:${eraId??'base'}:${hash??'development'}`} projectId={projectId} client={client} context={context}/>}
  </LocalToolUndoBoundary></EnginePaneContext.Provider></LocalToolHostAncestors.Provider>
  {fullscreen&&<Modal open fullscreen title={document.title} busy={busy} dismissible={false} onClose={()=>void changeFullscreen(false)}><div className="space-y-3 p-5"><button type="button" className="min-h-10 rounded-lg border border-border px-3 text-sm" disabled={busy} onClick={()=>void changeFullscreen(false)}>{es?'Guardar y volver':'Save and return'}</button>{blocked&&<p role="alert">{es?'El borrador sigue pendiente.':'The draft is still pending.'}</p>}<LocalToolDocumentHost projectId={projectId} eraId={eraId} documentId={documentId} namespace={namespace} view="fullscreen" readOnly={readOnly} chrome={false}/></div></Modal>}
 </section>;
}
