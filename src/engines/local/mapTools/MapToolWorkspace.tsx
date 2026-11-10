import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode,type RefObject} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {useSearchParams} from 'react-router-dom';
import {ExternalLink,Plus,Wrench} from 'lucide-react';
import {db} from '@/db';
import {useTranslation} from '@/i18n/useTranslation';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {usePaneNavigate} from '@/engines/_shared/usePaneNavigate';
import type {WorldEraScope} from '@/services/worldEras/types';
import {discardPendingOwner,flushPendingWrites,trackPendingWrite} from '@/services/pendingWrites';
import LocalToolDocumentHost from '../documents/LocalToolDocumentHost';
import {createSourceToolDocument,readSourceToolDocument} from '../documents/store';
import {assertLocalMapAuthority,listLocalMapTools,localMapTargetPath,readLocalMapBinding} from './catalog';
import {assertLocalMapDocumentBinding,sameLocalMapScope,sameLocalMapTarget,type LocalMapAuthority,type LocalMapResolvedBinding,type LocalToolMapContext,type LocalToolMapTarget} from './contracts';
import {registerLocalMapHost} from './ports';

export interface MapToolWorkspaceProps {
 scope:WorldEraScope;kind:'maps'|'worldgen';target:LocalToolMapTarget|null;readOnly?:boolean;
 presentation?:LocalToolMapContext['presentation'];visible?:boolean;
 onSelectTarget:(target:LocalToolMapTarget,selection?:{namespace:string;documentId:string;expectedContentHash:string|null})=>void|Promise<void>;
 children:(controls:{requestChange:(action:()=>void|Promise<void>)=>Promise<boolean>})=>ReactNode;
}
type Selection={scope:WorldEraScope;target:LocalToolMapTarget;namespace:string;documentId:string;binding:LocalMapResolvedBinding};
type Attempt={owner:string;title:string;status:'pending'|'failed'};
type Lifetime={active:boolean};
const control='min-h-10 min-w-0 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-40';
const button='inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-40';
const scopeKey=(scope:WorldEraScope)=>JSON.stringify([scope.projectId,scope.eraId??null]);
const targetKey=(target:LocalToolMapTarget|null)=>JSON.stringify(target?[target.kind,target.documentId]:null);
const currentPresentation:LocalToolMapContext['presentation']={kind:'current'};

/** Metadata may refresh without replacing an executable lease. Map versions and
 * Source note revisions are information, not the identity of an authority. */
function useMapAuthority(binding:LocalMapResolvedBinding|undefined,readOnly:boolean,identity:string,liveIdentity:RefObject<string>,lifetime:Lifetime){
 const slot=useRef<LocalMapAuthority|undefined>(undefined);
 const signature=binding?JSON.stringify([scopeKey(binding.scope),targetKey(binding.target),binding.namespace,binding.pinRevision,binding.contentHash,binding.mapPanel,readOnly,identity]):'';
 const definition=binding?.definition;
 const authority=useMemo(()=>{
  if(!binding)return undefined;
  const issued:LocalMapAuthority=Object.freeze({...binding,scope:Object.freeze({...binding.scope}),target:Object.freeze({...binding.target}),readOnly,
   isCurrent:()=>lifetime.active&&slot.current===issued&&liveIdentity.current===identity});
  return issued;
  // The signature covers authority data; refreshed title/version alone does
  // not revoke a valid editor while the map's own writer changes its content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[definition,signature,lifetime]);
 slot.current=authority;
 return authority;
}

/** Always mounted by the engine, outside canvas keys and missing-target branches. */
export default function MapToolWorkspace({scope,kind,target,readOnly:requestedReadOnly=false,presentation=currentPresentation,visible,onSelectTarget,children}:MapToolWorkspaceProps){
 const readOnly=requestedReadOnly||presentation.kind==='map-version';
 const {locale}=useTranslation(),es=locale==='es',pane=useEnginePane(),navigate=usePaneNavigate();
 const [searchParams,setSearchParams]=useSearchParams();
 const [hostId]=useState(()=>`local-map-host-${crypto.randomUUID()}`);
 const [lifetime,setLifetime]=useState<Lifetime>(()=>({active:false}));
 useLayoutEffect(()=>{const next={active:true};setLifetime(next);return()=>{next.active=false;};},[]);
 const [namespace,setNamespace]=useState(''),[selected,setSelected]=useState<Selection>(),[title,setTitle]=useState(''),[attempt,setAttempt]=useState<Attempt>(),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const attemptRef=useRef(attempt);attemptRef.current=attempt;
 const creationLock=useRef(false),navigationSequence=useRef(0);
 const identity=JSON.stringify([scopeKey(scope),kind,targetKey(target),readOnly,presentation]);
 const liveIdentity=useRef(identity);liveIdentity.current=identity;
 const current=useRef({scope,kind,target,readOnly,presentation,onSelectTarget,namespace,lifetime,visible:visible??pane?.visible??true});
 current.current={scope,kind,target,readOnly,presentation,onSelectTarget,namespace,lifetime,visible:visible??pane?.visible??true};
 const requestChange=useCallback(async(action:()=>void|Promise<void>)=>{
  const captured=current.current,expected=liveIdentity.current,request=++navigationSequence.current;
  if(!captured.lifetime.active)return false;
  setError('');
  try{
   const result=await flushPendingWrites();
   if(!captured.lifetime.active||liveIdentity.current!==expected||request!==navigationSequence.current)return false;
   if(!result.ok){setError('pending');return false;}
   await action();
   return true;
  }catch{
   if(captured.lifetime.active&&request===navigationSequence.current)setError('change');
   return false;
  }
 },[]);
 const catalogueKey=JSON.stringify([scopeKey(scope),targetKey(target)]);
 const catalogue=useLiveQuery(async()=>{
  try{return {key:catalogueKey,value:await listLocalMapTools(scope,target??undefined)};}
  catch{return {key:catalogueKey,value:undefined};}
 },[catalogueKey,reload]);
 const rows=catalogue?.key===catalogueKey?catalogue.value:undefined;
 const tools=useMemo(()=>rows?.tools.filter(tool=>!tool.mapPanel||tool.mapPanel.kinds.includes(kind))??[],[rows,kind]);
 useEffect(()=>{if(!namespace){const first=tools.find(tool=>tool.enabled&&tool.mapPanel);if(first)setNamespace(first.namespace);}},[namespace,tools]);
 const bindingKey=JSON.stringify([identity,namespace]);
 const bindingRecord=useLiveQuery(async()=>{
  if(!target||!namespace)return {key:bindingKey,binding:undefined};
  try{return {key:bindingKey,binding:await readLocalMapBinding(scope,target,namespace,{readOnly,presentation})};}
  catch{return {key:bindingKey,binding:undefined};}
 },[bindingKey]);
 const binding=bindingRecord?.key===bindingKey?bindingRecord.binding:undefined;
 const createAuthority=useMapAuthority(binding,readOnly,identity,liveIdentity,lifetime);
 const selectedKey=selected?JSON.stringify([scopeKey(selected.scope),targetKey(selected.target),selected.namespace,selected.documentId]):'';
 const selectedRecord=useLiveQuery(async()=>{
  if(!selected)return undefined;
  let effective:LocalMapResolvedBinding|undefined;
  try{
   effective=await readLocalMapBinding(selected.scope,selected.target,selected.namespace);
   const read=await readSourceToolDocument(selected.scope,selected.documentId,selected.namespace);
   if(!read)throw Error('local_tool_map_document_unavailable');
   assertLocalMapDocumentBinding(read.document,effective.mapPanel,effective.target);
   return {key:selectedKey,binding:effective,valid:true};
  }catch{return {key:selectedKey,binding:effective,valid:false};}
 },[selectedKey]);
 const selectedFresh=selectedRecord?.key===selectedKey?selectedRecord:undefined;
 const retained=useRef<{id:string;binding:LocalMapResolvedBinding}|undefined>(undefined);
 if(selected&&selectedFresh?.binding)retained.current={id:selected.documentId,binding:selectedFresh.binding};
 const selectedBinding=selectedFresh?.binding??(retained.current?.id===selected?.documentId?retained.current?.binding:selected?.binding);
 const matches=!!selected&&sameLocalMapScope(selected.scope,scope)&&sameLocalMapTarget(selected.target,target);
 const paused=!matches||!selectedFresh?.valid||readOnly;
 const selectedIdentity=JSON.stringify([identity,selected?.documentId??null,selected?.namespace??null,!!selectedFresh?.valid,matches]);
 const liveSelectedIdentity=useRef(selectedIdentity);liveSelectedIdentity.current=selectedIdentity;
 const mapAuthority=useMapAuthority(selectedBinding,paused,selectedIdentity,liveSelectedIdentity,lifetime);
 const mapContext=matches&&selectedFresh?.binding?{...selectedFresh.binding.context,readOnly:paused,presentation}:undefined;

 const chooseDocument=async(documentId:string,requestedNamespace=namespace,expectedHash?:string|null)=>requestChange(async()=>{
  const captured=current.current,expected=liveIdentity.current,request=navigationSequence.current;
  if(!captured.target)throw Error('local_tool_map_target_unavailable');
  const resolved=await readLocalMapBinding(captured.scope,captured.target,requestedNamespace,{readOnly:captured.readOnly,presentation:captured.presentation});
  if(!captured.lifetime.active||liveIdentity.current!==expected||request!==navigationSequence.current)throw Error('local_tool_context_expired');
  if(expectedHash!==undefined&&expectedHash!==resolved.contentHash)throw Error('local_tool_map_pin_changed');
  const read=await readSourceToolDocument(captured.scope,documentId,requestedNamespace);
  if(!captured.lifetime.active||liveIdentity.current!==expected||request!==navigationSequence.current||!read)throw Error('local_tool_context_expired');
  assertLocalMapDocumentBinding(read.document,resolved.mapPanel,resolved.target);
  setNamespace(requestedNamespace);setSelected({scope:{...captured.scope},target:{...captured.target},namespace:requestedNamespace,documentId,binding:resolved});
 });
 const chooseRef=useRef(chooseDocument);chooseRef.current=chooseDocument;
 // This is ordinary navigation data on a live route, never a headless queue.
 // Worldgen consumes its world query when accepting the target; retain only
 // that same URL intent while its three Source parameters remain present.
 const incoming=useRef<{key:string;target:LocalToolMapTarget;namespace:string;documentId:string;hash:string|null}|undefined>(undefined);
 const toolParam=searchParams.get('mapTool'),documentParam=searchParams.get('mapDocument'),releaseParam=searchParams.get('mapRelease');
 const linkKey=toolParam&&documentParam&&releaseParam?JSON.stringify([scopeKey(scope),toolParam,documentParam,releaseParam]):'';
 const routeTarget=searchParams.get(kind==='maps'?'map':'world');
 const attemptedLink=useRef('');
 if(!linkKey){incoming.current=undefined;attemptedLink.current='';}
 else if(routeTarget)incoming.current={key:linkKey,target:{kind,documentId:routeTarget},namespace:toolParam!,documentId:documentParam!,hash:releaseParam==='development'?null:releaseParam!};
 const queryRef=useRef(searchParams);queryRef.current=searchParams;
 useEffect(()=>{
  const intent=incoming.current;
  const attemptKey=intent?JSON.stringify([intent.key,targetKey(intent.target)]):'';
  if(!lifetime.active||!intent||intent.key!==linkKey||(intent.target.kind!==target?.kind||intent.target.documentId!==target?.documentId)||attemptedLink.current===attemptKey)return;
  attemptedLink.current=attemptKey;
  let active=true;
  void chooseRef.current(intent.documentId,intent.namespace,intent.hash).then(applied=>{
   const query=queryRef.current;
   if(!active||!applied||JSON.stringify([scopeKey({projectId:scope.projectId,eraId:scope.eraId}),query.get('mapTool'),query.get('mapDocument'),query.get('mapRelease')])!==intent.key)return;
   const next=new URLSearchParams(query);next.delete('mapTool');next.delete('mapDocument');next.delete('mapRelease');setSearchParams(next,{replace:true});
  });
  return()=>{active=false;};
 },[linkKey,kind,target?.kind,target?.documentId,scope.projectId,scope.eraId,setSearchParams,lifetime]);
 useEffect(()=>registerLocalMapHost({hostId,
  snapshot:()=>{const now=current.current;return {scope:now.scope,target:now.target,kind:now.kind,readOnly:now.readOnly||!now.target,visible:now.visible};},
  open:async input=>{
   const now=current.current;
   if(!now.lifetime.active)return {available:false,applied:false};
   if(sameLocalMapTarget(now.target,input.target))return {available:true,applied:await chooseRef.current(input.documentId,input.namespace,input.expectedContentHash),path:localMapTargetPath(now.scope,input.target)};
   const before=liveIdentity.current;
   let selection:Selection|undefined;
   const applied=await requestChange(async()=>{
    const request=navigationSequence.current;
    const resolved=await readLocalMapBinding(now.scope,input.target,input.namespace);
    if(!now.lifetime.active||liveIdentity.current!==before||request!==navigationSequence.current||resolved.contentHash!==input.expectedContentHash)throw Error('local_tool_context_expired');
    const read=await readSourceToolDocument(now.scope,input.documentId,input.namespace);
    if(!now.lifetime.active||liveIdentity.current!==before||request!==navigationSequence.current||!read)throw Error('local_tool_context_expired');
    assertLocalMapDocumentBinding(read.document,resolved.mapPanel,input.target);
    selection={scope:{...now.scope},target:{...input.target},namespace:input.namespace,documentId:input.documentId,binding:resolved};
    await now.onSelectTarget(input.target,input.target.kind!==now.kind?{namespace:input.namespace,documentId:input.documentId,expectedContentHash:input.expectedContentHash}:undefined);
    if(input.target.kind===now.kind&&now.lifetime.active){setNamespace(input.namespace);setSelected(selection);}
   });
   return {available:true,applied,path:localMapTargetPath(now.scope,input.target)};
  },
 }),[hostId,requestChange]);

 const createDocument=async()=>{
  if(creationLock.current||attemptRef.current||!createAuthority||createAuthority.readOnly||!title.trim())return;
  // Capture the already resolved live binding synchronously BEFORE flushing.
  // A queued RW must not be preceded by an untracked read waiting on itself.
  const ticket=createAuthority,capturedBinding=binding!,capturedTitle=title,capturedIdentity=identity;
  creationLock.current=true;setError('');
  try{
   const flushed=await flushPendingWrites();
   if(!ticket.isCurrent())return;
   if(!flushed.ok){setError('pending');return;}
   const owner=`local-map-create-${crypto.randomUUID()}`;
   const next:Attempt={owner,title:capturedTitle,status:'pending'};attemptRef.current=next;setAttempt(next);
   const creation=db.transaction('rw',db.tables,async()=>{
    await assertLocalMapAuthority(ticket);
    const created=await createSourceToolDocument(ticket.scope,ticket.namespace,capturedTitle,{initialActions:[{type:'set',field:ticket.mapPanel.targetField,value:ticket.target}]});
    await assertLocalMapAuthority(ticket,created.id);
    const saved=await readSourceToolDocument(ticket.scope,created.id,ticket.namespace);
    if(!saved||saved.document.revision!==1||saved.document.namespace!==ticket.namespace)throw Error('local_tool_map_creation_invalid');
    assertLocalMapDocumentBinding(saved.document,ticket.mapPanel,ticket.target);
    if(!ticket.isCurrent()||ticket.readOnly)throw Error('local_tool_context_expired');
    return created;
   });
   let created;
   try{created=await trackPendingWrite(creation,undefined,owner);}
   catch{
    if(lifetime.active){const failed:Attempt={...next,status:'failed'};attemptRef.current=failed;setAttempt(failed);setError('create');}
    return;
   }
   // A committed document remains valid even if its presentation was lost after
   // admission. Do not classify a later navigation loss as an aborted creation.
   if(lifetime.active){attemptRef.current=undefined;setAttempt(undefined);}
   if(ticket.isCurrent()&&liveIdentity.current===capturedIdentity&&current.current.namespace===ticket.namespace){
    setSelected({scope:{...ticket.scope},target:{...ticket.target},namespace:ticket.namespace,documentId:created.id,binding:capturedBinding});setTitle('');
   }
  }catch{if(lifetime.active)setError('create');}
  finally{creationLock.current=false;}
 };
 const recover=(owner:string)=>{
  if(creationLock.current||attemptRef.current?.owner!==owner||attemptRef.current.status!=='failed')return;
  discardPendingOwner(owner);attemptRef.current=undefined;setAttempt(undefined);setError('');
 };
 const tool=tools.find(item=>item.namespace===namespace);
 const documents=tool?.documents.filter(document=>sameLocalMapTarget(document.target,target))??[];
 const name=(value:string|{en:string;es:string})=>typeof value==='string'?value:value[es?'es':'en'];
 const sourcePath=selected?`/project/${encodeURIComponent(selected.scope.projectId)}/local-tool-${selected.namespace}?${new URLSearchParams({document:selected.documentId,...(selected.scope.eraId?{era:selected.scope.eraId}:{})})}`:'';
 return <div className="min-w-0 space-y-4">
  {children({requestChange})}
  <section data-map-tool-workspace className="min-w-0 space-y-4 border-t border-border pt-4 text-text-primary" aria-label={es?'Herramientas de este mapa':'Tools for this map'}>
   <header className="flex flex-wrap items-center gap-2"><Wrench size={17} className="text-accent-gold" aria-hidden="true"/><h2 className="font-display text-lg">{es?'Herramientas de este mapa':'Tools for this map'}</h2></header>
   <div className="flex flex-wrap items-end gap-3">
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">{es?'Mapa':'Map'}<select data-map-tool-target className={control} value={target?targetKey(target):''} onChange={event=>{const row=rows?.targets.find(item=>targetKey(item.target)===event.target.value);if(row)void requestChange(()=>current.current.onSelectTarget(row.target));}}>
     <option value="" disabled>{es?'Mapa no disponible':'Map unavailable'}</option>{rows?.targets.map(item=><option key={targetKey(item.target)} value={targetKey(item.target)}>{item.title} · {item.target.kind==='maps'?(es?'Mapa':'Map'):(es?'Mundo':'World')}</option>)}
    </select></label>
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">{es?'Herramienta de mapa':'Map tool'}<select data-map-tool-namespace className={control} value={namespace} onChange={event=>{const value=event.target.value;void requestChange(()=>{setNamespace(value);setSelected(undefined);});}}><option value="" disabled>{es?'Elegir herramienta':'Choose tool'}</option>{tools.map(item=><option key={item.namespace} value={item.namespace} disabled={!item.enabled||!item.mapPanel}>{name(item.name)}{!item.enabled?(es?' · deshabilitada':' · disabled'):!item.mapPanel?(es?' · no disponible':' · unavailable'):''}</option>)}</select></label>
   </div>
   {!rows?(catalogue?.key!==catalogueKey?<p role="status" className="text-sm text-text-muted">{es?'Cargando herramientas de mapa…':'Loading map tools…'}</p>:<div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-text-muted">{es?'No se pudieron leer las herramientas de mapa. Se conserva el contenido guardado.':'Map tools could not be read. Saved content is preserved.'}</p><button type="button" className={button} onClick={()=>setReload(value=>value+1)}>{es?'Volver a cargar':'Reload'}</button></div>):!tools.length?<p className="max-w-prose text-sm text-text-muted">{es?'Las herramientas Source con un panel de mapa habilitado aparecerán aquí.':'Enabled Source tools with a map panel appear here.'}</p>:null}
   {namespace&&<>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();void createDocument();}}><label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">{es?'Nuevo documento':'New document'}<input data-map-tool-create-title className={control} value={title} onChange={event=>setTitle(event.target.value)} disabled={attempt?.status==='pending'} required/></label><button type="submit" data-map-tool-create className={button} disabled={!binding||readOnly||!title.trim()||!!attempt}><Plus size={15}/>{attempt?.status==='pending'?(es?'Creando…':'Creating…'):(es?'Crear':'Create')}</button></form>
    {!binding&&<p role="status" className="text-sm text-text-muted">{es?'La herramienta o el mapa no están disponibles en este contexto. Se conserva el contenido guardado.':'The tool or map is unavailable in this context. Saved content is preserved.'}</p>}
    <nav aria-label={es?'Documentos de este mapa':'Documents for this map'} className="flex flex-wrap gap-2">{documents.map(document=><button type="button" key={document.id} data-map-tool-document={document.id} className={button+(selected?.documentId===document.id?' border-accent-gold text-accent-gold':'')} aria-current={selected?.documentId===document.id?'page':undefined} onClick={()=>void chooseDocument(document.id)}>{document.title}</button>)}</nav>
    {binding&&!documents.length&&<p className="text-sm text-text-muted">{es?'Este mapa aún no tiene documentos de esta herramienta.':'This map has no documents for this tool yet.'}</p>}
   </>}
   {error&&<p role="alert" className="max-w-prose text-sm text-danger">{error==='pending'?(es?'Guarda o revisa el borrador pendiente antes de cambiar.':'Save or review the pending draft before changing.'):(es?'No se admitió el cambio. Se conservan el título, los borradores y el contenido guardado.':'The change was refused. The title, drafts and saved content are preserved.')}</p>}
   {attempt?.status==='failed'&&<div className="space-y-2"><p className="max-w-prose text-sm text-text-muted">{es?'Abandona esta solicitud rechazada para revisar lo escrito y crear otro intento. No se borra ningún documento ni borrador.':'Discard this rejected request to review the text and make a new attempt. Documents and drafts are preserved.'}</p><button type="button" className={button} onClick={()=>attempt&&recover(attempt.owner)}>{es?'Descartar intento fallido':'Discard failed attempt'}</button></div>}
   {selected&&mapAuthority&&<div className="min-w-0 space-y-3 border-t border-border pt-4">
    <div className="flex flex-wrap items-center gap-3">{paused&&<p role="status" className="min-w-0 flex-1 text-sm text-text-muted">{es?'Panel en pausa. Se conservan el contenido guardado y los borradores.':'Panel paused. Saved content and drafts are retained.'}</p>}<button type="button" className={button} onClick={()=>void requestChange(()=>navigate(sourcePath))}><ExternalLink size={14}/>{es?'Abrir en Source':'Open in Source'}</button><button type="button" className={button} onClick={()=>void requestChange(()=>setSelected(undefined))}>{es?'Cerrar documento':'Close document'}</button></div>
    <LocalToolDocumentHost projectId={selected.scope.projectId} eraId={selected.scope.eraId} documentId={selected.documentId} namespace={selected.namespace} retainPresentation readOnly={paused} mapContext={mapContext} mapAuthority={mapAuthority} allowedNamespaces={[selected.namespace]}/>
   </div>}
  </section>
 </div>;
}
