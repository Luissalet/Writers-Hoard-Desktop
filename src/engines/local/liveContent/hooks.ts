import {useCallback,useMemo,useSyncExternalStore} from 'react';
import type {LocalToolDocumentContentSnapshot} from './types';
import type {LocalToolClient,LocalToolHostContext,LocalToolJson} from '../sdk';
/** Observing the port never joins a room or publishes content. */
export function useLocalToolDocumentContent<T extends LocalToolJson>(client:LocalToolClient<T>|undefined|null,context?:LocalToolHostContext){
 const port=client&&context?.document&&context.document.id===client.documentId&&context.document.namespace===client.namespace&&context.scope.projectId===client.projectId&&context.scope.eraId===client.eraId?context.documentContent:undefined;
 const subscribe=useCallback((changed:()=>void)=>port?.subscribe(changed)??(()=>{}),[port]);
 // The external store value contains status metadata only, never document content.
 const read=useCallback(()=>port?JSON.stringify(port.getSnapshot()):'',[port]);
 const serialized=useSyncExternalStore(subscribe,read,read);
 const snapshot=useMemo(()=>serialized?JSON.parse(serialized) as LocalToolDocumentContentSnapshot:undefined,[serialized]);
 return{snapshot,content:port};
}
