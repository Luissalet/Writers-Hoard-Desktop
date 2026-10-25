import {useCallback,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {useTranslation,t as translate} from '@/i18n/useTranslation';
import {toast} from '@/components/common/toast';
import {copyLocalToolMenuEntries,type LocalToolContextMenuPort,type LocalToolMenuEntry} from './contextMenus';
import type {LocalToolHostContext} from './sdk';

type CloseReason='escape'|'tab'|'selection'|'outside'|'replaced'|'revoked';
type Item=Extract<LocalToolMenuEntry,{kind:'item'}>;
interface Presentation {id:number;token:object;label:string;entries:readonly LocalToolMenuEntry[];x:number;y:number;document:Document;close:(reason:CloseReason)=>void;select:(entry:Item)=>void}
interface Level {id:number;label:string;entries:readonly LocalToolMenuEntry[];opener?:HTMLButtonElement;entryIndex?:number}
let sequence=0;
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
   const next:Presentation={id:++sequence,token:{},label:options.label,entries:copy,x,y,document:doc,close,select(entry){
    if(!current()||own!==next||presented.get(doc)!==next)return;
    if(entry.disabled)return;
    flushSync(()=>close('selection'));if(!current())return;
    try{void Promise.resolve(entry.onSelect()).catch(()=>{if(current())toast.error(translate('localTool.contextMenu.actionFailed'));});}catch{if(current())toast.error(translate('localTool.contextMenu.actionFailed'));}
   }};
   own=next;triggers.set(next.token,trigger);presented.set(doc,next);setMenu(next);event.preventDefault();event.stopPropagation();return true;
  },close:()=>{if(current())close('outside');}};
  queueMicrotask(()=>{if(live)setPort(nextPort);});
  return()=>{live=false;close('revoked');};
 },[enabled,projectId,eraId,documentId,namespace,releaseHash,identity,locale]);
 const nextContext=useMemo(()=>({...context,contextMenu:enabled?port:undefined}),[context,enabled,port]);
 return <div ref={root} className="min-w-0" data-local-tool-menu-root>{children(nextContext)}{menu&&<MenuTree key={menu.id} menu={menu} paneId={pane?.instanceId}/>}</div>;
}
const triggers=new WeakMap<object,HTMLElement>();
function MenuTree({menu,paneId}:{menu:Presentation;paneId?:string}){
 const [levels,setLevels]=useState<Level[]>(()=>[{id:0,label:menu.label,entries:menu.entries}]);
 const active=useRef(levels),nodes=useRef(new Map<Level,HTMLDivElement>()),nextId=useRef(0),alive=useRef(true);
 const replace=useCallback((next:Level[])=>{active.current=next;setLevels(next);},[]);
 const valid=useCallback((level:Level)=>alive.current&&presented.get(menu.document)===menu&&active.current.includes(level),[menu]);
 const back=useCallback((level:Level)=>{
  if(!valid(level))return;const index=active.current.indexOf(level);if(index<1)return;
  flushSync(()=>replace(active.current.slice(0,index)));level.opener?.focus({preventScroll:true});
 },[valid,replace]);
 const trim=useCallback((level:Level,index?:number)=>{
  if(!valid(level))return;const depth=active.current.indexOf(level),child=active.current[depth+1];
  if(child&&(index===undefined||child.entryIndex!==index))replace(active.current.slice(0,depth+1));
 },[valid,replace]);
 const invoke=useCallback((level:Level,index:number,opener:HTMLButtonElement)=>{
  if(!valid(level))return;const entry=level.entries[index];if(!entry||entry.kind==='label'||entry.kind==='separator'||entry.disabled)return;
  if(entry.kind==='submenu'){
   const depth=active.current.indexOf(level);replace([...active.current.slice(0,depth+1),{id:++nextId.current,label:entry.label,entries:entry.entries,opener,entryIndex:index}]);
  }else menu.select(entry);
 },[valid,replace,menu]);
 useLayoutEffect(()=>{
  alive.current=true;const doc=menu.document,win=doc.defaultView;if(!win)return;
  const contains=(target:EventTarget|null)=>target instanceof win.Node&&active.current.some(level=>nodes.current.get(level)?.contains(target));
  const outside=(event:Event)=>{if(!contains(event.target))menu.close('outside');};
  const scroll=(event:Event)=>{
   if(!contains(event.target)){menu.close('outside');return;}
   const level=active.current.find(row=>event.target instanceof win.Node&&nodes.current.get(row)?.contains(event.target));
   if(level){const child=active.current[active.current.indexOf(level)+1];if(child)back(child);}
  };
  const resize=()=>menu.close('outside');
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('focusin',outside,true);doc.addEventListener('scroll',scroll,true);win.addEventListener('resize',resize);
  return()=>{alive.current=false;doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('focusin',outside,true);doc.removeEventListener('scroll',scroll,true);win.removeEventListener('resize',resize);};
 },[menu,back]);
 return createPortal(<>{levels.map((level,depth)=><MenuLevel key={level.id} menu={menu} level={level} child={levels[depth+1]} paneId={paneId} node={node=>{if(node)nodes.current.set(level,node);else nodes.current.delete(level);}} invoke={invoke} back={back} trim={trim}/>)}</>,menu.document.body);
}

const itemClass='flex min-h-9 w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm [overflow-wrap:anywhere] hover:bg-elevated focus:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60 disabled:cursor-default disabled:opacity-50';
function MenuLevel({menu,level,child,paneId,node,invoke,back,trim}:{menu:Presentation;level:Level;child?:Level;paneId?:string;node:(value:HTMLDivElement|null)=>void;invoke:(level:Level,index:number,opener:HTMLButtonElement)=>void;back:(level:Level)=>void;trim:(level:Level,index?:number)=>void}){
 const box=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:menu.x,top:menu.y}),{t}=useTranslation();
 useLayoutEffect(()=>{
  const element=box.current,win=menu.document.defaultView;if(!element||!win)return;
  const bounds=element.getBoundingClientRect(),anchor=level.opener?.getBoundingClientRect();
  const x=anchor?(anchor.right+bounds.width+8<=win.innerWidth?anchor.right:anchor.left-bounds.width):menu.x,y=anchor?.top??menu.y;
  setPosition({left:Math.max(8,Math.min(x,win.innerWidth-bounds.width-8)),top:Math.max(8,Math.min(y,win.innerHeight-bounds.height-8))});
  (element.querySelector<HTMLElement>('button[data-menu-index]:not(:disabled)')??element.querySelector<HTMLElement>('[data-menu-back]')??element).focus({preventScroll:true});
 },[menu,level]);
 return <div ref={element=>{box.current=element;node(element);}} id={`sdk-menu-${menu.id}-${level.id}`} role="menu" aria-label={level.label} aria-labelledby={level.opener?.id} tabIndex={-1} data-local-tool-context-menu data-state="open" data-menu-level={level.id} data-engine-pane-id={paneId} className="fixed z-[90] max-h-[calc(100vh-1rem)] w-60 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1.5 text-text-primary shadow-2xl" style={position} onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(level.opener)back(level);else menu.close('escape');return;}
  if(event.key==='Tab'){menu.close('tab');return;}
  const win=menu.document.defaultView,target=win&&event.target instanceof win.Element?event.target:null,button=target?.closest<HTMLButtonElement>('button[role="menuitem"]');
  if(event.key==='Enter'||event.key===' '){if(button&&!button.disabled){event.preventDefault();event.stopPropagation();if(button.hasAttribute('data-menu-back'))back(level);else invoke(level,Number(button.dataset.menuIndex),button);}return;}
  if(event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();if(level.opener)back(level);return;}
  if(event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();if(button?.dataset.menuIndex!==undefined&&level.entries[Number(button.dataset.menuIndex)]?.kind==='submenu')invoke(level,Number(button.dataset.menuIndex),button);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const items=[...box.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];if(!items.length)return;
  const index=items.indexOf(menu.document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();
 }}>
  {level.opener&&<button data-menu-back type="button" role="menuitem" tabIndex={-1} onFocus={()=>trim(level)} onClick={()=>back(level)} className={itemClass+' text-text-secondary hover:text-text-primary'}><ChevronLeft size={14} aria-hidden="true"/>{t('common.back')}</button>}
  {level.entries.map((entry,index)=>entry.kind==='separator'?<div key={index} role="separator" className="my-1 border-t border-border"/>:entry.kind==='label'?<div key={index} className="break-words px-2.5 py-1.5 text-sm text-text-muted">{entry.label}</div>:<button key={entry.id} id={`sdk-menu-item-${menu.id}-${level.id}-${index}`} data-menu-index={index} type="button" role="menuitem" tabIndex={-1} disabled={entry.disabled} aria-haspopup={entry.kind==='submenu'?'menu':undefined} aria-expanded={entry.kind==='submenu'?child?.entryIndex===index:undefined} aria-controls={entry.kind==='submenu'&&child?.entryIndex===index?`sdk-menu-${menu.id}-${child.id}`:undefined} onFocus={()=>trim(level,index)} onClick={event=>invoke(level,index,event.currentTarget)} className={itemClass+' '+(entry.kind==='item'&&entry.variant==='destructive'?'text-danger enabled:text-[color:color-mix(in_srgb,var(--color-danger)_60%,var(--color-text-primary))]':'text-text-secondary hover:text-text-primary')}><span className="min-w-0 flex-1">{entry.label}</span>{entry.kind==='submenu'&&<ChevronRight size={14} className="shrink-0" aria-hidden="true"/>}</button>)}
 </div>;
}
