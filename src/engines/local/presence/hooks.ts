import {observeLocalDocumentPresence,subscribePresenceHosts} from './registry';
import {useCallback,useLayoutEffect,useRef,useState,useMemo} from 'react';
import type {LocalToolClient,LocalToolHostContext,LocalToolJson} from '../sdk';
import type {LocalToolDocumentPresence,LocalToolPresenceSnapshot,LocalToolCollabPresencePeer} from './types';
const absent:LocalToolPresenceSnapshot={status:'unavailable',peers:[]};
function port(client:LocalToolClient<LocalToolJson>|null|undefined,context:LocalToolHostContext|undefined){if(!client||!context?.document)return undefined;return context.document.id===client.documentId&&context.document.namespace===client.namespace&&context.scope.projectId===client.projectId&&context.scope.eraId===client.eraId?context.presence:undefined;}
export function useLocalPresencePort(current:LocalToolDocumentPresence|undefined){
 const [observed,setObserved]=useState<{port:LocalToolDocumentPresence|undefined;snapshot:LocalToolPresenceSnapshot}>(()=>({port:current,snapshot:current?.getSnapshot()??absent}));
 useLayoutEffect(()=>{let active=true;const refresh=()=>{if(active)setObserved({port:current,snapshot:current?.getSnapshot()??absent});};const off=current?.subscribe(refresh);refresh();return()=>{active=false;off?.();};},[current]);
 return observed.port===current?observed.snapshot:current?.getSnapshot()??absent;
}
export function useLocalToolDocumentPresence<T extends LocalToolJson>(client:LocalToolClient<T>|null|undefined,context?:LocalToolHostContext){return useLocalPresencePort(port(client as LocalToolClient<LocalToolJson>,context));}
export function useLocalToolCollabPresence<T extends LocalToolJson=LocalToolJson>(client:LocalToolClient<LocalToolJson>|null|undefined,context?:LocalToolHostContext){
 const current=port(client,context),snapshot=useLocalPresencePort(current),release=useRef<{port:LocalToolDocumentPresence;clear:()=>void}|undefined>(undefined),active=useRef(current);
 useLayoutEffect(()=>{active.current=current;return()=>{if(active.current===current)active.current=undefined;const owned=release.current;if(owned&&owned.port===current){owned.clear();release.current=undefined;}};},[current]);
 const setLocal=useCallback((state:T|null)=>{if(!current||active.current!==current)return;if(state===null){const owned=release.current;if(owned&&owned.port===current){owned.clear();release.current=undefined;}return;}const next=current.publish(state);release.current?.clear();release.current={port:current,clear:next};},[current]);return{...snapshot,peers:snapshot.peers as LocalToolCollabPresencePeer<T>[],setLocal};
}

export function useLocalToolDocumentPresenceById<T extends LocalToolJson>(client:LocalToolClient<T>|null|undefined,query:{namespace:string;documentId:string}|null){
 const namespace=query?.namespace,documentId=query?.documentId;
 const observer=useMemo<LocalToolDocumentPresence|undefined>(()=>client&&namespace&&documentId?{instanceId:'observer',getSnapshot:()=>observeLocalDocumentPresence({projectId:client.projectId,eraId:client.eraId},namespace,documentId),subscribe:subscribePresenceHosts,setLocal:()=>{},publish:()=>()=>{},clear:()=>{}}:undefined,[client,namespace,documentId]);return useLocalPresencePort(observer);
}
export function useLocalToolDocumentAwareness<T extends LocalToolJson>(client:LocalToolClient<T>|null|undefined,context?:LocalToolHostContext){return port(client as LocalToolClient<LocalToolJson>,context);}
