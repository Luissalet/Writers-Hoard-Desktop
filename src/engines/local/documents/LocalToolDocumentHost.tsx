import LocalRuntimeErrorBoundary from '../LocalRuntimeErrorBoundary';
import LocalToolPendingBoundary from '../LocalToolPendingBoundary';
import LocalToolFocusHost from '../LocalToolFocusHost';
import LocalToolContextMenuHost from '../LocalToolContextMenuHost';
import LocalToolTutorialHost from '../LocalToolTutorialHost';
import {useLocalToolAssetPreview} from '../useLocalToolAssetPreview';
import {useRichProseHostContext} from '../RichProseEditor';
import {renderRichProsePreview} from '../richProseHtml';
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
import {sourceDocumentPreview} from './preview';
import {LocalToolHostAncestors} from './hostContext';
import {LocalToolAtomPendingContext} from '../blocks/pending';
import {LocalToolUndoBoundary} from '../LocalToolUndoBoundary';
export interface LocalToolDocumentHostProps {projectId:string;eraId?:string;documentId:string;namespace?:string;view?:LocalToolHostContext['view'];interactive?:boolean;readOnly?:boolean;chrome?:boolean;retainPresentation?:boolean;allowedNamespaces?:readonly string[]}
/** Every surface mounts one real document; collection lists belong to its engine. */
export default function LocalToolDocumentHost(props:LocalToolDocumentHostProps){return <SourceDocumentSession key={JSON.stringify([props.projectId,props.eraId??null,props.documentId,props.namespace??null,props.view??'editor'])} {...props}/>;}
function SourceDocumentSession({projectId,eraId,documentId,namespace,view='editor',interactive=false,readOnly=false,chrome=true,retainPresentation=false,allowedNamespaces}:LocalToolDocumentHostProps){
 const {locale}=useTranslation(),es=locale==='es',parent=useEnginePane(),ancestors=useContext(LocalToolHostAncestors),identity=JSON.stringify([projectId,eraId??null,'local-tool',documentId]);
 const [instanceId]=useState(()=>`source-document-${crypto.randomUUID()}`),[fullscreen,setFullscreen]=useState(false),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),alive=useRef(true);
 useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const record=useLiveQuery(async()=>({read:await readSourceToolDocument({projectId,eraId},documentId,namespace).catch(reason=>{if(reason instanceof Error&&reason.message==='project_missing')return undefined;throw reason;}),project:await db.projects.get(projectId)}),[projectId,eraId,documentId,namespace]);
 const outerPending=useContext(LocalToolAtomPendingContext),pendingTokens=useRef(new Set<string>()),[hasPending,setHasPending]=useState(false);
 const reportPending=useMemo(()=>(token:string,pending:boolean)=>{if(pending)pendingTokens.current.add(token);else pendingTokens.current.delete(token);setHasPending(pendingTokens.current.size>0);outerPending?.(token,pending);},[outerPending]);
 const retained=useRef<{document:NonNullable<NonNullable<typeof record>['read']>['document'];definition:LocalToolDefinition;contentHash:string|null}|undefined>(undefined);
 const freshDocument=record?.read?.document,document=freshDocument??(retainPresentation?retained.current?.document:undefined);let definition:LocalToolDefinition|undefined;let error='';if(record?.project&&document)try{definition=resolveProjectLocalTool(document.namespace,record.project);if(!definition.document)throw Error('local_tool_document_host_required');}catch(reason){error=String(reason);}
 // A compatible pin may replace the Component type. Keep the actual pending
 // editor mounted until its own recovery controls resolve the draft; authority
 // still comes from the current pin and a newly issued readonly client.
 const hash=document?record?.project?.localToolInstallations?.[document.namespace]?.contentHash??null:null;
 let presentationHash=hash;
 const heldRelease=(retainPresentation||!!definition?.app)&&hasPending&&!!retained.current&&definition!==retained.current.definition;
 if(heldRelease){definition=retained.current!.definition;presentationHash=retained.current!.contentHash;}
 if(definition&&document&&!heldRelease)retained.current={document,definition,contentHash:hash};if(!definition&&retainPresentation){definition=retained.current?.definition;presentationHash=retained.current?.contentHash??null;}
 const allowed=!allowedNamespaces||!!document&&allowedNamespaces.includes(document.namespace);
 const canEdit=!!freshDocument&&!error&&!heldRelease&&allowed&&!!definition&&!!record?.project?.enabledEngines.includes('local-tool-'+document?.namespace)&&!readOnly&&(view!=='embed'||interactive&&definition.document?.embed==='interactive');
 const parentNavigate=parent?.navigate,parentOpenBeside=parent?.openBeside,documentNamespace=document?.namespace;
 const navRef=useRef({parentNavigate,parentOpenBeside});navRef.current={parentNavigate,parentOpenBeside};
 const stableNavigation=retainPresentation||!!definition?.app;
 const stableNavigate=useMemo(()=>(to:string)=>{const ports=navRef.current;if(view==='embed'&&ports.parentOpenBeside)ports.parentOpenBeside(to);else(ports.parentNavigate??navigateTo)(to);},[view]);
 const ordinaryNavigate=useMemo(()=>(to:string)=>{if(view==='embed'&&parentOpenBeside)parentOpenBeside(to);else(parentNavigate??navigateTo)(to);},[view,parentNavigate,parentOpenBeside]);
 const navigate=stableNavigation?stableNavigate:ordinaryNavigate;
 const stableOpenBeside=useMemo(()=>(to:string)=>navRef.current.parentOpenBeside?.(to),[]),bindingOpenBeside=stableNavigation&&parentOpenBeside?stableOpenBeside:parentOpenBeside;
 // Every committed setup owns a new irrevocable lease. StrictMode cleanup
 // cannot reactivate an older emitted client when the surface sets up again.
 const [binding,setBinding]=useState<{client:LocalToolClient<LocalToolJson>;definition:LocalToolDefinition;namespace:string;hash:string|null;canEdit:boolean;navigate:typeof navigate}>();
 useLayoutEffect(()=>{let active=true;if(!definition||!documentNamespace){setBinding(undefined);return()=>{active=false;};}const client=createLocalToolClient(projectId,definition,{eraId,documentId,navigate,openBeside:bindingOpenBeside,requireSelectedRelease:true,releaseHash:hash,readOnly:!canEdit,isCurrent:()=>active});setBinding({client,definition,namespace:documentNamespace,hash,canEdit,navigate});return()=>{active=false;};},[projectId,definition,eraId,documentId,navigate,bindingOpenBeside,hash,canEdit,documentNamespace]);
 // A navigation-only rebind retains the editor draft while the layout effect issues a new client.
 // Cleanup still permanently revokes the previous emitted client.
 const selectedClient=binding&&binding.definition===definition&&binding.namespace===documentNamespace&&binding.hash===hash&&binding.canEdit===canEdit?binding.client:undefined;
 const client=selectedClient??(retainPresentation||definition?.app?binding?.client:undefined);
 useLocalToolAudioLifecycle(client?.audio);
 const visible=parent?.visible??true;
 const primary=stableNavigation?parent?.primary:false;
 const pane=useMemo(()=>({instanceId,projectId,eraId,visible,primary,navigate,openBeside:parentOpenBeside}),[instanceId,projectId,eraId,visible,navigate,parentOpenBeside,primary]);
 useEffect(()=>registerEnginePaneScope(instanceId,{projectId,eraId,navigate}),[instanceId,projectId,eraId,navigate]);
 const changeFullscreen=async(next:boolean)=>{if(busy)return;setBusy(true);setBlocked(false);try{const result=await flushPendingWrites();if(alive.current){if(result.ok)setFullscreen(next);else setBlocked(true);}}finally{if(alive.current)setBusy(false);}};
 const semantic=document?sourceDocumentPreview(document,locale):{title:'',fields:[]},preview=useLocalToolAssetPreview(semantic,projectId,document?.namespace??'',eraId);
 const context=useRichProseHostContext({view,canEdit,scope:{projectId,eraId},...(document?{document:{id:documentId,namespace:document.namespace,title:document.title}}:{})},client,document?.codec);
 if(ancestors.includes(identity))return <p className="text-sm text-text-muted">{es?'Referencia circular al documento abierto.':'Circular reference to the open document.'}</p>;
 if(!record)return <p role="status">{es?'Cargando documento…':'Loading document…'}</p>;
 if(!document)return <p role="alert">{es?'El documento no está disponible en este contexto.':'This document is unavailable in this context.'}</p>;
 const Component=definition?.component;
 const enabled=!!record.project?.enabledEngines.includes('local-tool-'+document.namespace);
 const fallback=!allowed||!client||!Component||(!canEdit&&!(retainPresentation||definition?.app&&enabled));
 const componentContext={...context,...(definition?.app?{app:definition.app}:{})};
 return <LocalToolFocusHost context={context} releaseHash={hash} identity={client} visible={visible&&!fullscreen} namespace={document.namespace} instanceId={instanceId}>{(focusContext,focusControl)=><section className="min-w-0 space-y-3 text-text-primary" data-source-document-host={documentId} data-source-document-view={view}>
  {chrome&&<header className="flex flex-wrap items-center gap-3"><h3 className="min-w-0 flex-1 break-words font-display text-lg">{document.title}</h3>{focusControl}{view!=='fullscreen'&&<button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-elevated disabled:opacity-50" disabled={busy} onClick={()=>void changeFullscreen(true)}><Maximize2 size={15}/>{es?'Pantalla completa':'Fullscreen'}</button>}</header>}
  {blocked&&<p role="alert" className="text-sm text-danger">{es?'Guarda o revisa el borrador pendiente antes de cambiar de vista.':'Save or review the pending draft before changing views.'}</p>}
  {error&&<p role="status" className="text-sm text-text-muted">{es?'Fuente no disponible. Se conserva el contenido guardado.':'Source unavailable. Saved content is preserved.'}</p>}
  <LocalToolAtomPendingContext.Provider value={reportPending}><LocalToolHostAncestors.Provider value={[...ancestors,identity]}><EnginePaneContext.Provider value={pane}><LocalToolUndoBoundary data-tool-editor-surface data-engine-pane-id={instanceId} onFocusCapture={()=>activateEnginePane(instanceId)} onPointerDownCapture={()=>activateEnginePane(instanceId)}>
   {fallback?<div className="prose prose-sm max-w-none break-words text-text-primary" dangerouslySetInnerHTML={{__html:renderRichProsePreview(preview,false)}}/>:<LocalToolTutorialHost definition={definition!} context={focusContext} releaseHash={hash} identity={client} visible={visible&&!fullscreen}>{tutorialContext=><LocalToolContextMenuHost context={tutorialContext} releaseHash={hash} identity={client} visible={visible&&!fullscreen}>{menuContext=><LocalRuntimeErrorBoundary namespace={document.namespace} contentHash={presentationHash}><LocalToolPendingBoundary><Component key={retainPresentation||definition?.app?documentId:`${documentId}:${eraId??'base'}:${hash??'development'}`} projectId={projectId} client={client} context={{...menuContext,...(componentContext.app?{app:componentContext.app}:{})}}/></LocalToolPendingBoundary></LocalRuntimeErrorBoundary>}</LocalToolContextMenuHost>}</LocalToolTutorialHost>}
  </LocalToolUndoBoundary></EnginePaneContext.Provider></LocalToolHostAncestors.Provider></LocalToolAtomPendingContext.Provider>
  {fullscreen&&<Modal open fullscreen title={document.title} busy={busy} dismissible={false} onClose={()=>void changeFullscreen(false)}><div className="space-y-3 p-5"><button type="button" className="min-h-10 rounded-lg border border-border px-3 text-sm" disabled={busy} onClick={()=>void changeFullscreen(false)}>{es?'Guardar y volver':'Save and return'}</button>{blocked&&<p role="alert">{es?'El borrador sigue pendiente.':'The draft is still pending.'}</p>}<LocalToolDocumentHost projectId={projectId} eraId={eraId} documentId={documentId} namespace={namespace} view="fullscreen" readOnly={readOnly} chrome={false}/></div></Modal>}
 </section>}</LocalToolFocusHost>;
}
