import {useCallback,useLayoutEffect,useRef} from 'react';
import type {LocalToolHostContext} from './sdk';
import {localToolJsonText,type LocalToolJson} from './stateTypes';
/** Opt in by supplying the draft; pass undefined or call clear before Discard. */
export function useLocalToolDocumentFields(context:LocalToolHostContext|undefined,data:LocalToolJson|undefined){
 const port=context?.documentFields,release=useRef<(()=>void)|undefined>(undefined);
 let key:string|undefined,error='';try{if(data!==undefined)key=localToolJsonText(data);}catch(reason){error=String(reason);}
 const clear=useCallback(()=>{release.current?.();release.current=undefined;},[]);
 useLayoutEffect(()=>{
  if(port&&key!==undefined)release.current=port.publish(JSON.parse(key));
  return clear;
 },[port,key,clear]);
 return{instanceId:port?.instanceId,available:!!port,error,clear};
}
