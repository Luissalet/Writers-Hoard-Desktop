import {createContext,useContext,useSyncExternalStore} from 'react';
import {getActiveEnginePaneId} from '@/engines/_shared/EnginePaneContext';
import {activeLocalToolFocus,inactiveLocalToolFocus,unavailableLocalToolFocus,type LocalToolFocusMode} from '@/engines/local/focusMode';
interface FocusTarget {hostId:string;projectId:string;eraId?:string;namespace:string;documentId?:string;instanceId:string}
interface MountedTarget extends FocusTarget {port:LocalToolFocusMode;restoreFocus?:()=>void}
const mounted=new Set<MountedTarget>();
export function workspaceFocusTargets(projectId:string,filters:{eraId?:string;namespace?:string;documentId?:string}={}){
 return[...mounted].filter(item=>item.projectId===projectId&&(!filters.eraId||item.eraId===filters.eraId)&&(!filters.namespace||item.namespace===filters.namespace)&&(!filters.documentId||item.documentId===filters.documentId)).flatMap(item=>{const state=item.port.getState();return state.available?[{hostId:item.hostId,namespace:item.namespace,...(item.documentId?{documentId:item.documentId}:{}),...(item.eraId?{eraId:item.eraId}:{}),...state}]:[];});
}
export function setWorkspaceFocus(projectId:string,hostId:string,active:boolean){const item=[...mounted].find(item=>item.projectId===projectId&&item.hostId===hostId);item?.port.set(active);return item?.port.getState()??unavailableLocalToolFocus;}
/** One ephemeral shell authority. Source bindings reuse their host's existing lifetime. */
export function createWorkspaceFocusController(){
 let session:{projectId:string}|undefined,owner:MountedTarget|undefined;
 const bindings=new Set<{dispose():void}>();
 const listeners=new Set<()=>void>(),notify=()=>{for(const changed of [...listeners])changed();};
 const controller={
  getState:()=>owner?activeLocalToolFocus:inactiveLocalToolFocus,
  subscribe:(changed:()=>void)=>{listeners.add(changed);return()=>{listeners.delete(changed);};},
  clear:(restore=false)=>{if(owner){const before=owner;owner=undefined;notify();if(restore)before.restoreFocus?.();}},
  begin:(projectId:string)=>{const token={projectId};session=token;controller.clear();notify();return()=>{if(session===token){session=undefined;for(const binding of [...bindings])binding.dispose();controller.clear();notify();}};},
  bind:(target:Omit<FocusTarget,'hostId'>,current:()=>boolean,restoreFocus?:()=>void)=>{
   let live=true;const subscriptions=new Set<()=>void>(),entry:MountedTarget={...target,hostId:crypto.randomUUID(),port:undefined!,restoreFocus};
   const available=()=>live&&current()&&session?.projectId===target.projectId;
   const state=()=>available()?(owner?activeLocalToolFocus:inactiveLocalToolFocus):unavailableLocalToolFocus;
   const set=(active:boolean)=>{if(!available())return;if(typeof active!=='boolean')throw Error('local_tool_focus_invalid_state');if(active===!!owner)return;owner=active?entry:undefined;notify();};
   const port:LocalToolFocusMode=Object.freeze({getState:state,set,toggle:()=>set(!owner),subscribe:(changed:()=>void)=>{if(!live)return()=>{};const listener=()=>changed();subscriptions.add(listener);listeners.add(listener);return()=>{subscriptions.delete(listener);listeners.delete(listener);};}});
   entry.port=port;mounted.add(entry);
   const binding={port,dispose:()=>{if(!live)return;live=false;bindings.delete(binding);mounted.delete(entry);if(owner===entry){owner=undefined;notify();}for(const changed of subscriptions){listeners.delete(changed);changed();}subscriptions.clear();}};bindings.add(binding);return binding;
  },
  ownsEvent:(event:KeyboardEvent)=>{if(!owner)return false;const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-engine-pane-id]'):null;const focused=document.activeElement?.closest<HTMLElement>('[data-engine-pane-id]');return(target?.dataset.enginePaneId??focused?.dataset.enginePaneId??getActiveEnginePaneId())===owner.instanceId;},
 };
 return controller;
}
export const WorkspaceFocusContext=createContext<ReturnType<typeof createWorkspaceFocusController>|null>(null);
const noSubscribe=()=>()=>{},inactive=()=>inactiveLocalToolFocus;
export function useWorkspaceFocusChrome(){const controller=useContext(WorkspaceFocusContext),state=useSyncExternalStore(controller?.subscribe??noSubscribe,controller?.getState??inactive,inactive);return{'data-workspace-chrome':true,hidden:state.active,inert:state.active,'aria-hidden':state.active||undefined,style:state.active?{display:'none' as const}:undefined};}
