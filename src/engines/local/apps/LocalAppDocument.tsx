import {useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {flushPendingWrites,registerPendingFlusher} from '@/services/pendingWrites';
import {useTranslation} from '@/i18n/useTranslation';
import LocalToolDocumentHost from '../documents/LocalToolDocumentHost';
import {LocalToolAtomPendingContext} from '../blocks/pending';
import {useLocalToolState} from '../useLocalToolState';
import type {LocalToolProps,LocalToolJson} from '../sdk';
import {LocalAppHostContext,LocalAppChildrenContext} from './context';
import {registerLocalAppHost} from './ports';
import {localAppPath} from './routes';
import type {LocalAppDetails,LocalAppMember,LocalAppServices} from './types';

const button='min-h-10 rounded-lg border border-border px-3 text-sm hover:bg-elevated disabled:opacity-40';
type MountedMember={key:string;member:LocalAppMember;retired:boolean};
const memberKey=(member:LocalAppMember)=>JSON.stringify([member.id,member.document?.documentId,member.variant]);
export default function LocalAppDocument({client,context}:LocalToolProps<LocalToolJson>){
 const {locale}=useTranslation(),es=locale==='es',pane=useEnginePane(),location=useLocation(),routerNavigate=useNavigate(),state=useLocalToolState(client,{observe:true}),outerPending=useContext(LocalToolAtomPendingContext);
 const localChanges=useRef(new Set<string>()),pending=useRef(new Map<string,Set<string>>()),[pendingVersion,setPendingVersion]=useState(0),alive=useRef(true),listeners=useRef(new Set<()=>void>()),current=useRef({client,context,pane,location,routerNavigate});
 useLayoutEffect(()=>{current.current={client,context,pane,location,routerNavigate};});
 const [details,setDetails]=useState(context?.app),[mounts,setMounts]=useState<MountedMember[]>([]),[exporting,setExporting]=useState(false),[error,setError]=useState('');
 const anyPending=()=>[...pending.current.values()].some(tokens=>tokens.size>0);
 useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useLayoutEffect(()=>{outerPending?.('local-app-members',anyPending());return()=>outerPending?.('local-app-members',false);},[outerPending,pendingVersion]);
 const hasPending=anyPending();
 useEffect(()=>hasPending?registerPendingFlusher('local-app-'+crypto.randomUUID(),async()=>!anyPending(),true):undefined,[hasPending]);
 useEffect(()=>{if(!anyPending())setDetails(context?.app);},[context?.app,pendingVersion]);
 const app=details,raw=state.snapshot?.data,children=raw&&typeof raw==='object'&&!Array.isArray(raw)&&Array.isArray(raw.children)?raw.children as unknown as LocalAppMember[]:undefined;
 useLayoutEffect(()=>{
  if(!children)return;
  setMounts(previous=>{
   const live=new Set(children.map(memberKey)),result:MountedMember[]=[];
   for(const member of children){const old=previous.find(item=>!item.retired&&memberKey(item.member)===memberKey(member));result.push(old??{key:crypto.randomUUID(),member,retired:false});}
   for(const old of previous)if(old.retired||!live.has(memberKey(old.member))){if(!old.retired&&localChanges.current.delete(old.key))continue;result.push(old.retired?old:{...old,retired:true});}
   return result.length===previous.length&&result.every((item,i)=>item===previous[i])?previous:result;
  });
 },[children]);
 const service=useMemo<LocalAppServices|undefined>(()=>{
  if(!app||!client.documentId)return undefined;
  let active=true;
  const id=crypto.randomUUID(),binding=client;
  const path=()=>localAppPath(new URLSearchParams(current.current.location.search).get('appPath')??'',app.descriptor.subRoutes);
  const route={get:()=>({path:path()}),subscribe:(changed:()=>void)=>{listeners.current.add(changed);return()=>{listeners.current.delete(changed);};},set:async(value:string,options?:{replace?:boolean})=>{
   if(!active||!alive.current||current.current.client!==binding)return{available:false,applied:false};
   const normalized=localAppPath(value,app.descriptor.subRoutes),query=new URLSearchParams(current.current.location.search);if(normalized)query.set('appPath',normalized);else query.delete('appPath');
   const target=current.current.location.pathname+(query.size?'?'+query:'');
   // The existing pane owns history, including secondary panes and Back.
   if(current.current.pane?.primary===false)current.current.pane.navigate?.(target);else current.current.routerNavigate(target,options);return{available:true,applied:true,path:normalized};
  }};
  const value:LocalAppServices={hostId:id,appId:app.descriptor.id,instanceId:client.documentId,scope:{projectId:client.projectId,...client.eraId?{eraId:client.eraId}:{}},readOnly:context?.canEdit===false,stateClient:client,tools:app.descriptor.tools,route,members:{apply:async(actions,baseline)=>{
   if(!active||current.current.client!==binding||!binding.state)throw Error('local_app_host_released');
   const snapshot=baseline??await binding.read();
   const affected=mountsRef.current.filter(item=>!item.retired&&actions.some(action=>action.field==='children'&&action.type!=='list-insert'&&action.type!=='list-move'&&(!('id'in action)||action.id===item.member.id)));
   const blocked=()=>affected.some(item=>pending.current.get(item.key)?.size);
   if(blocked()){await flushPendingWrites();if(!active||current.current.client!==binding)throw Error('local_app_host_released');if(blocked())return{applied:false};}
   affected.forEach(item=>localChanges.current.add(item.key));
   const applied=await stateRef.current.apply(actions,snapshot);if(!applied)affected.forEach(item=>localChanges.current.delete(item.key));return{applied};
  }}};
  Object.defineProperty(value,'release',{value:()=>{active=false;}});return value;
 },[client,app,context?.canEdit]);
 const mountsRef=useRef(mounts),stateRef=useRef(state);mountsRef.current=mounts;stateRef.current=state;
 useLayoutEffect(()=>{if(!service)return;const unregister=registerLocalAppHost(service);return()=>{unregister();(service as LocalAppServices&{release:()=>void}).release();};},[service]);
 useLayoutEffect(()=>{for(const changed of listeners.current)changed();},[location.search]);
 if(!app||!service)return <p role="status">{es?'App no disponible.':'App unavailable.'}</p>;
 const Host=app.Host,Surface=app.Surface;
 const nodes=mounts.map(item=><Member key={item.key} item={item} Surface={Surface} allowed={app.descriptor.tools} readOnly={context?.canEdit===false} projectId={client.projectId} eraId={client.eraId} report={(token,value)=>{let tokens=pending.current.get(item.key);if(!tokens){tokens=new Set();pending.current.set(item.key,tokens);}const changed=value?!tokens.has(token):tokens.has(token);if(value)tokens.add(token);else tokens.delete(token);if(changed)setPendingVersion(v=>v+1);}} onClose={()=>{if(!pending.current.get(item.key)?.size)setMounts(rows=>rows.filter(row=>row!==item));}}/>);
 const nodeMap=new Map(mounts.filter(item=>!item.retired).map((item,index)=>[item.member.id,nodes[index]]));
 const exportPage=async()=>{if(exporting||!app.descriptor.publishPreset)return;setExporting(true);setError('');const owner=service;try{const {prepareLocalAppPublication,renderLocalAppPublication}=await import('./publication');const owned=await prepareLocalAppPublication({projectId:client.projectId,eraId:client.eraId,appId:app.descriptor.id,instanceId:client.documentId!,preset:app.descriptor.publishPreset,locale:es?'es':'en'});const artifact=renderLocalAppPublication(owned);if(!alive.current||current.current.client!==owner.stateClient)return;const href=URL.createObjectURL(new Blob([artifact.html],{type:'text/html;charset=utf-8'}));try{const link=document.createElement('a');link.href=href;link.download=artifact.filename;link.click();}finally{URL.revokeObjectURL(href);}}catch(reason){if(alive.current)setError(String(reason));}finally{if(alive.current)setExporting(false);}};
 return <LocalAppHostContext.Provider value={service}><LocalAppChildrenContext.Provider value={nodeMap}><div className="min-w-0 space-y-3"><button type="button" className={button} data-local-app-export hidden={!app.descriptor.publishPreset} disabled={exporting} onClick={()=>void exportPage()}>{exporting?(es?'Preparando…':'Preparing…'):(es?'Exportar HTML':'Export HTML')}</button>{error&&<p role="alert" className="text-sm text-danger">{error}</p>}<Host>{nodes}</Host></div></LocalAppChildrenContext.Provider></LocalAppHostContext.Provider>;
}
function Member({item,Surface,allowed,readOnly,projectId,eraId,report,onClose}:{item:MountedMember;Surface:LocalAppDetails['Surface'];allowed:readonly string[];readOnly:boolean;projectId:string;eraId?:string;report:(token:string,pending:boolean)=>void;onClose:()=>void}){
 const {locale}=useTranslation(),es=locale==='es',reportRef=useRef(report);
 useLayoutEffect(()=>{reportRef.current=report;},[report]);
 const stableReport=useMemo(()=>(token:string,value:boolean)=>reportRef.current(token,value),[]);
 // The wrapper, key and host stay in the same tree when remote membership
 // disappears. Only its recovery controls change; the draft is never copied.
 return <section data-local-app-entry={item.member.id} {...item.retired?{'data-local-app-detached':item.member.id}:{}} className="min-w-0 space-y-2"><div>{item.retired&&<><p className="text-sm text-text-muted">{es?'Documento desvinculado. Guarda o descarta su borrador antes de cerrar.':'Detached document. Save or discard its draft before closing.'}</p><button type="button" className={button} data-local-app-recovery-close onClick={onClose}>{es?'Cerrar documento':'Close document'}</button></>}</div><Surface variant={item.member.variant}><LocalToolAtomPendingContext.Provider value={stableReport}><LocalToolDocumentHost projectId={projectId} eraId={eraId} documentId={item.member.document.documentId} allowedNamespaces={allowed} retainPresentation readOnly={readOnly}/></LocalToolAtomPendingContext.Provider></Surface></section>;
}
