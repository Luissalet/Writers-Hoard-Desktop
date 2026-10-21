import {createContext,useContext,useId,useLayoutEffect} from 'react';
import type {Editor} from '@tiptap/core';
export type LocalToolPendingReporter=(token:string,pending:boolean)=>void;
export const LocalToolAtomPendingContext=createContext<LocalToolPendingReporter|undefined>(undefined);
export function useLocalToolAtomPending(pending:boolean){const report=useContext(LocalToolAtomPendingContext),token=useId();useLayoutEffect(()=>{report?.(token,pending);return()=>report?.(token,false);},[report,token,pending]);}
const pendingAtoms=new WeakMap<Editor,Map<string,Set<string>>>();
export function setLocalToolAtomPending(editor:Editor,key:string,token:string,pending:boolean){let atoms=pendingAtoms.get(editor);if(!atoms){atoms=new Map();pendingAtoms.set(editor,atoms);}const tokens=atoms.get(key)??new Set<string>();if(pending)tokens.add(token);else tokens.delete(token);if(tokens.size)atoms.set(key,tokens);else atoms.delete(key);}
export function localToolAtomPending(editor:Editor,key:string){return!!pendingAtoms.get(editor)?.get(key)?.size;}
export function localToolAtomKey(node:{type:{name:string};attrs:Record<string,unknown>}):string|undefined{if(node.type.name==='sourceToolBlock')return 'owned:'+String((node.attrs.envelope as {id?:string}|null)?.id??'');if(node.type.name==='toolDocumentBlock')return JSON.stringify(['document',node.attrs.projectId,node.attrs.kind,node.attrs.namespace,node.attrs.documentId]);if(node.type.name==='codexLiveBlock')return JSON.stringify(['codex-reference',node.attrs.projectId,node.attrs.entryId]);return undefined;}
