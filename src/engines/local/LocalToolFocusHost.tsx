import {useContext,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {WorkspaceFocusContext} from '@/components/project/workspace/workspaceFocus';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {useTranslation} from '@/i18n/useTranslation';
import {useLocalToolFocusMode} from './useLocalToolFocusMode';
import type {LocalToolFocusMode} from './focusMode';
import type {LocalToolHostContext} from './sdk';
/** No wrapper, client replacement or view transition when shell chrome changes. */
export default function LocalToolFocusHost({context,releaseHash,identity,visible=true,namespace,instanceId:ownInstanceId,children}:{context:LocalToolHostContext;releaseHash:string|null;identity:unknown;visible?:boolean;namespace:string;instanceId?:string;children:(context:LocalToolHostContext,control:ReactNode)=>ReactNode}){
 const controller=useContext(WorkspaceFocusContext),pane=useEnginePane(),{t}=useTranslation(),button=useRef<HTMLButtonElement>(null);
 const {projectId,eraId}=context.scope,documentId=context.document?.id,instanceId=ownInstanceId??pane?.instanceId;
 const enabled=visible&&(pane?.visible??true)&&context.canEdit&&context.view==='editor';
 const token=useMemo(()=>({controller,identity,projectId,eraId,documentId,namespace,releaseHash,instanceId,enabled}),[controller,identity,projectId,eraId,documentId,namespace,releaseHash,instanceId,enabled]);
 const [binding,setBinding]=useState<{token:typeof token;port:LocalToolFocusMode}>();
 useLayoutEffect(()=>{if(!controller||!enabled||!instanceId)return;let live=true;const bound=controller.bind({projectId,eraId,namespace,documentId,instanceId},()=>live,()=>{if(button.current?.isConnected)button.current.focus({preventScroll:true});});setBinding({token,port:bound.port});return()=>{live=false;bound.dispose();};},[controller,token,enabled,instanceId,projectId,eraId,namespace,documentId]);
 const port=binding?.token===token?binding.port:undefined,focus=useLocalToolFocusMode({focusMode:port}),next=useMemo(()=>({...context,focusMode:port}),[context,port]);
 const control=focus.available?<button ref={button} type="button" data-local-tool-focus aria-pressed={focus.active} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={focus.toggle}>{t(focus.active?'localTool.focus.exit':'localTool.focus.enter')}</button>:null;
 return children(next,control);
}
