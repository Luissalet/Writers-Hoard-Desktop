import {useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {useTranslation,t as translate} from '@/i18n/useTranslation';
import {toast} from '@/components/common/toast';
import {copyLocalToolMenuEntries,type LocalToolContextMenuPort,type LocalToolMenuEntry} from './contextMenus';
import type {LocalToolHostContext} from './sdk';

type CloseReason='escape'|'tab'|'selection'|'outside'|'replaced'|'revoked';
interface Presentation {token:object;label:string;entries:readonly LocalToolMenuEntry[];x:number;y:number;document:Document;close:(reason:CloseReason)=>void;select:(index:number)=>void}
const presented=new WeakMap<Document,Presentation>();
/** Internal browser presenter, deliberately outside the public SDK graph. */
export default function LocalToolContextMenuHost({context,releaseHash,identity,visible=true,children}:{context:LocalToolHostContext;releaseHash:string|null;identity:unknown;visible?:boolean;children:(context:LocalToolHostContext)=>ReactNode}){
 const pane=useEnginePane(),{locale}=useTranslation(),root=useRef<HTMLDivElement>(null),[port,setPort]=useState<LocalToolContextMenuPort>(),[menu,setMenu]=useState<Presentation>();
 const {projectId,eraId}=context.scope,documentId=context.document?.id,namespace=context.document?.namespace;
 const enabled=visible&&(pane?.visible??true)&&context.canEdit&&context.view==='editor';
 useLayoutEffect(()=>{
  let live=true,own:Presentation|undefined;const element=root.current;
  queueMicrotask(()=>{if(live)setPort(undefined);});
  if(!enabled||!element)return()=>{live=false;};
  const current=()=>live&&element.isConnected;
  const close=(reason:CloseReason)=>{
   const before=own;if(!before)return;own=undefined;
   if(presented.get(before.document)===before)presented.delete(before.document);
   setMenu(value=>value===before?undefined:value);
   if(['escape','tab','selection'].includes(reason)&&current()){
    const trigger=triggers.get(before.token);if(trigger?.isConnected)trigger.focus({preventScroll:true});
   }
   triggers.delete(before.token);
  };
  const nextPort:LocalToolContextMenuPort={open(event,entries,options){
   if(!current())return false;
   const trigger=event.currentTarget,realm=element.ownerDocument.defaultView;
   if(!realm||!(trigger instanceof realm.HTMLElement)||!element.contains(trigger)||!trigger.isConnected||typeof options?.label!=='string'||!options.label.trim())return false;
   let copy:readonly LocalToolMenuEntry[]|null;try{copy=copyLocalToolMenuEntries(entries);}catch{return false;}if(!copy)return false;
   if(event.key!==undefined&&!(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey))return false;
   const keyboard=event.key!==undefined||event.type==='click'&&event.detail===0,rect=trigger.getBoundingClientRect(),x=keyboard?rect.left:event.clientX,y=keyboard?rect.bottom:event.clientY;
   if(typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||!Number.isFinite(y))return false;
   const doc=element.ownerDocument;presented.get(doc)?.close('replaced');
   const next:Presentation={token:{},label:options.label,entries:copy,x,y,document:doc,close,select(index){
    if(!current()||own!==next||presented.get(doc)!==next)return;
    const entry=next.entries[index];if(entry?.kind!=='item'||entry.disabled)return;
    flushSync(()=>close('selection'));if(!current())return;
    try{void Promise.resolve(entry.onSelect()).catch(()=>{if(current())toast.error(translate('localTool.contextMenu.actionFailed'));});}catch{if(current())toast.error(translate('localTool.contextMenu.actionFailed'));}
   }};
   own=next;triggers.set(next.token,trigger);presented.set(doc,next);setMenu(next);event.preventDefault();event.stopPropagation();return true;
  },close:()=>{if(current())close('outside');}};
  queueMicrotask(()=>{if(live)setPort(nextPort);});
  return()=>{live=false;close('revoked');};
 },[enabled,projectId,eraId,documentId,namespace,releaseHash,identity,locale]);
 const nextContext=useMemo(()=>({...context,contextMenu:enabled?port:undefined}),[context,enabled,port]);
 return <div ref={root} className="min-w-0" data-local-tool-menu-root>{children(nextContext)}{menu&&<MenuPanel menu={menu} paneId={pane?.instanceId}/>}</div>;
}
const triggers=new WeakMap<object,HTMLElement>();
function MenuPanel({menu,paneId}:{menu:Presentation;paneId?:string}){
 const box=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:menu.x,top:menu.y});
 useLayoutEffect(()=>{
  const node=box.current,doc=menu.document,win=doc.defaultView;if(!node||!win)return;
  const bounds=node.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(menu.x,win.innerWidth-bounds.width-8)),top:Math.max(8,Math.min(menu.y,win.innerHeight-bounds.height-8))});
  (node.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')??node).focus({preventScroll:true});
  const outside=(event:Event)=>{if(event.target instanceof win.Node&&!node.contains(event.target))menu.close('outside');};
  const scroll=(event:Event)=>{if(!(event.target instanceof win.Node)||!node.contains(event.target))menu.close('outside');};
  const resize=()=>menu.close('outside');
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('focusin',outside,true);doc.addEventListener('scroll',scroll,true);win.addEventListener('resize',resize);
  return()=>{doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('focusin',outside,true);doc.removeEventListener('scroll',scroll,true);win.removeEventListener('resize',resize);};
 },[menu]);
 return createPortal(<div ref={box} role="menu" aria-label={menu.label} tabIndex={-1} data-local-tool-context-menu data-state="open" data-engine-pane-id={paneId} className="fixed z-[90] max-h-[calc(100vh-1rem)] w-60 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1.5 text-text-primary shadow-2xl" style={position} onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();menu.close('escape');return;}
  if(event.key==='Tab'){menu.close('tab');return;}
  if(event.key==='Enter'||event.key===' '){const item=(event.target as Element).closest<HTMLButtonElement>('button[data-menu-index]');if(item&&!item.disabled){event.preventDefault();event.stopPropagation();menu.select(Number(item.dataset.menuIndex));}return;}
  if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const items=[...box.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];if(!items.length)return;
  const index=items.indexOf(menu.document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();
 }}>{menu.entries.map((entry,index)=>entry.kind==='separator'?<div key={index} role="separator" className="my-1 border-t border-border"/>:entry.kind==='label'?<div key={index} className="break-words px-2.5 py-1.5 text-sm text-text-muted">{entry.label}</div>:<button key={entry.id} data-menu-index={index} type="button" role="menuitem" tabIndex={-1} disabled={entry.disabled} onClick={()=>menu.select(index)} className={`flex min-h-9 w-full items-center rounded px-2.5 py-1.5 text-left text-sm [overflow-wrap:anywhere] hover:bg-elevated focus:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60 disabled:cursor-default disabled:opacity-50 ${entry.variant==='destructive'?'text-danger enabled:text-[color:color-mix(in_srgb,var(--color-danger)_60%,var(--color-text-primary))]':'text-text-secondary hover:text-text-primary'}`}>{entry.label}</button>)}</div>,menu.document.body);
}
